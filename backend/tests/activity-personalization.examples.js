import assert from "node:assert/strict";
import db from "../src/db.js";
import { ACTIVITY_EVENTS, AGGREGATE_KINDS, isKnownEventType, isOnlineEventType } from "../src/modules/activity/activity.events.js";
import { decayScore, getRecentActivity, recordActivityBatch } from "../src/modules/activity/activity.service.js";
import { getPersonalization } from "../src/modules/activity/personalization.service.js";
import { getActivityAnalytics } from "../src/modules/activity/analytics.service.js";
import { classifyInsightQuestion, INSIGHTS, runInsight, narrateInsight } from "../src/modules/activity/insights.service.js";
import { recordOnlineActivity } from "../src/modules/activity/online-activity.service.js";

// Proves the §13 activity + personalization engine: ingest is idempotent and
// tenant-scoped, aggregation feeds the personalization surfaces, PII in a typed
// search query is redacted before it is stored, the online funnel is computed
// from real events, and the learning layer answers the spec's questions from
// counted behaviour rather than from a guess.

const suffix = `activity-test-${Date.now()}`;
let shopA;
let shopB;
const userA = `user-a-${suffix}`;
const userB = `user-b-${suffix}`;

let counter = 0;
function evt(eventType, metadata = {}, extra = {}) {
  counter += 1;
  return {
    eventId: `${suffix}-evt-${counter}`,
    eventType,
    occurredAt: new Date().toISOString(),
    sessionId: extra.sessionId ?? `${suffix}-session`,
    screen: extra.screen ?? "/billing",
    appVersion: "1.4.0",
    networkStatus: "online",
    durationMs: extra.durationMs,
    metadata,
  };
}

async function main() {
  shopA = await db.shop.create({
    data: {
      name: `A ${suffix}`,
      ownerName: "A",
      city: "X",
      address: "Y",
      settingsJson: JSON.stringify({ customerOrdering: { enabled: true } }),
    },
  });
  shopB = await db.shop.create({ data: { name: `B ${suffix}`, ownerName: "B", city: "X", address: "Y" } });

  const ctxA = { shopId: shopA.id, userId: userA, deviceId: "device-1", source: "pos" };

  // 1) Ingest is idempotent — the same eventId delivered twice (an offline device
  //    retrying a batch it already sent) must not double-count.
  const duplicated = evt(ACTIVITY_EVENTS.APP_LAUNCH);
  const first = await recordActivityBatch([duplicated], ctxA);
  const second = await recordActivityBatch([duplicated], ctxA);
  assert.equal(first.accepted, 1, "first delivery is accepted");
  assert.equal(second.accepted, 0, "retry is not accepted again");
  assert.equal(second.duplicates, 1, "retry is counted as a duplicate");
  assert.equal(await db.activityEvent.count({ where: { eventId: duplicated.eventId } }), 1, "exactly one row persisted");

  // 2) An unknown event type is rejected rather than silently inventing a new
  //    bucket in every analytics surface.
  const bogus = await recordActivityBatch([{ ...evt(ACTIVITY_EVENTS.APP_LAUNCH), eventType: "TOTALLY_MADE_UP" }], ctxA);
  assert.equal(bogus.accepted, 0, "unknown event type is not stored");
  assert.equal(bogus.rejected, 1, "unknown event type is counted as rejected");
  assert.equal(isKnownEventType("TOTALLY_MADE_UP"), false, "catalogue is closed");

  //    …and one bad event costs only itself. A client one release ahead sends a
  //    new event type; losing that user's whole batch over it would be far worse
  //    than losing the one event we cannot interpret.
  const mixed = await recordActivityBatch(
    [
      { ...evt(ACTIVITY_EVENTS.APP_LAUNCH), eventType: "STILL_MADE_UP" },
      evt(ACTIVITY_EVENTS.SCREEN_VIEW, {}, { screen: "/dashboard" }),
      { ...evt(ACTIVITY_EVENTS.SCREEN_VIEW), eventId: "" }, // malformed: no id
      evt(ACTIVITY_EVENTS.SCREEN_VIEW, {}, { screen: "/reports" }),
    ],
    ctxA,
  );
  assert.equal(mixed.accepted, 2, "the valid events in a mixed batch still land");
  assert.equal(mixed.rejected, 2, "only the unusable events are dropped");

  // 3) A typed search query is sanitized before storage — this is the one field a
  //    human types, so it is where a phone number leaks in.
  await recordActivityBatch(
    [evt(ACTIVITY_EVENTS.PRODUCT_SEARCH, { query: "call 9876543210 or owner@example.com", results: 0 }, { durationMs: 400 })],
    ctxA,
  );
  const searchRow = await db.activityEvent.findFirst({
    where: { shopId: shopA.id, eventType: ACTIVITY_EVENTS.PRODUCT_SEARCH },
    orderBy: { createdAt: "desc" },
  });
  for (const secret of ["9876543210", "owner@example.com"]) {
    assert.ok(!searchRow.metadataJson.includes(secret), `search metadata must not leak ${secret}`);
  }

  // 4) Aggregation — billing the same product repeatedly makes it this user's top
  //    quick-add, and the basket writes pair counters for "bought together".
  const milk = "prod-milk";
  const bread = "prod-bread";
  const soap = "prod-soap";
  const billingEvents = [];
  for (let i = 0; i < 6; i += 1) {
    billingEvents.push(evt(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: milk, productName: "Milk 500ml" }));
    billingEvents.push(evt(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: bread, productName: "Bread" }));
    billingEvents.push(
      evt(
        ACTIVITY_EVENTS.BILL_CREATED,
        { productIds: [milk, bread], paymentMethod: "cash", billId: `bill-${i}` },
        { durationMs: 42_000 },
      ),
    );
  }
  // Milk is billed on its own as well, so it strictly outranks bread rather than
  // tying with it — a tie would make the ordering assertion below meaningless.
  for (let i = 0; i < 3; i += 1) {
    billingEvents.push(evt(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: milk, productName: "Milk 500ml" }));
  }
  billingEvents.push(evt(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: soap, productName: "Soap" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.CUSTOMER_SELECTED, { customerId: "cust-1", customerName: "Ramesh" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.CUSTOMER_SELECTED, { customerId: "cust-1", customerName: "Ramesh" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.CUSTOMER_SELECTED, { customerId: "cust-1", customerName: "Ramesh" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.REPORT_VIEW, { report: "gst", reportLabel: "GST report" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.REPORT_VIEW, { report: "gst", reportLabel: "GST report" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.REPORT_VIEW, { report: "sales", reportLabel: "Sales report" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.FEATURE_USED, { feature: "barcode_scan", featureLabel: "Barcode scan" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.VOICE_COMMAND_USED, { command: "add milk" }));
  billingEvents.push(evt(ACTIVITY_EVENTS.AI_ASSISTANT_QUERY, { question: "what do i sell most" }));

  // Batches are capped at 100 events, matching the ingest schema.
  for (let i = 0; i < billingEvents.length; i += 50) {
    await recordActivityBatch(billingEvents.slice(i, i + 50), ctxA);
  }

  const milkAggregate = await db.activityAggregate.findUnique({
    where: { shopId_userId_kind_key: { shopId: shopA.id, userId: userA, kind: AGGREGATE_KINDS.PRODUCT_BILLED, key: milk } },
  });
  assert.equal(milkAggregate.count, 9, "product counter reflects every add");

  const pairKey = [milk, bread].sort().join("|");
  const pairAggregate = await db.activityAggregate.findUnique({
    where: { shopId_userId_kind_key: { shopId: shopA.id, userId: "*", kind: AGGREGATE_KINDS.PRODUCT_PAIR, key: pairKey } },
  });
  assert.equal(pairAggregate.count, 6, "basket pairs are counted shop-wide");
  const userPair = await db.activityAggregate.findUnique({
    where: { shopId_userId_kind_key: { shopId: shopA.id, userId: userA, kind: AGGREGATE_KINDS.PRODUCT_PAIR, key: pairKey } },
  });
  assert.equal(userPair, null, "combinations are a shop property, not a staff member's");

  // 5) Recency decay — an old counter must rank below a fresh one with the same
  //    raw count, or seasonal stock would be suggested forever.
  const decayed = decayScore(10, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
  assert.ok(decayed < 10 && decayed > 0, "score decays toward zero without reaching it");
  assert.ok(decayed < decayScore(10, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)), "older means lower");

  // 6) Personalization reads the counters.
  const personal = await getPersonalization({ shopId: shopA.id, userId: userA });
  assert.equal(personal.quickProducts[0].key, milk, "most-billed product leads the quick row");
  assert.equal(personal.preferredPaymentMethod, "cash", "preferred payment method is learned");
  assert.ok(personal.frequentCustomers.some((row) => row.key === "cust-1"), "frequent customer is surfaced");
  assert.ok(personal.productCombos[milk]?.some((row) => row.productId === bread), "combo index maps milk → bread");

  // 7) Recent activity is chronological where the user expects "the last thing I
  //    typed", not a frequency ranking.
  const recent = await getRecentActivity({ shopId: shopA.id, userId: userA });
  assert.ok(Array.isArray(recent.recentSearches), "recent searches present");
  assert.ok(recent.frequentProducts.some((row) => row.key === milk), "frequent products present");
  assert.ok(recent.recentReports.some((row) => row.key === "gst"), "recent reports present");

  // 8) Tenant isolation — another shop's activity is never visible, and another
  //    user in the same shop keeps their own personal ranking.
  await recordActivityBatch(
    [evt(ACTIVITY_EVENTS.PRODUCT_ADDED_TO_BILL, { productId: "prod-other", productName: "Other" })],
    { shopId: shopB.id, userId: userB, source: "pos" },
  );
  const personalB = await getPersonalization({ shopId: shopB.id, userId: userB });
  assert.ok(!personalB.quickProducts.some((row) => row.key === milk), "shop B never sees shop A's products");
  const personalOtherUser = await getPersonalization({ shopId: shopA.id, userId: userB });
  assert.ok(
    !personalOtherUser.quickProducts.some((row) => row.source === "user"),
    "a second user has no personal history of their own yet",
  );
  assert.ok(
    personalOtherUser.quickProducts.some((row) => row.key === milk),
    "…but still gets the shop's ranking, so a new cashier is not left with an empty row",
  );

  // 9) The online funnel. These arrive through the PUBLIC endpoint with no user.
  const onlineSession = `${suffix}-online`;
  const onlineEvents = [];
  for (let i = 0; i < 6; i += 1) {
    onlineEvents.push(evt(ACTIVITY_EVENTS.ONLINE_SESSION_START, {}, { sessionId: `${onlineSession}-${i}`, screen: "/order" }));
    onlineEvents.push(evt(ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW, { productId: soap, productName: "Soap" }, { sessionId: `${onlineSession}-${i}` }));
  }
  onlineEvents.push(evt(ACTIVITY_EVENTS.ONLINE_CHECKOUT_STARTED, {}, { sessionId: `${onlineSession}-0` }));
  onlineEvents.push(evt(ACTIVITY_EVENTS.ONLINE_CHECKOUT_COMPLETED, {}, { sessionId: `${onlineSession}-0`, durationMs: 60_000 }));
  onlineEvents.push(
    evt(ACTIVITY_EVENTS.ONLINE_CART_ABANDONED, { itemCount: 3, total: 240 }, { sessionId: `${onlineSession}-1` }),
  );
  const onlineResult = await recordOnlineActivity(shopA.id, onlineEvents);
  assert.equal(onlineResult.accepted, onlineEvents.length, "all online events accepted");

  // A POS event pushed at the public endpoint is refused: an unauthenticated
  // caller must not be able to forge billing history.
  const forged = await recordOnlineActivity(shopA.id, [evt(ACTIVITY_EVENTS.BILL_CREATED, { productIds: [milk] })]);
  assert.equal(forged.accepted, 0, "public ingest refuses non-online event types");
  assert.equal(isOnlineEventType(ACTIVITY_EVENTS.BILL_CREATED), false, "BILL_CREATED is not an online event");

  const storedOnline = await db.activityEvent.findFirst({
    where: { shopId: shopA.id, eventType: ACTIVITY_EVENTS.ONLINE_SESSION_START },
  });
  assert.equal(storedOnline.userId, null, "an online shopper is never attributed to a staff member");
  assert.equal(storedOnline.source, "online", "online events are marked as such");

  // A shop that has not opted into customer ordering rejects the public write.
  await assert.rejects(
    () => recordOnlineActivity(shopB.id, [evt(ACTIVITY_EVENTS.ONLINE_SESSION_START)]),
    /not accepting online orders/i,
    "public ingest requires the owner's opt-in",
  );

  // 10) Business intelligence.
  const analytics = await getActivityAnalytics({ shopId: shopA.id, days: 30 });
  assert.equal(analytics.activeUsers.dau, 1, "one active user today");
  assert.equal(analytics.online.sessions, 6, "session count from real events");
  assert.equal(analytics.online.checkoutsCompleted, 1, "completed checkouts counted");
  assert.equal(analytics.online.conversionRate, 0.1667, "conversion = completed ÷ sessions, to 4 places");
  assert.equal(analytics.online.cartAbandonmentRate, 0.5, "abandonment = abandoned ÷ (abandoned + completed)");
  assert.equal(analytics.averageBillingTimeMs.averageMs, 42_000, "average billing time from timed events");
  assert.ok(analytics.voiceUsage.commands >= 1, "voice usage counted");
  assert.ok(analytics.aiUsage.queries >= 1, "AI usage counted");
  assert.ok(analytics.mostUsedFeatures.some((row) => row.feature === "barcode_scan"), "feature usage ranked");

  // A rate with an empty denominator is null, not a misleading 0%.
  const emptyAnalytics = await getActivityAnalytics({ shopId: shopB.id, days: 30 });
  assert.equal(emptyAnalytics.online.conversionRate, null, "no sessions means no conversion rate, not 0%");

  // 11) The learning layer routes each of the spec's questions to the right
  //     calculation, and answers from counted behaviour.
  const routes = [
    ["What products do I sell the most?", INSIGHTS.TOP_PRODUCTS],
    ["Which reports do I access most frequently?", INSIGHTS.TOP_REPORTS],
    ["Which tasks consume the most time?", INSIGHTS.SLOWEST_TASKS],
    ["What are my peak business hours?", INSIGHTS.PEAK_HOURS],
    ["Which products should I reorder?", INSIGHTS.REORDER],
    ["Which customers have reduced their visits?", INSIGHTS.LAPSING_CUSTOMERS],
    ["Which products are frequently viewed but not purchased online?", INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT],
    ["Where are customers dropping off during checkout?", INSIGHTS.CHECKOUT_DROP_OFF],
  ];
  for (const [question, expected] of routes) {
    assert.equal(classifyInsightQuestion(question), expected, `"${question}" routes to ${expected}`);
  }
  assert.equal(classifyInsightQuestion("why are my bills not syncing?"), null, "a support question is left to the support assistant");

  const topProducts = await runInsight(INSIGHTS.TOP_PRODUCTS, { shopId: shopA.id, userId: userA });
  assert.equal(topProducts.items[0].productId, milk, "top product is the one actually billed most");
  assert.equal(topProducts.scope, "user", "answered from the asker's own history");
  const narrated = narrateInsight(topProducts);
  assert.ok(narrated.steps[0].includes("Milk 500ml"), "narration uses the recorded product name");

  const viewedNotBought = await runInsight(INSIGHTS.ONLINE_VIEWED_NOT_BOUGHT, { shopId: shopA.id, userId: userA });
  assert.ok(viewedNotBought.items.some((row) => row.productId === soap), "soap: viewed six times, never added to a cart");

  const dropOff = await runInsight(INSIGHTS.CHECKOUT_DROP_OFF, { shopId: shopA.id, userId: userA });
  assert.equal(dropOff.sufficientData, true, "funnel has enough sessions to report");
  assert.ok(dropOff.biggestDropOff, "the largest leak is named");

  // Thin evidence is reported as thin, never as a confident ranking.
  const thin = await runInsight(INSIGHTS.TOP_PRODUCTS, { shopId: shopB.id, userId: userB });
  assert.equal(thin.sufficientData, false, "one observation is not a ranking");
  assert.equal(narrateInsight(thin).resolved, false, "the assistant admits it does not know yet");

  console.log("activity-personalization.examples.js OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const ids = [shopA?.id, shopB?.id].filter(Boolean);
    try {
      await db.activityEvent.deleteMany({ where: { shopId: { in: ids } } });
      await db.activityAggregate.deleteMany({ where: { shopId: { in: ids } } });
      await db.shop.deleteMany({ where: { id: { in: ids } } });
    } catch (cleanupError) {
      console.error("cleanup failed", cleanupError);
    }
    await db.$disconnect();
  });
