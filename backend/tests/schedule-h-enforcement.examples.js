import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RESTRICTED_SCHEDULES,
  RETENTION_YEARS,
  evaluateSale,
  isRestricted,
  normalizeSchedule,
  prescriptionBlockers,
  prescriptionLineMismatch,
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
  // refillsAllowed counts REPEATS and refillsUsed counts repeats taken: the first
  // hand-over is not a refill. So status "dispensed" already means the original
  // has gone, and the ceiling is >=, not >.
  //
  // A slip still to be handed over is "pending", which never reaches this check
  // at all — asserted below so the two states cannot be confused again.
  assert.deepEqual(prescriptionBlockers(slip({ status: "pending", refillsAllowed: 0, refillsUsed: 0 }), { now: NOW }), []);

  // A one-time slip that has been handed over is spent. This read as permitted
  // for a while, one dispense looser than the register, so a slip dispensed at
  // the register could buy Schedule H again at the till.
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 0, refillsUsed: 0 }), { now: NOW }), ["PRESCRIPTION_REFILLS_EXHAUSTED"]);
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 0, refillsUsed: 1 }), { now: NOW }), ["PRESCRIPTION_REFILLS_EXHAUSTED"]);

  // Two repeats: the original plus two more, and nothing after that.
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 2, refillsUsed: 0 }), { now: NOW }), []);
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 2, refillsUsed: 1 }), { now: NOW }), []);
  assert.deepEqual(prescriptionBlockers(slip({ status: "dispensed", refillsAllowed: 2, refillsUsed: 2 }), { now: NOW }), ["PRESCRIPTION_REFILLS_EXHAUSTED"]);
});

test("the till counts a repeat the same way the register does", () => {
  // One field, one scale. The guard used to increment refillsUsed on the first
  // hand-over while dispensePrescription, canDispense and the refillable summary
  // all counted repeats only — so the same slip read differently depending on
  // which door it came through.
  const guard = readFileSync(new URL("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js", import.meta.url), "utf8");
  assert.ok(guard.includes(`const isRefill = prescription.status === "dispensed";`), "the guard decides refill-or-not from the slip as it stood");
  assert.ok(guard.includes("...(isRefill ? { refillsUsed: { increment: 1 } } : {})"), "and only a repeat increments the count");

  const register = readFileSync(new URL("../src/verticals/pharmacy/prescriptions/prescriptions.service.js", import.meta.url), "utf8");
  assert.ok(register.includes(`const isRefill = prescription.status === "dispensed";`), "the register reads it the same way");
  assert.ok(
    register.includes("prescription.refillsUsed >= prescription.refillsAllowed"),
    "the register refuses at the same ceiling the sale guard now uses",
  );
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

/* ── The bill against the slip it is closed with ───────────────────────────── */

const catalogue = {
  azee: { name: "Azee 500", drugSchedule: "h" },
  alprax: { name: "Alprax 0.25", drugSchedule: "h1" },
  crocin: { name: "Crocin", drugSchedule: "otc" },
};
const restricted = new Set(["azee", "alprax"]);
const entry = (items) => ({ registerNumber: "RX-000042", items });
const mismatch = (items, slipItems) => prescriptionLineMismatch({
  items, productMap: catalogue, prescription: entry(slipItems), restrictedProductIds: restricted,
});
const azeeOnSlip = { productId: "azee", name: "Azee 500", qty: 2, unit: "strip" };
const azeeLine = (over = {}) => ({ productId: "azee", quantity: 1, enteredUnit: "strip", ...over });

test("a bill that hands over what the slip says agrees with it", () => {
  assert.equal(mismatch([azeeLine({ quantity: 2 })], [azeeOnSlip]), null);
  // Less than prescribed is a patient buying part of it, which is their business.
  assert.equal(mismatch([azeeLine()], [azeeOnSlip]), null);
});

test("a restricted medicine has to be on the slip it is sold against", () => {
  // The hole this closes: any valid slip used to authorise any Schedule H line.
  const result = mismatch([azeeLine(), { productId: "alprax", quantity: 1, enteredUnit: "strip" }], [azeeOnSlip]);
  assert.equal(result.code, "PRESCRIPTION_ITEMS_MISMATCH");
  assert.match(result.message, /^Alprax 0\.25 is not on prescription RX-000042\./);
});

test("an unrestricted extra on the same bill is nobody's concern", () => {
  assert.equal(mismatch([azeeLine(), { productId: "crocin", quantity: 4, enteredUnit: "strip" }], [azeeOnSlip]), null);
  // A line typed in by hand has no product to hold against anything.
  assert.equal(mismatch([azeeLine(), { name: "Carry bag", quantity: 1, enteredUnit: "piece" }], [azeeOnSlip]), null);
});

test("the slip's quantity is a ceiling on the bill, not on a line", () => {
  assert.equal(mismatch([azeeLine(), azeeLine()], [azeeOnSlip]), null);
  const result = mismatch([azeeLine({ quantity: 2 }), azeeLine()], [azeeOnSlip]);
  assert.match(result.message, /Azee 500: 3 strip on the bill, but prescription RX-000042 allows 2\./);
  // The same medicine written on two lines of the slip adds up too.
  assert.equal(mismatch([azeeLine({ quantity: 3 })], [azeeOnSlip, { ...azeeOnSlip, qty: 1 }]), null);
});

test("the unit is matched by every name the line carries for it, and by nothing else", () => {
  // A pack labelled "Strip" with the code "strip10" is one pack, however the
  // chemist spelled it on the entry.
  const pack = { sellingUnitId: "su1", sellingUnitLabel: "Strip", sellingUnitCode: "strip10", enteredUnit: "Strip" };
  assert.equal(mismatch([azeeLine(pack)], [{ ...azeeOnSlip, unit: "STRIP " }]), null);
  assert.equal(mismatch([azeeLine(pack)], [{ ...azeeOnSlip, unit: "strip10" }]), null);

  // A different unit is a different amount — ten tablets are not ten strips.
  const result = mismatch([azeeLine({ enteredUnit: "tablet" })], [azeeOnSlip]);
  assert.match(result.message, /Azee 500 is prescribed in strip but billed in tablet\./);

  // Including the catalogue's own rate unit: a loose line is entered in grams
  // against a per-kilo rate, and those are not the same 500.
  const loose = { ...catalogue, azee: { ...catalogue.azee, rateUnit: "kg", displayUnit: "kg" } };
  assert.ok(prescriptionLineMismatch({
    items: [azeeLine({ enteredUnit: "g" })], productMap: loose, prescription: entry([{ ...azeeOnSlip, unit: "kg" }]), restrictedProductIds: restricted,
  }));
});

test("a medicine typed onto the slip by hand is matched by its name", () => {
  // The register does not need a medicine to be in the catalogue, so a line
  // with no product id has only its name to go by.
  assert.equal(mismatch([azeeLine()], [{ productId: null, name: "  azee 500 ", qty: 1, unit: "strip" }]), null);
  assert.match(
    mismatch([azeeLine()], [{ productId: null, name: "Azithromycin", qty: 1, unit: "strip" }]).message,
    /Azee 500 is not on prescription RX-000042/,
  );
});

test("a slip with nothing from this bill on it does not close against it", () => {
  const result = mismatch([{ productId: "crocin", quantity: 1, enteredUnit: "strip" }], [azeeOnSlip]);
  assert.match(result.message, /Nothing on this bill is on prescription RX-000042/);
});
