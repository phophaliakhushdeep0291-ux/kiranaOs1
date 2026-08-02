import db from "../../db.js";
import { ACTIVITY_EVENTS, AGGREGATE_KINDS } from "./activity.events.js";
import { SHOP_SCOPE, parseMetadata, topAggregates } from "./activity.service.js";

/**
 * Business intelligence over the activity stream (§13 "Business Intelligence").
 *
 * Everything is scoped to one shop. Cross-shop rollups are a platform-operator
 * concern and live behind the platform-admin gate, not here.
 *
 * Where a metric can be counted with a `groupBy` it is; where it needs the
 * event's metadata it reads a bounded window of rows and folds them in memory.
 * That is a deliberate ceiling: a report that degrades to "based on the last N
 * events" is far better on a counter PC than one that locks the database while a
 * queue of customers waits.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard ceiling on rows any single metadata scan may pull. */
const SCAN_LIMIT = 5000;

export async function getActivityAnalytics({ shopId, days = 30, limit = 10 }, { client = db } = {}) {
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);

  const [
    activeUsers,
    eventCounts,
    durations,
    metadataMetrics,
    online,
    featureAdoption,
    supportIssues,
    systemErrors,
  ] = await Promise.all([
    activeUserCounts(client, shopId, now),
    countByEventType(client, shopId, since),
    averageDurations(client, shopId, since),
    metadataRollups(client, shopId, since, limit),
    onlineFunnel(client, shopId, since),
    featureAdoptionRates(client, shopId, since, limit),
    commonSupportIssues(client, shopId, since, limit),
    commonSystemErrors(client, shopId, since, limit),
  ]);

  const totalEvents = Object.values(eventCounts).reduce((sum, value) => sum + value, 0);

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    totalEvents,
    activeUsers,
    eventCounts,
    // "Most utilized features" / "Least utilized features". Least-used is drawn
    // from the same measured set, so a feature nobody has ever touched is absent
    // rather than reported as the least popular — an untouched feature is a
    // discovery problem, and the adoption block below is where it shows up.
    mostUsedFeatures: featureAdoption.mostUsed,
    leastUsedFeatures: featureAdoption.leastUsed,
    featureAdoption: featureAdoption.rates,
    averageBillingTimeMs: durations.billing,
    averageCheckoutDurationMs: durations.checkout,
    averageSearchDurationMs: durations.search,
    slowestTasks: durations.slowestTasks,
    mostSearchedProducts: metadataMetrics.mostSearched,
    mostEditedProducts: metadataMetrics.mostEdited,
    mostCancelledBillProducts: metadataMetrics.mostCancelledProducts,
    cancelledBills: metadataMetrics.cancelledBills,
    commonSupportIssues: supportIssues,
    commonSystemErrors: systemErrors,
    aiUsage: {
      queries: eventCounts[ACTIVITY_EVENTS.AI_ASSISTANT_QUERY] ?? 0,
      helpArticles: eventCounts[ACTIVITY_EVENTS.HELP_ARTICLE_VIEWED] ?? 0,
      users: await distinctUserCount(client, shopId, since, ACTIVITY_EVENTS.AI_ASSISTANT_QUERY),
    },
    voiceUsage: {
      commands: eventCounts[ACTIVITY_EVENTS.VOICE_COMMAND_USED] ?? 0,
      users: await distinctUserCount(client, shopId, since, ACTIVITY_EVENTS.VOICE_COMMAND_USED),
    },
    online,
  };
}

/**
 * DAU / WAU / MAU. Counted on distinct `userId`, not devices: one shopkeeper
 * with a counter PC and a phone is one active user, and counting devices would
 * quietly inflate every engagement number.
 */
async function activeUserCounts(client, shopId, now) {
  const windows = { dau: 1, wau: 7, mau: 30 };
  const out = {};
  for (const [label, days] of Object.entries(windows)) {
    const rows = await client.activityEvent.findMany({
      where: { shopId, userId: { not: null }, occurredAt: { gte: new Date(now.getTime() - days * DAY_MS) } },
      distinct: ["userId"],
      select: { userId: true },
    });
    out[label] = rows.length;
  }
  // Stickiness: what share of the month's users showed up today. The standard
  // engagement ratio, and the one number that says whether the POS is a daily
  // habit or an occasional visit.
  out.stickiness = out.mau > 0 ? round(out.dau / out.mau, 3) : null;
  return out;
}

async function countByEventType(client, shopId, since) {
  const rows = await client.activityEvent.groupBy({
    by: ["eventType"],
    where: { shopId, occurredAt: { gte: since } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.eventType, row._count._all]));
}

async function distinctUserCount(client, shopId, since, eventType) {
  const rows = await client.activityEvent.findMany({
    where: { shopId, eventType, userId: { not: null }, occurredAt: { gte: since } },
    distinct: ["userId"],
    select: { userId: true },
  });
  return rows.length;
}

/**
 * Averages over `durationMs`. Only events that actually carried a duration are
 * counted — averaging in the nulls as zeros is the classic way to report a
 * flatteringly fast POS that nobody experiences.
 */
async function averageDurations(client, shopId, since) {
  const [billing, checkout, search] = await Promise.all([
    averageDuration(client, shopId, since, ACTIVITY_EVENTS.BILL_CREATED),
    averageDuration(client, shopId, since, ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED),
    averageDuration(client, shopId, since, ACTIVITY_EVENTS.PRODUCT_SEARCH),
  ]);

  // "Which tasks consume the most time" reads the pre-summed counters rather
  // than rescanning events.
  const taskRows = await client.activityAggregate.findMany({
    where: { shopId, userId: SHOP_SCOPE, kind: AGGREGATE_KINDS.TASK_TIME, durationSamples: { gt: 0 } },
    take: 100,
  });
  const slowestTasks = taskRows
    .map((row) => ({
      task: row.key,
      label: row.label ?? row.key,
      samples: row.durationSamples,
      averageMs: Math.round(row.totalMs / row.durationSamples),
      totalMs: row.totalMs,
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 10);

  return { billing, checkout, search, slowestTasks };
}

async function averageDuration(client, shopId, since, eventType) {
  const result = await client.activityEvent.aggregate({
    where: { shopId, eventType, durationMs: { not: null }, occurredAt: { gte: since } },
    _avg: { durationMs: true },
    _count: { _all: true },
  });
  const average = result._avg.durationMs;
  return { averageMs: average === null ? null : Math.round(average), samples: result._count._all };
}

/**
 * The metrics that live inside `metadataJson`. One bounded scan per event type,
 * folded in memory.
 */
async function metadataRollups(client, shopId, since, limit) {
  const [searched, edited, cancelled] = await Promise.all([
    scanEvents(client, shopId, since, ACTIVITY_EVENTS.PRODUCT_SEARCH),
    scanEvents(client, shopId, since, ACTIVITY_EVENTS.INVENTORY_UPDATE),
    scanEvents(client, shopId, since, ACTIVITY_EVENTS.BILL_CANCELLED),
  ]);

  const mostSearched = tally(searched, (meta) => {
    const query = typeof meta.query === "string" ? meta.query.toLowerCase().trim() : null;
    return query ? [{ key: query, label: query }] : [];
  }).slice(0, limit);

  const mostEdited = tally(edited, (meta) =>
    meta.productId ? [{ key: String(meta.productId), label: meta.productName ?? null }] : [],
  ).slice(0, limit);

  const mostCancelledProducts = tally(cancelled, (meta) =>
    Array.isArray(meta.productIds) ? meta.productIds.map((id) => ({ key: String(id), label: null })) : [],
  ).slice(0, limit);

  const reasons = tally(cancelled, (meta) =>
    meta.reason ? [{ key: String(meta.reason), label: String(meta.reason) }] : [],
  ).slice(0, limit);

  return {
    mostSearched,
    mostEdited,
    mostCancelledProducts,
    cancelledBills: { total: cancelled.length, reasons },
  };
}

async function scanEvents(client, shopId, since, eventType) {
  const rows = await client.activityEvent.findMany({
    where: { shopId, eventType, occurredAt: { gte: since } },
    orderBy: { occurredAt: "desc" },
    take: SCAN_LIMIT,
    select: { metadataJson: true },
  });
  return rows.map((row) => parseMetadata(row.metadataJson));
}

function tally(metas, extract) {
  const counts = new Map();
  for (const meta of metas) {
    for (const item of extract(meta)) {
      if (!item.key) continue;
      const current = counts.get(item.key) ?? { key: item.key, label: item.label, count: 0 };
      current.count += 1;
      if (!current.label && item.label) current.label = item.label;
      counts.set(item.key, current);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * The online (QR self-order) funnel: sessions → checkout started → completed,
 * plus the two rates the spec names.
 */
async function onlineFunnel(client, shopId, since) {
  const counts = await client.activityEvent.groupBy({
    by: ["eventType"],
    where: {
      shopId,
      occurredAt: { gte: since },
      eventType: {
        in: [
          ACTIVITY_EVENTS.ONLINE_SESSION_START,
          ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW,
          ACTIVITY_EVENTS.ONLINE_CART_ADD,
          ACTIVITY_EVENTS.ONLINE_CART_ABANDONED,
          ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED,
          ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED,
          ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED,
        ],
      },
    },
    _count: { _all: true },
  });
  const by = Object.fromEntries(counts.map((row) => [row.eventType, row._count._all]));
  const sessions = by[ACTIVITY_EVENTS.ONLINE_SESSION_START] ?? 0;
  const carts = by[ACTIVITY_EVENTS.ONLINE_CART_ADD] ?? 0;
  const abandoned = by[ACTIVITY_EVENTS.ONLINE_CART_ABANDONED] ?? 0;
  const started = by[ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED] ?? 0;
  const completed = by[ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED] ?? 0;

  // Rates are null, not 0, when the denominator is empty. "0% conversion" on a
  // shop with no online sessions reads as a problem; "no data" reads as the
  // truth.
  return {
    sessions,
    productViews: by[ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW] ?? 0,
    cartAdds: carts,
    checkoutsStarted: started,
    checkoutsCompleted: completed,
    cartsAbandoned: abandoned,
    paymentFailures: by[ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED] ?? 0,
    conversionRate: sessions > 0 ? round(completed / sessions, 4) : null,
    cartAbandonmentRate: abandoned + completed > 0 ? round(abandoned / (abandoned + completed), 4) : null,
    checkoutDropOffRate: started > 0 ? round((started - completed) / started, 4) : null,
  };
}

/**
 * Feature adoption = distinct users who used a feature ÷ distinct active users.
 * A per-user rate rather than a raw count, so one power user hammering a button
 * cannot make a feature look adopted.
 */
async function featureAdoptionRates(client, shopId, since, limit) {
  const activeRows = await client.activityEvent.findMany({
    where: { shopId, userId: { not: null }, occurredAt: { gte: since } },
    distinct: ["userId"],
    select: { userId: true },
  });
  const activeUsers = activeRows.length;

  const rows = await client.activityEvent.findMany({
    where: { shopId, eventType: ACTIVITY_EVENTS.FEATURE_USED, occurredAt: { gte: since } },
    orderBy: { occurredAt: "desc" },
    take: SCAN_LIMIT,
    select: { metadataJson: true, userId: true },
  });

  const byFeature = new Map();
  for (const row of rows) {
    const meta = parseMetadata(row.metadataJson);
    const feature = meta.feature ? String(meta.feature) : null;
    if (!feature) continue;
    const current = byFeature.get(feature) ?? { feature, label: meta.featureLabel ?? feature, count: 0, users: new Set() };
    current.count += 1;
    if (row.userId) current.users.add(row.userId);
    byFeature.set(feature, current);
  }

  const ranked = [...byFeature.values()]
    .map((row) => ({
      feature: row.feature,
      label: row.label,
      count: row.count,
      users: row.users.size,
      adoptionRate: activeUsers > 0 ? round(row.users.size / activeUsers, 4) : null,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    activeUsers,
    mostUsed: ranked.slice(0, limit),
    leastUsed: ranked.slice(-limit).reverse().filter((row) => !ranked.slice(0, limit).some((top) => top.feature === row.feature)),
    rates: ranked,
  };
}

/**
 * Support and error rollups come from the diagnostics store rather than from
 * activity: those are already grouped and deduplicated there, and duplicating
 * the grouping would let the two screens disagree about the same incident.
 */
async function commonSupportIssues(client, shopId, since, limit) {
  const rows = await client.supportRequest.findMany({
    where: { shopId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { page: true, status: true },
  });
  const counts = new Map();
  for (const row of rows) {
    const key = row.page ?? "unknown";
    const current = counts.get(key) ?? { page: key, count: 0, open: 0 };
    current.count += 1;
    if (row.status === "open") current.open += 1;
    counts.set(key, current);
  }
  return { total: rows.length, byPage: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit) };
}

async function commonSystemErrors(client, shopId, since, limit) {
  const groups = await client.errorGroup.findMany({
    where: { shopId, lastSeenAt: { gte: since } },
    orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }],
    take: limit,
    select: { id: true, title: true, source: true, count: true, status: true, lastSeenAt: true },
  });
  return groups;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export { round as roundRate };
