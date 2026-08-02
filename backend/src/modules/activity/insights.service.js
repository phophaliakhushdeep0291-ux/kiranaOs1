import db from "../../db.js";
import { ACTIVITY_EVENTS, AGGREGATE_KINDS } from "./activity.events.js";
import { SHOP_SCOPE, parseMetadata, topAggregates } from "./activity.service.js";
import { getReplenishmentSuggestions } from "./personalization.service.js";

/**
 * The AI learning layer (§13). Every question the spec lists is answered here as
 * a *deterministic* computation over recorded activity and real business data.
 *
 * The AI does not learn a model and does not guess. It routes a question to one
 * of these calculations and narrates the result — the same contract the
 * diagnostics assistant already follows, and the reason its answers can be
 * trusted with a shopkeeper's inventory money. Each insight returns its own
 * evidence, so any number on screen can be traced back to what produced it.
 *
 * When there is not enough history, an insight says so. "I don't have enough
 * data yet" is a correct answer; a confident ranking built on four events is not.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EVIDENCE = 5;

/** The closed set of insight keys, so the client and the assistant agree. */
export const INSIGHTS = Object.freeze({
  TOP_PRODUCTS: "top_products",
  TOP_REPORTS: "top_reports",
  SLOWEST_TASKS: "slowest_tasks",
  PEAK_HOURS: "peak_hours",
  REORDER: "reorder",
  LAPSING_CUSTOMERS: "lapsing_customers",
  ONLINE_VIEWED_NOT_BOUGHT: "online_viewed_not_bought",
  CHECKOUT_DROP_OFF: "checkout_drop_off",
});

function insufficient(insight, note) {
  return { insight, sufficientData: false, note, items: [] };
}

/**
 * "What products do I sell the most?" — the user's own history, falling back to
 * the shop's when they are new to the counter.
 */
export async function topProductsInsight({ shopId, userId, limit = 10 }, client = db) {
  const own = await topAggregates(client, { shopId, userId, kind: AGGREGATE_KINDS.PRODUCT_BILLED, limit });
  const rows = own.length ? own : await topAggregates(client, { shopId, userId: SHOP_SCOPE, kind: AGGREGATE_KINDS.PRODUCT_BILLED, limit });
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total < MIN_EVIDENCE) return insufficient(INSIGHTS.TOP_PRODUCTS, "Not enough billing history yet.");
  return {
    insight: INSIGHTS.TOP_PRODUCTS,
    sufficientData: true,
    scope: own.length ? "user" : "shop",
    items: rows.map((row) => ({ productId: row.key, name: row.label ?? row.key, timesBilled: row.count, lastAt: row.lastSeenAt })),
  };
}

/** "Which reports do I access most frequently?" */
export async function topReportsInsight({ shopId, userId, limit = 10 }, client = db) {
  const rows = await topAggregates(client, { shopId, userId, kind: AGGREGATE_KINDS.REPORT, limit });
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total < MIN_EVIDENCE) return insufficient(INSIGHTS.TOP_REPORTS, "Not enough report history yet.");
  return {
    insight: INSIGHTS.TOP_REPORTS,
    sufficientData: true,
    items: rows.map((row) => ({ report: row.key, label: row.label ?? row.key, opened: row.count, lastAt: row.lastSeenAt })),
  };
}

/**
 * "Which tasks consume the most time?" — ranked by total time spent, not by the
 * slowest single run. A 40-second task done 200 times a day costs the shop far
 * more than a 5-minute one done monthly.
 */
export async function slowestTasksInsight({ shopId, limit = 10 }, client = db) {
  const rows = await client.activityAggregate.findMany({
    where: { shopId, userId: SHOP_SCOPE, kind: AGGREGATE_KINDS.TASK_TIME, durationSamples: { gt: 0 } },
    take: 100,
  });
  if (rows.length === 0) return insufficient(INSIGHTS.SLOWEST_TASKS, "No timed tasks recorded yet.");
  const items = rows
    .map((row) => ({
      task: row.key,
      label: row.label ?? row.key,
      samples: row.durationSamples,
      averageMs: Math.round(row.totalMs / row.durationSamples),
      totalMs: row.totalMs,
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, limit);
  return { insight: INSIGHTS.SLOWEST_TASKS, sufficientData: true, items };
}

/**
 * "What are my peak business hours?" — from BILLS, not from activity.
 *
 * Bills are the authoritative record of trade and go back to the shop's first
 * day, whereas activity only starts when this feature ships. Using activity here
 * would tell a five-year-old store it has two weeks of history.
 */
export async function peakHoursInsight({ shopId, days = 30 }, client = db) {
  const since = new Date(Date.now() - days * DAY_MS);
  const bills = await client.bill.findMany({
    where: { shopId, status: "active", createdAt: { gte: since } },
    select: { createdAt: true, grandTotal: true },
    take: 20000,
  });
  if (bills.length < MIN_EVIDENCE) return insufficient(INSIGHTS.PEAK_HOURS, "Not enough bills in this period.");

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, bills: 0, sales: 0 }));
  const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, bills: 0, sales: 0 }));
  for (const bill of bills) {
    const at = new Date(bill.createdAt);
    const amount = Number(bill.grandTotal) || 0;
    hours[at.getHours()].bills += 1;
    hours[at.getHours()].sales += amount;
    weekdays[at.getDay()].bills += 1;
    weekdays[at.getDay()].sales += amount;
  }
  const busiest = [...hours].sort((a, b) => b.bills - a.bills).slice(0, 3);
  return {
    insight: INSIGHTS.PEAK_HOURS,
    sufficientData: true,
    windowDays: days,
    totalBills: bills.length,
    byHour: hours,
    byWeekday: weekdays,
    peakHours: busiest,
    items: busiest.map((row) => ({ hour: row.hour, bills: row.bills, label: `${String(row.hour).padStart(2, "0")}:00–${String((row.hour + 1) % 24).padStart(2, "0")}:00` })),
  };
}

/** "Which products should I reorder?" — the deterministic engine, activity-ranked. */
export async function reorderInsight({ shopId, limit = 10 }, client = db) {
  const items = await getReplenishmentSuggestions({ shopId, limit }, { client });
  if (items.length === 0) return insufficient(INSIGHTS.REORDER, "Nothing needs reordering right now.");
  return { insight: INSIGHTS.REORDER, sufficientData: true, items };
}

/**
 * "Which customers have reduced their visits?" — compares a customer's bill
 * count in the recent window against the window before it.
 *
 * Read from bills rather than activity, for the same reason as peak hours, and
 * because a *visit* is a purchase, not a screen the cashier opened. Only
 * customers with a real prior habit are considered: dropping from 1 visit to 0
 * is not a trend.
 */
export async function lapsingCustomersInsight({ shopId, days = 30, limit = 10 }, client = db) {
  const now = Date.now();
  const recentStart = new Date(now - days * DAY_MS);
  const priorStart = new Date(now - 2 * days * DAY_MS);

  const [recent, prior] = await Promise.all([
    client.bill.groupBy({
      by: ["customerId"],
      where: { shopId, status: "active", customerId: { not: null }, createdAt: { gte: recentStart } },
      _count: { _all: true },
    }),
    client.bill.groupBy({
      by: ["customerId"],
      where: { shopId, status: "active", customerId: { not: null }, createdAt: { gte: priorStart, lt: recentStart } },
      _count: { _all: true },
    }),
  ]);

  const recentCounts = new Map(recent.map((row) => [row.customerId, row._count._all]));
  const candidates = prior
    .map((row) => ({ customerId: row.customerId, before: row._count._all, after: recentCounts.get(row.customerId) ?? 0 }))
    // A regular is someone who came at least three times in the prior window.
    .filter((row) => row.before >= 3 && row.after < row.before)
    .map((row) => ({ ...row, dropRatio: (row.before - row.after) / row.before }))
    .sort((a, b) => b.dropRatio - a.dropRatio || b.before - a.before)
    .slice(0, limit);

  if (candidates.length === 0) return insufficient(INSIGHTS.LAPSING_CUSTOMERS, "No regular customer has reduced their visits.");

  const customers = await client.customer.findMany({
    where: { shopId, id: { in: candidates.map((row) => row.customerId) } },
    select: { id: true, name: true, phone: true },
  });
  const nameById = new Map(customers.map((row) => [row.id, row]));

  return {
    insight: INSIGHTS.LAPSING_CUSTOMERS,
    sufficientData: true,
    windowDays: days,
    items: candidates.map((row) => ({
      customerId: row.customerId,
      name: nameById.get(row.customerId)?.name ?? "Customer",
      visitsBefore: row.before,
      visitsAfter: row.after,
      dropPercent: Math.round(row.dropRatio * 100),
    })),
  };
}

/**
 * "Which products are frequently viewed but not purchased online?" — interest
 * without conversion, i.e. the price, photo or stock status is the problem.
 */
export async function onlineViewedNotBoughtInsight({ shopId, limit = 10 }, client = db) {
  const [views, cartAdds] = await Promise.all([
    topAggregates(client, { shopId, userId: SHOP_SCOPE, kind: AGGREGATE_KINDS.ONLINE_PRODUCT_VIEW, limit: 200 }),
    topAggregates(client, { shopId, userId: SHOP_SCOPE, kind: AGGREGATE_KINDS.ONLINE_CART_ADD, limit: 200 }),
  ]);
  const addsByProduct = new Map(cartAdds.map((row) => [row.key, row.count]));
  const items = views
    // Below five views a zero-conversion product is just a product nobody has
    // seen yet, which is a different problem with a different fix.
    .filter((row) => row.count >= MIN_EVIDENCE)
    .map((row) => {
      const adds = addsByProduct.get(row.key) ?? 0;
      return {
        productId: row.key,
        name: row.label ?? row.key,
        views: row.count,
        cartAdds: adds,
        conversionRate: Math.round((adds / row.count) * 1000) / 1000,
      };
    })
    .filter((row) => row.conversionRate < 0.2)
    .sort((a, b) => a.conversionRate - b.conversionRate || b.views - a.views)
    .slice(0, limit);

  if (items.length === 0) return insufficient(INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT, "Not enough online browsing data yet.");
  return { insight: INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT, sufficientData: true, items };
}

/**
 * "Where are customers dropping off during checkout?" — the online funnel,
 * stage by stage, with the biggest single leak named.
 */
export async function checkoutDropOffInsight({ shopId, days = 30 }, client = db) {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await client.activityEvent.groupBy({
    by: ["eventType"],
    where: {
      shopId,
      occurredAt: { gte: since },
      eventType: {
        in: [
          ACTIVITY_EVENTS.ONLINE_SESSION_START,
          ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW,
          ACTIVITY_EVENTS.ONLINE_CART_ADD,
          ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED,
          ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED,
          ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED,
        ],
      },
    },
    _count: { _all: true },
  });
  const by = Object.fromEntries(rows.map((row) => [row.eventType, row._count._all]));
  const stages = [
    { stage: "session", label: "Opened the store", count: by[ACTIVITY_EVENTS.ONLINE_SESSION_START] ?? 0 },
    { stage: "browse", label: "Viewed a product", count: by[ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW] ?? 0 },
    { stage: "cart", label: "Added to cart", count: by[ACTIVITY_EVENTS.ONLINE_CART_ADD] ?? 0 },
    { stage: "checkout", label: "Started checkout", count: by[ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED] ?? 0 },
    { stage: "done", label: "Completed the order", count: by[ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED] ?? 0 },
  ];
  if ((stages[0].count ?? 0) < MIN_EVIDENCE) return insufficient(INSIGHTS.CHECKOUT_DROP_OFF, "Not enough online sessions yet.");

  let worst = null;
  for (let i = 1; i < stages.length; i += 1) {
    const from = stages[i - 1];
    const to = stages[i];
    if (from.count <= 0) continue;
    const lost = Math.max(0, from.count - to.count);
    const rate = lost / from.count;
    stages[i].dropFromPreviousRate = Math.round(rate * 1000) / 1000;
    if (!worst || rate > worst.rate) worst = { from: from.stage, to: to.stage, label: `${from.label} → ${to.label}`, lost, rate: Math.round(rate * 1000) / 1000 };
  }

  return {
    insight: INSIGHTS.CHECKOUT_DROP_OFF,
    sufficientData: true,
    windowDays: days,
    stages,
    biggestDropOff: worst,
    paymentFailures: by[ACTIVITY_EVENTS.ONLINE_PAYMENT_FAILED] ?? 0,
    items: stages,
  };
}

/** Everything at once, for the insights panel. */
export async function getAllInsights({ shopId, userId, days = 30, limit = 10 }, { client = db } = {}) {
  const [topProducts, topReports, slowestTasks, peakHours, reorder, lapsing, viewedNotBought, dropOff] = await Promise.all([
    topProductsInsight({ shopId, userId, limit }, client).catch(() => insufficient(INSIGHTS.TOP_PRODUCTS, "Unavailable.")),
    topReportsInsight({ shopId, userId, limit }, client).catch(() => insufficient(INSIGHTS.TOP_REPORTS, "Unavailable.")),
    slowestTasksInsight({ shopId, limit }, client).catch(() => insufficient(INSIGHTS.SLOWEST_TASKS, "Unavailable.")),
    peakHoursInsight({ shopId, days }, client).catch(() => insufficient(INSIGHTS.PEAK_HOURS, "Unavailable.")),
    reorderInsight({ shopId, limit }, client).catch(() => insufficient(INSIGHTS.REORDER, "Unavailable.")),
    lapsingCustomersInsight({ shopId, days, limit }, client).catch(() => insufficient(INSIGHTS.LAPSING_CUSTOMERS, "Unavailable.")),
    onlineViewedNotBoughtInsight({ shopId, limit }, client).catch(() => insufficient(INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT, "Unavailable.")),
    checkoutDropOffInsight({ shopId, days }, client).catch(() => insufficient(INSIGHTS.CHECKOUT_DROP_OFF, "Unavailable.")),
  ]);
  return { generatedAt: new Date().toISOString(), windowDays: days, topProducts, topReports, slowestTasks, peakHours, reorder, lapsingCustomers: lapsing, onlineViewedNotBought: viewedNotBought, checkoutDropOff: dropOff };
}

// ── Question routing ─────────────────────────────────────────────────────────
// Matched in order; the first hit wins. Ordered most-specific first so
// "which products should I reorder" does not get caught by the products rule.
const QUESTION_RULES = [
  [/reorder|restock|replenish|running (out|low)|order more|buy more/i, INSIGHTS.REORDER],
  [/viewed.*(not|never).*(bought|purchas|order)|browse.*not buy|look.*not buy|interest.*no.*sale/i, INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT],
  // `drop\w*` so "drop-off", "dropoff" and "dropping off" all match.
  [/drop\w*[\s-]?off|drop\w*[\s-]?out|abandon|leaving|leave.*checkout|checkout.*(problem|issue|stage|funnel)|where.*(lose|losing).*customer/i, INSIGHTS.CHECKOUT_DROP_OFF],
  [/(reduc|drop|fewer|less|stopped|lapsed|churn).*(visit|customer)|customer.*(reduc|stopped|lapsed|not com|less often)/i, INSIGHTS.LAPSING_CUSTOMERS],
  [/peak|busiest|busy (hour|time|day)|rush|what time|which hour|best time/i, INSIGHTS.PEAK_HOURS],
  [/(task|step|screen|action).*(time|slow|long)|time.*(consum|spend|takes)|what takes.*long/i, INSIGHTS.SLOWEST_TASKS],
  [/report.*(most|often|frequent|use)|which report|favourite report|favorite report/i, INSIGHTS.TOP_REPORTS],
  [/(sell|sold|selling|bill).*(most|top|best)|top.*(product|item|seller)|best.?sell|most.*(sold|billed)/i, INSIGHTS.TOP_PRODUCTS],
];

/**
 * classifyInsightQuestion — does this question belong to the learning layer?
 * Returns an insight key, or null so the caller falls through to its existing
 * intents rather than answering a support question with a product ranking.
 */
export function classifyInsightQuestion(question = "") {
  const q = String(question);
  for (const [pattern, insight] of QUESTION_RULES) {
    if (pattern.test(q)) return insight;
  }
  return null;
}

/** Run one insight by key. */
export async function runInsight(insight, { shopId, userId, days = 30, limit = 10 }, { client = db } = {}) {
  switch (insight) {
    case INSIGHTS.TOP_PRODUCTS: return topProductsInsight({ shopId, userId, limit }, client);
    case INSIGHTS.TOP_REPORTS: return topReportsInsight({ shopId, userId, limit }, client);
    case INSIGHTS.SLOWEST_TASKS: return slowestTasksInsight({ shopId, limit }, client);
    case INSIGHTS.PEAK_HOURS: return peakHoursInsight({ shopId, days }, client);
    case INSIGHTS.REORDER: return reorderInsight({ shopId, limit }, client);
    case INSIGHTS.LAPSING_CUSTOMERS: return lapsingCustomersInsight({ shopId, days, limit }, client);
    case INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT: return onlineViewedNotBoughtInsight({ shopId, limit }, client);
    case INSIGHTS.CHECKOUT_DROP_OFF: return checkoutDropOffInsight({ shopId, days }, client);
    default: return null;
  }
}

/**
 * narrateInsight — turn a computed insight into the assistant's answer shape.
 * Phrasing only: every number comes from the computation, and an insight that
 * lacks data says so instead of being smoothed over.
 */
export function narrateInsight(result) {
  if (!result) return null;
  if (!result.sufficientData) {
    return { topic: "Business insight", answer: result.note ?? "I don't have enough history for that yet.", steps: [], data: result, confidence: 0.4, confidenceLabel: "low", resolved: false };
  }

  const steps = [];
  let answer = "";
  switch (result.insight) {
    case INSIGHTS.TOP_PRODUCTS:
      answer = result.scope === "user" ? "These are the products you bill most often." : "These are the products this shop bills most often.";
      steps.push(...result.items.slice(0, 5).map((row, index) => `${index + 1}. ${row.name} — ${row.timesBilled} time(s)`));
      break;
    case INSIGHTS.TOP_REPORTS:
      answer = "These are the reports you open most often.";
      steps.push(...result.items.slice(0, 5).map((row, index) => `${index + 1}. ${row.label} — opened ${row.opened} time(s)`));
      break;
    case INSIGHTS.SLOWEST_TASKS:
      answer = "These tasks take up the most of your time, by total time spent.";
      steps.push(...result.items.slice(0, 5).map((row) => `${row.label} — ${formatDuration(row.averageMs)} average across ${row.samples} run(s)`));
      break;
    case INSIGHTS.PEAK_HOURS:
      answer = `Across the last ${result.windowDays} days and ${result.totalBills} bills, your busiest hours are ${result.peakHours.map((row) => `${String(row.hour).padStart(2, "0")}:00`).join(", ")}.`;
      steps.push(...result.peakHours.map((row) => `${String(row.hour).padStart(2, "0")}:00–${String((row.hour + 1) % 24).padStart(2, "0")}:00 — ${row.bills} bill(s)`));
      break;
    case INSIGHTS.REORDER:
      answer = `${result.items.length} product(s) need replenishing.`;
      steps.push(...result.items.slice(0, 5).map((row) => `${row.productName} — order ${row.recommendedOrderBaseQty} ${row.baseUnit}${row.coverageDaysRemaining !== null ? ` (about ${row.coverageDaysRemaining} day(s) of stock left)` : ""}`));
      break;
    case INSIGHTS.LAPSING_CUSTOMERS:
      answer = `${result.items.length} regular customer(s) are visiting less than they did in the previous ${result.windowDays} days.`;
      steps.push(...result.items.slice(0, 5).map((row) => `${row.name} — ${row.visitsBefore} visit(s) before, ${row.visitsAfter} now (down ${row.dropPercent}%)`));
      break;
    case INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT:
      answer = "These products get looked at online but rarely make it into a cart.";
      steps.push(...result.items.slice(0, 5).map((row) => `${row.name} — ${row.views} view(s), ${row.cartAdds} cart add(s)`));
      break;
    case INSIGHTS.CHECKOUT_DROP_OFF:
      answer = result.biggestDropOff
        ? `The biggest drop-off is ${result.biggestDropOff.label} — ${Math.round(result.biggestDropOff.rate * 100)}% do not continue.`
        : "Your online funnel has no significant drop-off.";
      steps.push(...result.stages.map((row) => `${row.label}: ${row.count}`));
      break;
    default:
      answer = "Here is what your activity shows.";
  }

  return { topic: "Business insight", answer, steps, data: result, confidence: 0.85, confidenceLabel: "high", resolved: true };
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  return `${Math.round(ms / 6000) / 10}min`;
}
