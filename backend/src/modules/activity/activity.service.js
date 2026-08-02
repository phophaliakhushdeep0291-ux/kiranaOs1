import db from "../../db.js";
import { sanitizeText, sanitizeTelemetry } from "../../lib/errorTracking.js";
import { EVENT_TOPICS, publishEvent } from "../../lib/eventBus.js";
import {
  ACTIVITY_EVENTS,
  AGGREGATE_KINDS,
  isKnownEventType,
  isOnlineEventType,
  moduleForEvent,
} from "./activity.events.js";
import { activityEventSchema } from "./activity.schema.js";

/**
 * Activity ingest + aggregation (§13).
 *
 * Two invariants hold everywhere in this file:
 *
 *  1. **Telemetry never fails a user action.** Every entry point swallows its
 *     own errors and reports a count instead of throwing, exactly like
 *     `createAuditLog` and `recordErrorEvent`. A shopkeeper must never be unable
 *     to bill because an analytics write failed.
 *  2. **Nothing here is authoritative.** Aggregates are a derived read model.
 *     They can be rebuilt from ActivityEvent, and no money, stock or tax figure
 *     is ever read from them.
 */

const SHOP_SCOPE = "*"; // ActivityAggregate.userId sentinel for shop-wide rollups
const MAX_METADATA_BYTES = 4 * 1024;
const MAX_KEY = 180;
const MAX_LABEL = 200;
const MAX_QUERY = 80;

/**
 * Recency half-life for aggregate scores, in days.
 *
 * The counter columns answer "how often, ever"; the score answers "how relevant
 * now". A 30-day half-life means a product billed today is worth two billed a
 * month ago — fast enough that a seasonal item stops being suggested in the
 * off-season, slow enough that one quiet week does not wipe a staple off the
 * quick-add row.
 */
const SCORE_HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Decay a stored score forward to `now` before adding this event's weight. */
export function decayScore(score, lastSeenAt, now = new Date()) {
  const previous = Number(score) || 0;
  if (previous <= 0) return 0;
  const elapsedMs = now.getTime() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return previous;
  return previous * Math.pow(0.5, elapsedMs / DAY_MS / SCORE_HALF_LIFE_DAYS);
}

function clampStr(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Search queries are typed by a human and are the one place a phone number or a
 * customer name can leak into telemetry. They go through the same redaction the
 * error store uses, then are lowercased so "Maggi" and "maggi" are one row.
 */
export function normalizeQuery(raw) {
  const safe = sanitizeText(String(raw ?? ""));
  return clampStr(String(safe).toLowerCase().replace(/\s+/g, " "), MAX_QUERY);
}

/**
 * Identifier-shaped keys: `productId`, `customerIds`, `billId`, …
 */
const ID_KEY = /(?:^id$|Ids?$|_ids?$)/;

/**
 * sanitizeActivityMetadata — redaction tuned for behavioural telemetry.
 *
 * The error store's `sanitizeTelemetry` blanks `customerId`, `productId` and
 * friends, which is right for a stack trace (an id there is noise that might
 * identify a person) and exactly wrong here: those ids ARE the signal. Blanking
 * them turns every counter into one giant "[REDACTED]" bucket.
 *
 * So identifier-shaped keys keep their value — they are opaque, tenant-scoped
 * cuids that mean nothing outside the shop that owns them — and everything else,
 * including the free text a human typed into a search box, still goes through
 * the shared redaction. Identifier values are additionally run through the phone
 * pattern: no cuid can match it, so it costs nothing, and it stops a caller that
 * mistakenly puts a phone number in an "id" field from persisting it.
 */
export function sanitizeActivityMetadata(value, depth = 0, key = "") {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (ID_KEY.test(key)) {
    if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeIdentifier(item));
    return sanitizeIdentifier(value);
  }
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeActivityMetadata(item, depth + 1));
  if (typeof value === "object") {
    const safe = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      safe[childKey] = sanitizeActivityMetadata(childValue, depth + 1, childKey);
    }
    return safe;
  }
  return sanitizeTelemetry(value, depth, key);
}

function sanitizeIdentifier(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return value;
  const text = String(value).slice(0, 80);
  const redacted = sanitizeText(text);
  // sanitizeText only rewrites the value if it looked like a phone or an email,
  // which an id never does; if it did, keep the redaction rather than the id.
  return redacted;
}

function serializeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return "{}";
  try {
    const safe = sanitizeActivityMetadata(metadata);
    let json = JSON.stringify(safe);
    if (json.length > MAX_METADATA_BYTES) {
      // Truncating JSON mid-string would persist unparseable garbage, so drop to
      // a marker object instead and keep the row readable.
      json = JSON.stringify({ truncated: true, bytes: json.length });
    }
    return json;
  } catch {
    return "{}";
  }
}

export function parseMetadata(json) {
  try {
    const parsed = JSON.parse(json ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * recordActivityBatch — persist a batch of events and fold them into the
 * aggregates. Never throws; returns per-batch counts so a client can see (and an
 * operator can alarm on) silent drops.
 */
export async function recordActivityBatch(events, context, { client = db } = {}) {
  const result = { accepted: 0, duplicates: 0, rejected: 0, aggregated: 0 };
  if (!Array.isArray(events) || events.length === 0) return result;
  if (!context?.shopId) {
    result.rejected = events.length;
    return result;
  }

  for (const event of events) {
    try {
      const stored = await persistEvent(event, context, client);
      if (stored === "duplicate") {
        result.duplicates += 1;
        continue;
      }
      if (!stored) {
        result.rejected += 1;
        continue;
      }
      result.accepted += 1;
      const folded = await applyAggregates(stored, client);
      result.aggregated += folded;
      // Fire-and-forget; publishEvent never throws.
      void publishEvent(EVENT_TOPICS.ACTIVITY_EVENT, context.shopId, {
        eventType: stored.eventType,
        module: stored.module,
        userId: stored.userId,
        deviceId: stored.deviceId,
        sessionId: stored.sessionId,
        occurredAt: stored.occurredAt,
        source: stored.source,
      });
    } catch {
      result.rejected += 1;
    }
  }

  return result;
}

async function persistEvent(raw, context, client) {
  // Per-event validation, so one malformed or unrecognised event costs itself
  // and not the batch around it.
  const parsed = activityEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (!isKnownEventType(event.eventType)) return null;

  const online = isOnlineEventType(event.eventType);
  // An online shopper is not a POS user. Attributing their browsing to whichever
  // staff member's token happened to carry the request would poison that user's
  // personal suggestions, so online events are shop-scoped only.
  const userId = online ? null : (context.userId ?? null);
  const occurredAt = parseOccurredAt(event.occurredAt);

  const data = {
    eventId: clampStr(event.eventId, 80),
    shopId: context.shopId,
    userId,
    orgId: context.orgId ?? null,
    deviceId: clampStr(event.deviceId, 120) ?? context.deviceId ?? null,
    sessionId: clampStr(event.sessionId, 80),
    eventType: event.eventType,
    module: clampStr(event.module, 40) ?? moduleForEvent(event.eventType),
    screen: clampStr(event.screen, 200),
    appVersion: clampStr(event.appVersion, 60),
    networkStatus: event.networkStatus ?? null,
    source: online ? "online" : (context.source ?? "pos"),
    durationMs: Number.isFinite(event.durationMs) ? Math.round(event.durationMs) : null,
    metadataJson: serializeMetadata(event.metadata),
    occurredAt,
  };
  if (!data.eventId) return null;

  try {
    await client.activityEvent.create({ data });
  } catch (error) {
    // P2002 = the unique eventId already landed. That is the idempotency
    // guarantee working, not a failure: an offline device retrying a batch it
    // already delivered must not double-count.
    if (error?.code === "P2002") return "duplicate";
    throw error;
  }
  return { ...data, metadata: parseMetadata(data.metadataJson) };
}

/**
 * The device clock is not trustworthy — a POS with a dead CMOS battery boots in
 * 2010 and would otherwise pollute every time-bucketed report. Anything outside
 * a sane window around ingest falls back to server time.
 */
function parseOccurredAt(raw) {
  const now = Date.now();
  if (!raw) return new Date(now);
  const parsed = new Date(raw).getTime();
  if (!Number.isFinite(parsed)) return new Date(now);
  // Up to 30 days late (a long offline stretch) but never in the future beyond
  // a minute of clock skew.
  if (parsed > now + 60_000) return new Date(now);
  if (parsed < now - 30 * DAY_MS) return new Date(now);
  return new Date(parsed);
}

// ─────────────────────────────────────────────────────────────
// Aggregation
// ─────────────────────────────────────────────────────────────

/**
 * Which counters an event feeds. Returning a list (rather than one bucket)
 * lets a single event update both the user's personal history and the shop-wide
 * rollup that powers trending/BI.
 */
export function aggregateTargetsFor(event) {
  const meta = event.metadata ?? {};
  const targets = [];
  const both = (kind, key, label, extra) => {
    if (!key) return;
    targets.push({ kind, key, label, scope: "user", ...extra });
    targets.push({ kind, key, label, scope: "shop", ...extra });
  };
  const shopOnly = (kind, key, label, extra) => {
    if (!key) return;
    targets.push({ kind, key, label, scope: "shop", ...extra });
  };

  switch (event.eventType) {
    case ACTIVITY_EVENTS.PRODUCT_SEARCH: {
      const query = normalizeQuery(meta.query);
      both(AGGREGATE_KINDS.SEARCH_QUERY, query, query, { durationMs: event.durationMs });
      // A search that ends in a selection is the strongest signal we get about
      // what the user actually meant — count the chosen product, not the query.
      if (meta.selectedProductId) {
        both(AGGREGATE_KINDS.PRODUCT_SEARCHED, String(meta.selectedProductId), meta.selectedProduct ?? meta.selectedProductName);
      }
      break;
    }
    case ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL:
      both(AGGREGATE_KINDS.PRODUCT_BILLED, meta.productId && String(meta.productId), meta.productName);
      break;
    case ACTIVITY_EVENTS.BILL_CREATED: {
      // Basket pairs power "commonly bought together". Only the shop-wide rollup
      // is kept: combinations are a property of the shop's customers, not of the
      // staff member who happened to ring them up.
      for (const pair of basketPairs(meta.productIds)) {
        shopOnly(AGGREGATE_KINDS.PRODUCT_PAIR, pair.key, pair.label);
      }
      if (meta.paymentMethod) both(AGGREGATE_KINDS.PAYMENT_METHOD, String(meta.paymentMethod), String(meta.paymentMethod));
      shopOnly(AGGREGATE_KINDS.TASK_TIME, "bill", "Billing", { durationMs: event.durationMs });
      break;
    }
    case ACTIVITY_EVENTS.PAYMENT_COMPLETED:
      both(AGGREGATE_KINDS.PAYMENT_METHOD, meta.paymentMethod && String(meta.paymentMethod), meta.paymentMethod && String(meta.paymentMethod));
      break;
    case ACTIVITY_EVENTS.CUSTOMER_SELECTED:
      both(AGGREGATE_KINDS.CUSTOMER, meta.customerId && String(meta.customerId), meta.customerName);
      break;
    case ACTIVITY_EVENTS.REPORT_VIEW:
    case ACTIVITY_EVENTS.REPORT_EXPORT:
      both(AGGREGATE_KINDS.REPORT, meta.report && String(meta.report), meta.reportLabel ?? (meta.report && String(meta.report)));
      break;
    case ACTIVITY_EVENTS.SCREEN_VIEW:
      both(AGGREGATE_KINDS.PAGE, event.screen, event.screen, { durationMs: event.durationMs });
      break;
    case ACTIVITY_EVENTS.FEATURE_USED:
      both(AGGREGATE_KINDS.FEATURE, meta.feature && String(meta.feature), meta.featureLabel ?? (meta.feature && String(meta.feature)));
      break;
    case ACTIVITY_EVENTS.TASK_COMPLETED:
      both(AGGREGATE_KINDS.TASK_TIME, meta.task && String(meta.task), meta.taskLabel ?? (meta.task && String(meta.task)), {
        durationMs: event.durationMs,
      });
      break;
    case ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW:
      shopOnly(AGGREGATE_KINDS.ONLINE_PRODUCT_VIEW, meta.productId && String(meta.productId), meta.productName);
      break;
    case ACTIVITY_EVENTS.ONLINE_CART_ADD:
      shopOnly(AGGREGATE_KINDS.ONLINE_CART_ADD, meta.productId && String(meta.productId), meta.productName);
      break;
    case ACTIVITY_EVENTS.ONLINE_CART_ABANDONED:
      shopOnly(AGGREGATE_KINDS.ABANDONED_CART, event.sessionId, meta.customerName ?? null, {
        meta: { itemCount: meta.itemCount ?? null, total: meta.total ?? null, productIds: meta.productIds ?? [] },
      });
      break;
    default:
      break;
  }

  // Filters are orthogonal to the event that carried them: any screen may report
  // "I applied these filters", and remembering them is a per-user preference.
  if (Array.isArray(meta.filters)) {
    for (const filter of meta.filters.slice(0, 8)) {
      const key = clampStr(`${event.screen ?? "any"}:${filter}`, MAX_KEY);
      targets.push({ kind: AGGREGATE_KINDS.FILTER, key, label: String(filter), scope: "user" });
    }
  }

  return targets.filter((t) => t.key);
}

/**
 * Every unordered pair in a basket. Capped at 12 line items: pair count grows
 * quadratically, and a 60-line wholesale bill would otherwise write 1,770 rows
 * for one event.
 */
function basketPairs(productIds) {
  if (!Array.isArray(productIds)) return [];
  const ids = [...new Set(productIds.map((id) => String(id)).filter(Boolean))].slice(0, 12);
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      // Sorted so {A,B} and {B,A} are the same counter.
      const [a, b] = [ids[i], ids[j]].sort();
      pairs.push({ key: `${a}|${b}`, label: null });
    }
  }
  return pairs;
}

async function applyAggregates(event, client) {
  const targets = aggregateTargetsFor(event);
  let applied = 0;
  for (const target of targets) {
    const userId = target.scope === "user" ? event.userId : SHOP_SCOPE;
    // An online (or unauthenticated) event has no user to attribute to.
    if (!userId) continue;
    try {
      await bumpAggregate(client, {
        shopId: event.shopId,
        userId,
        kind: target.kind,
        key: clampStr(target.key, MAX_KEY),
        label: clampStr(target.label, MAX_LABEL),
        durationMs: target.durationMs ?? null,
        meta: target.meta ?? null,
        at: event.occurredAt,
      });
      applied += 1;
    } catch {
      // One bad counter must not lose the rest of the batch.
    }
  }
  return applied;
}

/**
 * bumpAggregate — read-modify-write one counter.
 *
 * A raw `increment` would be one round trip, but the score has to be decayed
 * from its own lastSeenAt before the new weight is added, and that is not
 * expressible as an atomic increment. Losing a concurrent bump here costs one
 * count on a suggestion ranking — an acceptable trade that would not be
 * acceptable anywhere near money.
 */
async function bumpAggregate(client, input) {
  const at = input.at instanceof Date ? input.at : new Date(input.at ?? Date.now());
  const where = {
    shopId_userId_kind_key: { shopId: input.shopId, userId: input.userId, kind: input.kind, key: input.key },
  };
  const existing = await client.activityAggregate.findUnique({ where });
  const hasDuration = Number.isFinite(input.durationMs) && input.durationMs !== null;

  if (!existing) {
    await client.activityAggregate.create({
      data: {
        shopId: input.shopId,
        userId: input.userId,
        kind: input.kind,
        key: input.key,
        label: input.label,
        count: 1,
        score: 1,
        totalMs: hasDuration ? input.durationMs : 0,
        durationSamples: hasDuration ? 1 : 0,
        metaJson: input.meta ? JSON.stringify(input.meta) : "{}",
        firstSeenAt: at,
        lastSeenAt: at,
      },
    });
    return;
  }

  await client.activityAggregate.update({
    where,
    data: {
      count: existing.count + 1,
      score: decayScore(existing.score, existing.lastSeenAt, at) + 1,
      totalMs: hasDuration ? existing.totalMs + input.durationMs : existing.totalMs,
      durationSamples: hasDuration ? existing.durationSamples + 1 : existing.durationSamples,
      // Keep the freshest label so a renamed product stops showing its old name.
      label: input.label ?? existing.label,
      metaJson: input.meta ? JSON.stringify(input.meta) : existing.metaJson,
      // Never move lastSeenAt backwards: a late offline batch must not make a
      // stale counter look current.
      lastSeenAt: at > existing.lastSeenAt ? at : existing.lastSeenAt,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────

/**
 * Rank aggregates by decayed score. Decay is applied at READ time as well as at
 * write time: a counter last touched three months ago must rank as stale even
 * though nothing has bumped it since.
 */
export async function topAggregates(client, { shopId, userId, kind, limit = 10, now = new Date() }) {
  const rows = await client.activityAggregate.findMany({
    where: { shopId, userId, kind },
    // Over-fetch: DB order is by stored score, and read-time decay can reorder
    // the head of the list.
    orderBy: [{ score: "desc" }, { lastSeenAt: "desc" }],
    take: Math.min(limit * 4, 200),
  });
  return rows
    .map((row) => ({
      key: row.key,
      label: row.label,
      count: row.count,
      score: decayScore(row.score, row.lastSeenAt, now),
      totalMs: row.totalMs,
      durationSamples: row.durationSamples,
      lastSeenAt: row.lastSeenAt,
      meta: parseMetadata(row.metaJson),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, limit);
}

/**
 * getRecentActivity — the spec's "Recent User Activity" record (§13). One call,
 * because every consumer (billing screen, dashboard, command palette) wants the
 * whole shape and a POS should not make nine requests to draw one panel.
 */
export async function getRecentActivity({ shopId, userId, limit = 10 }, { client = db } = {}) {
  const now = new Date();
  const forUser = (kind, take = limit) => topAggregates(client, { shopId, userId, kind, limit: take, now });
  const forShop = (kind, take = limit) => topAggregates(client, { shopId, userId: SHOP_SCOPE, kind, limit: take, now });

  const [searches, reports, customers, products, paymentMethods, filters, pages, onlineViews, abandoned] = await Promise.all([
    recentDistinct(client, { shopId, userId, eventType: ACTIVITY_EVENTS.PRODUCT_SEARCH, field: "query", limit }),
    forUser(AGGREGATE_KINDS.REPORT),
    forUser(AGGREGATE_KINDS.CUSTOMER),
    forUser(AGGREGATE_KINDS.PRODUCT_BILLED),
    forUser(AGGREGATE_KINDS.PAYMENT_METHOD, 5),
    forUser(AGGREGATE_KINDS.FILTER),
    forUser(AGGREGATE_KINDS.PAGE),
    forShop(AGGREGATE_KINDS.ONLINE_PRODUCT_VIEW),
    forShop(AGGREGATE_KINDS.ABANDONED_CART),
  ]);

  return {
    recentSearches: searches,
    recentReports: reports.map(asEntry),
    frequentCustomers: customers.map(asEntry),
    frequentProducts: products.map(asEntry),
    recentPaymentMethods: paymentMethods.map(asEntry),
    frequentFilters: filters.map(asEntry),
    frequentPages: pages.map(asEntry),
    recentOnlineProducts: onlineViews.map(asEntry),
    abandonedCarts: abandoned.map((row) => ({
      sessionId: row.key,
      customerName: row.label,
      itemCount: row.meta?.itemCount ?? null,
      total: row.meta?.total ?? null,
      productIds: Array.isArray(row.meta?.productIds) ? row.meta.productIds : [],
      lastSeenAt: row.lastSeenAt,
    })),
  };
}

function asEntry(row) {
  return { key: row.key, label: row.label ?? row.key, count: row.count, score: round(row.score), lastSeenAt: row.lastSeenAt };
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

/**
 * "Recently searched" is a chronological list, not a frequency ranking — the
 * user wants the last thing they typed, so this reads events rather than
 * counters, de-duplicating on the way.
 */
async function recentDistinct(client, { shopId, userId, eventType, field, limit }) {
  const rows = await client.activityEvent.findMany({
    where: { shopId, userId, eventType },
    orderBy: { occurredAt: "desc" },
    take: Math.min(limit * 10, 200),
    select: { metadataJson: true, occurredAt: true },
  });
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const meta = parseMetadata(row.metadataJson);
    const value = clampStr(meta[field], MAX_QUERY);
    if (!value) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ value, at: row.occurredAt, results: Number.isFinite(meta.results) ? meta.results : null });
    if (out.length >= limit) break;
  }
  return out;
}

export { SHOP_SCOPE };
