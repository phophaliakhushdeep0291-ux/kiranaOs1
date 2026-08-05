import test from "node:test";
import assert from "node:assert/strict";
import {
  RESTRICTED_SCHEDULES,
  RETENTION_YEARS,
  evaluateSale,
  isRestricted,
  normalizeSchedule,
  prescriptionBlockers,
  strictestSchedule,
} from "../src/verticals/pharmacy/prescriptions/scheduleEnforcement.js";

/**
 * The register recorded Schedule H sales; nothing stopped one happening without
 * a slip. These are the rules that close that gap, kept pure so the legal part
 * can be reasoned about without a database in the way.
 */

const NOW = Date.UTC(2026, 7, 4);
const DAY = 86_400_000;
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();
const slip = (over = {}) => ({ status: "pending", prescribedOn: daysAgo(1), refillsAllowed: 0, refillsUsed: 0, ...over });

test("only h, h1 and x are restricted", () => {
  assert.deepEqual([...RESTRICTED_SCHEDULES], ["h", "h1", "x"]);
  for (const schedule of ["h", "h1", "x", "H", " H1 "]) assert.equal(isRestricted(schedule), true);
  // OTC is an explicit "sell freely", not a restriction.
  for (const schedule of ["otc", null, undefined, "", "garbage"]) assert.equal(isRestricted(schedule), false);
});

test("an unrecognised classification is null, never silently restricted", () => {
  // Guessing "restricted" here would block a shop out of its own catalogue.
  assert.equal(normalizeSchedule("schedule-q"), null);
  assert.equal(normalizeSchedule("H1"), "h1");
});

test("the strictest schedule on the bill decides, H1 outranking X and H", () => {
  assert.equal(strictestSchedule(["h", "h1"]), "h1");
  assert.equal(strictestSchedule(["h", "x"]), "x");
  assert.equal(strictestSchedule(["otc", "h"]), "h");
  assert.equal(strictestSchedule(["otc", null]), null);
  // Retention follows from it: H1 keeps its register three years, H and X two.
  assert.equal(RETENTION_YEARS.h1, 3);
  assert.equal(RETENTION_YEARS.h, 2);
});

test("a bill with nothing restricted needs no prescription at all", () => {
  // Every sale in every shop that has not classified its catalogue.
  const unclassified = evaluateSale({ lines: [{ productId: "p1", schedule: null }], now: NOW });
  assert.equal(unclassified.allowed, true);
  assert.equal(unclassified.requiresPrescription, false);

  const otc = evaluateSale({ lines: [{ productId: "p1", schedule: "otc" }], now: NOW });
  assert.equal(otc.allowed, true);
  assert.equal(otc.requiresPrescription, false);

  // An empty or absent basket must not throw.
  assert.equal(evaluateSale({ lines: [], now: NOW }).allowed, true);
  assert.equal(evaluateSale({ now: NOW }).allowed, true);
});

test("a restricted line without a slip is refused", () => {
  const result = evaluateSale({ lines: [{ productId: "p1", name: "Alprax", schedule: "h1" }], now: NOW });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresPrescription, true);
  assert.equal(result.schedule, "h1");
  assert.equal(result.retentionYears, 3);
  assert.deepEqual(result.blockers, ["PRESCRIPTION_REQUIRED"]);
  // The caller needs to name the offending medicine, not just refuse the bill.
  assert.deepEqual(result.restrictedLines.map((line) => line.name), ["Alprax"]);
});

test("a restricted line with a valid slip goes through", () => {
  const result = evaluateSale({ lines: [{ productId: "p1", schedule: "h" }], prescription: slip(), now: NOW });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.blockers, []);
});

test("only the restricted lines are held against the sale", () => {
  // A basket of shampoo and one Schedule H strip is still a Schedule H sale, but
  // the shampoo is not what needs authorising.
  const result = evaluateSale({
    lines: [{ productId: "a", name: "Shampoo", schedule: null }, { productId: "b", name: "Alprax", schedule: "h1" }],
    prescription: slip(),
    now: NOW,
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.restrictedLines.map((line) => line.name), ["Alprax"]);
});

test("a cancelled or deleted slip authorises nothing", () => {
  assert.deepEqual(prescriptionBlockers(slip({ status: "cancelled" }), { now: NOW }), ["PRESCRIPTION_CANCELLED"]);
  assert.deepEqual(prescriptionBlockers(slip({ deletedAt: new Date() }), { now: NOW }), ["PRESCRIPTION_DELETED"]);
});

test("refills are counted so one slip cannot be used forever", () => {
  // refillsAllowed is the number of REPEATS, so the original dispense is always
  // permitted: allowed 0, used 0 is the first sale and must pass.
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 0, refillsUsed: 0 }), { now: NOW }), []);
  // Used once beyond a no-repeat slip: exhausted.
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 0, refillsUsed: 1 }), { now: NOW }), ["PRESCRIPTION_REFILLS_EXHAUSTED"]);
  // A two-repeat slip survives its second dispense and dies on its fourth.
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 2, refillsUsed: 2 }), { now: NOW }), []);
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 2, refillsUsed: 3 }), { now: NOW }), ["PRESCRIPTION_REFILLS_EXHAUSTED"]);
});

test("an old slip stops being a licence", () => {
  // Counted from the date the doctor wrote, not from when it was typed in.
  assert.deepEqual(prescriptionBlockers(slip({ prescribedOn: daysAgo(179) }), { now: NOW }), []);
  assert.deepEqual(prescriptionBlockers(slip({ prescribedOn: daysAgo(181) }), { now: NOW }), ["PRESCRIPTION_EXPIRED"]);
  // Shops on a shorter policy get it honoured.
  assert.deepEqual(prescriptionBlockers(slip({ prescribedOn: daysAgo(40) }), { now: NOW, validityDays: 30 }), ["PRESCRIPTION_EXPIRED"]);
});

test("an unreadable prescribed date does not expire the slip", () => {
  // Refusing on a date we failed to parse would block a lawful sale over a typo.
  assert.deepEqual(prescriptionBlockers(slip({ prescribedOn: "not-a-date" }), { now: NOW }), []);
});

test("every blocker is reported at once, not one per attempt", () => {
  // A counter fixing three problems one refusal at a time is a counter that
  // stops using the feature.
  const blockers = prescriptionBlockers(slip({ status: "cancelled", prescribedOn: daysAgo(400), deletedAt: new Date() }), { now: NOW });
  assert.deepEqual(blockers.sort(), ["PRESCRIPTION_CANCELLED", "PRESCRIPTION_DELETED", "PRESCRIPTION_EXPIRED"]);
});
