import db from "../../db.js";
import { getReorderSuggestions } from "../purchase-orders/purchaseOrders.service.js";
import { ACTIVITY_EVENTS, AGGREGATE_KINDS } from "./activity.events.js";
import { SHOP_SCOPE, parseMetadata, topAggregates } from "./activity.service.js";

/**
 * Personalization (§13 "Personalized Experience").
 *
 * Everything here is a *suggestion layer*. Three rules keep it honest:
 *
 *  1. It only ever reorders, pre-fills or highlights. It never hides a product,
 *     never changes a price, and never decides anything the user cannot undo in
 *     one tap. A wrong guess must cost a shopkeeper a second, not a sale.
 *  2. Nothing is invented. Every suggestion traces to counted behaviour or to an
 *     existing deterministic engine (replenishment reuses the reviewable
 *     purchase-order calculator rather than a second, divergent forecast).
 *  3. Cold start is a first-class case, not an afterthought. A shop on day one
 *     has no history, so each block degrades to "empty" and the UI falls back to
 *     its normal ordering instead of showing a confidently wrong guess.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Below this many observations a ranking is noise dressed up as insight — one
 * accidental double-tap would define a user's "favourite" product. Blocks under
 * the floor are returned empty with `sufficientData: false` so the client knows
 * to keep its default ordering.
 */
const MIN_OBSERVATIONS = 3;

export async function getPersonalization({ shopId, userId, limit = 10 }, { client = db } = {}) {
  const now = new Date();
  const forUser = (kind, take = limit) => topAggregates(client, { shopId, userId, kind, limit: take, now });
  const forShop = (kind, take = limit) => topAggregates(client, { shopId, userId: SHOP_SCOPE, kind, limit: take, now });

  const [
    userProducts,
    shopProducts,
    searchQueries,
    customers,
    paymentMethods,
    filters,
    pages,
    features,
    pairs,
    onlineViews,
    onlineCartAdds,
    abandoned,
  ] = await Promise.all([
    forUser(AGGREGATE_KINDS.PRODUCT_BILLED, limit * 2),
    forShop(AGGREGATE_KINDS.PRODUCT_BILLED, limit * 2),
    forUser(AGGREGATE_KINDS.SEARCH_QUERY, 20),
    forUser(AGGREGATE_KINDS.CUSTOMER, limit),
    forUser(AGGREGATE_KINDS.PAYMENT_METHOD, 5),
    forUser(AGGREGATE_KINDS.FILTER, 20),
    forUser(AGGREGATE_KINDS.PAGE, 20),
    forUser(AGGREGATE_KINDS.FEATURE, 20),
    forShop(AGGREGATE_KINDS.PRODUCT_PAIR, 60),
    forShop(AGGREGATE_KINDS.ONLINE_PRODUCT_VIEW, limit * 2),
    forShop(AGGREGATE_KINDS.ONLINE_CART_ADD, limit * 2),
    forShop(AGGREGATE_KINDS.ABANDONED_CART, limit),
  ]);

  const predicted = await predictNextProducts({ shopId, userId, now, limit }, client);

  return {
    generatedAt: now.toISOString(),
    // "Prioritizing frequently sold products": the user's own history leads, the
    // shop's fills in behind it. A new cashier on an established counter gets
    // useful suggestions from day one instead of an empty row.
    quickProducts: blend(userProducts, shopProducts, limit),
    // "Intelligent auto-complete": past queries that actually led somewhere.
    searchSuggestions: gate(searchQueries).map((row) => ({ query: row.key, count: row.count, score: round(row.score) })),
    frequentCustomers: gate(customers).map(entry),
    preferredPaymentMethod: paymentMethods[0]?.key ?? null,
    paymentMethods: paymentMethods.map(entry),
    // "Retaining preferred filters", keyed by screen so the products screen does
    // not inherit the reports screen's filters.
    preferredFilters: groupFiltersByScreen(filters),
    // "Dynamically reordering dashboard widgets based on usage patterns".
    dashboardOrder: dashboardOrder(pages, features),
    // "Suggesting commonly purchased product combinations".
    productCombos: comboIndex(pairs),
    // "Predicting likely products for upcoming billing actions".
    predictedProducts: predicted,
    // "Suggesting products based on online browsing behaviour" and
    // "Highlighting trending products based on online sessions".
    onlineTrending: gate(onlineViews).map(entry),
    onlineCartTrending: gate(onlineCartAdds).map(entry),
    // "Sending reminders for abandoned carts" — the raw material for the nudge;
    // sending the message stays an explicit user action, never automatic.
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

/** Drop a whole block when the evidence behind it is too thin to rank. */
function gate(rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return total >= MIN_OBSERVATIONS ? rows : [];
}

function entry(row) {
  return { key: row.key, label: row.label ?? row.key, count: row.count, score: round(row.score), lastSeenAt: row.lastSeenAt };
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

/**
 * Merge the user's ranking with the shop's, personal first. The shop score is
 * halved rather than dropped so a genuinely dominant shop-wide seller can still
 * appear above a user's third-favourite item.
 */
function blend(userRows, shopRows, limit) {
  const merged = new Map();
  for (const row of userRows) merged.set(row.key, { ...entry(row), source: "user", rank: row.score });
  for (const row of shopRows) {
    const existing = merged.get(row.key);
    if (existing) {
      existing.rank += row.score * 0.5;
      existing.source = "both";
      continue;
    }
    merged.set(row.key, { ...entry(row), source: "shop", rank: row.score * 0.5 });
  }
  const rows = [...merged.values()];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total < MIN_OBSERVATIONS) return [];
  return rows
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ rank, ...rest }) => rest);
}

function groupFiltersByScreen(rows) {
  const byScreen = {};
  for (const row of rows) {
    // Keys are stored as "<screen>:<filter>".
    const separator = row.key.indexOf(":");
    if (separator <= 0) continue;
    const screen = row.key.slice(0, separator);
    const filter = row.key.slice(separator + 1);
    // Only filters the user reaches for repeatedly are worth restoring; one-off
    // filters would make the screen feel like it never resets.
    if (row.count < MIN_OBSERVATIONS) continue;
    (byScreen[screen] ??= []).push({ filter, count: row.count, score: round(row.score) });
  }
  for (const list of Object.values(byScreen)) list.sort((a, b) => b.score - a.score);
  return byScreen;
}

/**
 * Widget order = how much the user actually uses each area. Returned as a
 * ranked list of keys; the dashboard keeps its own default order for anything
 * not listed, so a new widget never disappears just because it has no history.
 */
function dashboardOrder(pages, features) {
  const scored = new Map();
  for (const row of pages) scored.set(row.key, (scored.get(row.key) ?? 0) + row.score);
  for (const row of features) scored.set(row.key, (scored.get(row.key) ?? 0) + row.score);
  return [...scored.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, score]) => ({ key, score: round(score) }));
}

/**
 * Turn the flat pair counters into "given product A, suggest B" so the billing
 * screen can look up the cart's last line in O(1) instead of scanning.
 */
function comboIndex(pairs) {
  const index = {};
  for (const row of pairs) {
    if (row.count < MIN_OBSERVATIONS) continue;
    const [a, b] = row.key.split("|");
    if (!a || !b) continue;
    (index[a] ??= []).push({ productId: b, count: row.count, score: round(row.score) });
    (index[b] ??= []).push({ productId: a, count: row.count, score: round(row.score) });
  }
  for (const list of Object.values(index)) {
    list.sort((x, y) => y.score - x.score);
    list.splice(5);
  }
  return index;
}

/**
 * predictNextProducts — what this user tends to bill at this time of day.
 *
 * Shop trade is strongly time-shaped (milk and bread at 7am, snacks at 6pm), so
 * an hour-of-day window is a far better predictor than an all-day ranking and is
 * still fully explainable: it is a count of what they added to bills in this
 * hour band over the window. ±1 hour keeps the sample usable in a quiet store.
 */
async function predictNextProducts({ shopId, userId, now, limit }, client) {
  const since = new Date(now.getTime() - 60 * DAY_MS);
  const rows = await client.activityEvent.findMany({
    where: { shopId, userId, eventType: ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, occurredAt: { gte: since } },
    orderBy: { occurredAt: "desc" },
    take: 2000,
    select: { metadataJson: true, occurredAt: true },
  });

  const hour = now.getHours();
  const counts = new Map();
  for (const row of rows) {
    const rowHour = new Date(row.occurredAt).getHours();
    // Circular distance, so 23:00 and 00:00 are neighbours.
    const distance = Math.min(Math.abs(rowHour - hour), 24 - Math.abs(rowHour - hour));
    if (distance > 1) continue;
    const meta = parseMetadata(row.metadataJson);
    const productId = meta.productId ? String(meta.productId) : null;
    if (!productId) continue;
    const current = counts.get(productId) ?? { productId, label: meta.productName ?? null, count: 0 };
    current.count += 1;
    if (!current.label && meta.productName) current.label = meta.productName;
    counts.set(productId, current);
  }

  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  const total = ranked.reduce((sum, row) => sum + row.count, 0);
  if (total < MIN_OBSERVATIONS) return { hour, sufficientData: false, products: [] };
  return {
    hour,
    sufficientData: true,
    products: ranked.slice(0, limit).map((row) => ({ ...row, label: row.label ?? row.productId })),
  };
}

/**
 * getReplenishmentSuggestions — the spec's "recommend replenishment prior to
 * stock depletion", ranked by how much this shop actually sells the item.
 *
 * The quantities and the reasoning come from the existing deterministic
 * purchase-order calculator — activity only decides *ordering*. A second
 * forecast here would eventually disagree with the purchase-order screen, and
 * two different answers to "how much should I buy" is worse than one.
 */
export async function getReplenishmentSuggestions({ shopId, limit = 10 }, { client = db } = {}) {
  const [suggestions, billed] = await Promise.all([
    getReorderSuggestions(shopId).catch(() => []),
    topAggregates(client, { shopId, userId: SHOP_SCOPE, kind: AGGREGATE_KINDS.PRODUCT_BILLED, limit: 200 }),
  ]);
  const activityScore = new Map(billed.map((row) => [row.key, row.score]));
  return suggestions
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      baseUnit: row.baseUnit,
      stockBaseQty: row.stockBaseQty,
      recommendedOrderBaseQty: row.recommendedOrderBaseQty,
      coverageDaysRemaining: row.coverageDaysRemaining,
      forecastConfidence: row.forecastConfidence,
      reason: row.explanation,
      supplierName: row.supplierName ?? null,
      activityScore: round(activityScore.get(row.productId) ?? 0),
    }))
    .sort((a, b) => {
      // Depletion first — an item about to run out is more urgent than a
      // popular one that is still well stocked — then popularity.
      const coverageA = a.coverageDaysRemaining ?? Number.POSITIVE_INFINITY;
      const coverageB = b.coverageDaysRemaining ?? Number.POSITIVE_INFINITY;
      if (coverageA !== coverageB) return coverageA - coverageB;
      return b.activityScore - a.activityScore;
    })
    .slice(0, limit);
}
