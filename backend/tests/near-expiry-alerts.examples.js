import test from "node:test";
import assert from "node:assert/strict";
import {
  NEAR_EXPIRY_CRITICAL_DAYS,
  NEAR_EXPIRY_WARNING_DAYS,
  classifyExpiry,
  daysUntilExpiry,
  summariseNearExpiry,
} from "../src/modules/inventory-lots/nearExpiryAlert.js";

/**
 * Expiry is the one stock loss a shop can see coming, and the only one it can
 * still act on. The batch ledger already knew every expiry date; nothing added
 * them up, so a ₹4,000 write-off arrived as a surprise.
 */

const NOW = Date.UTC(2026, 7, 4, 13, 30); // mid-afternoon, to catch time-of-day bugs
const DAY = 86_400_000;
const inDays = (days) => new Date(NOW + days * DAY).toISOString();

test("days-to-expiry is whole days and ignores the time of day", () => {
  // Asked at 13:30, a batch expiring at 00:00 tomorrow is 1 day out, not 0.
  assert.equal(daysUntilExpiry(inDays(1), NOW), 1);
  assert.equal(daysUntilExpiry(inDays(0), NOW), 0);
  assert.equal(daysUntilExpiry(inDays(-3), NOW), -3);
  // Same answer whenever the question is asked on the same day.
  assert.equal(daysUntilExpiry(inDays(5), Date.UTC(2026, 7, 4, 0, 1)), 5);
  assert.equal(daysUntilExpiry(inDays(5), Date.UTC(2026, 7, 4, 23, 59)), 5);
});

test("an unreadable expiry date is unknown rather than expired", () => {
  // Guessing "expired" here would quietly condemn saleable stock.
  assert.equal(daysUntilExpiry("not-a-date", NOW), null);
  assert.equal(classifyExpiry(null), "unknown");
});

test("the buckets split on the thresholds, inclusively", () => {
  assert.equal(classifyExpiry(-1), "expired");
  assert.equal(classifyExpiry(0), "critical");
  assert.equal(classifyExpiry(NEAR_EXPIRY_CRITICAL_DAYS), "critical");
  assert.equal(classifyExpiry(NEAR_EXPIRY_CRITICAL_DAYS + 1), "warning");
  assert.equal(classifyExpiry(NEAR_EXPIRY_WARNING_DAYS), "warning");
  assert.equal(classifyExpiry(NEAR_EXPIRY_WARNING_DAYS + 1), "ok");
});

const batch = (id, days, valueAtRisk, availableBaseQty = 10) => ({ id, expiresOn: inDays(days), valueAtRisk, availableBaseQty });

test("money at risk is totalled per bucket and overall", () => {
  const summary = summariseNearExpiry([
    batch("expired", -2, 100),
    batch("soon", 10, 250),
    batch("later", 60, 400),
    batch("fine", 200, 9999),
  ], { now: NOW });

  assert.equal(summary.buckets.expired.count, 1);
  assert.equal(summary.buckets.expired.valueAtRisk, 100);
  assert.equal(summary.buckets.critical.valueAtRisk, 250);
  assert.equal(summary.buckets.warning.valueAtRisk, 400);
  // The healthy batch is absent from every total — it is not at risk.
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.totalValueAtRisk, 750);
  assert.equal(summary.batches.some((row) => row.id === "fine"), false);
});

test("a sold-out batch cannot expire into a loss", () => {
  // Nothing left on the shelf to throw away; counting it inflates every figure.
  const summary = summariseNearExpiry([batch("empty", 3, 500, 0)], { now: NOW });
  assert.equal(summary.totalCount, 0);
  assert.equal(summary.totalValueAtRisk, 0);
});

test("batches come back soonest first, larger loss breaking a tie", () => {
  const summary = summariseNearExpiry([
    batch("b", 5, 100),
    batch("a", -1, 50),
    batch("c", 5, 900),
  ], { now: NOW });

  // Expired leads, then the two same-day batches with the bigger loss first, so
  // a dashboard can take the head of the list without re-sorting.
  assert.deepEqual(summary.batches.map((row) => row.id), ["a", "c", "b"]);
});

test("the thresholds are configurable and echoed back", () => {
  const batches = [batch("x", 45, 100)];

  // Default windows: 45 days out is only a warning.
  assert.equal(summariseNearExpiry(batches, { now: NOW }).buckets.warning.count, 1);

  // A shop that wants two months of runway sees the same batch as critical.
  const strict = summariseNearExpiry(batches, { now: NOW, criticalDays: 60, warningDays: 120 });
  assert.equal(strict.buckets.critical.count, 1);
  // Echoed so the screen can say which window produced the number.
  assert.deepEqual(strict.thresholds, { criticalDays: 60, warningDays: 120 });
});

test("an empty shelf summarises to zeroes rather than throwing", () => {
  for (const input of [[], null, undefined]) {
    const summary = summariseNearExpiry(input, { now: NOW });
    assert.equal(summary.totalCount, 0);
    assert.equal(summary.totalValueAtRisk, 0);
    assert.deepEqual(summary.batches, []);
  }
});
