import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSaleGuards, registerSaleGuard, resetSaleGuards } from "../src/shared/sale-guards.js";

/**
 * The seam that lets a trade refuse a sale without shared billing importing it.
 *
 * Schedule H enforcement first went in as a direct import from modules/bills into
 * verticals/pharmacy, and business-vertical-architecture.examples.js failed it —
 * correctly. This registry is the inversion, matching the one the clothing pack
 * already uses for catalogue availability.
 */

const context = (over = {}) => ({ shopId: "s", tx: {}, body: {}, items: [], productMap: {}, isEstimate: false, ...over });

test("no guards registered means the sale is never touched", async () => {
  // The common case — every shop that is not a pharmacy, on every bill.
  resetSaleGuards();
  const result = await evaluateSaleGuards(context());
  assert.equal(result.refusal, null);
  assert.deepEqual(result.onConfirmed, []);
});

test("a guard returning null allows the sale", async () => {
  resetSaleGuards();
  registerSaleGuard(async () => null);
  assert.equal((await evaluateSaleGuards(context())).refusal, null);
});

test("a refusal carries its code and data back to the caller", async () => {
  resetSaleGuards();
  registerSaleGuard(async () => ({ code: "NOPE", message: "not allowed", status: 409, publicData: { why: "test" } }));

  const { refusal } = await evaluateSaleGuards(context());
  assert.equal(refusal.code, "NOPE");
  assert.equal(refusal.status, 409);
  assert.deepEqual(refusal.publicData, { why: "test" });
});

test("the first refusal stops the rest", async () => {
  resetSaleGuards();
  let secondRan = false;
  registerSaleGuard(async () => ({ code: "FIRST", message: "first" }));
  registerSaleGuard(async () => { secondRan = true; return null; });

  const { refusal } = await evaluateSaleGuards(context());
  assert.equal(refusal.code, "FIRST");
  // A counter clearing three objections one attempt at a time works around the
  // feature rather than with it.
  assert.equal(secondRan, false);
});

test("hooks from allowing guards are collected, and dropped on a refusal", async () => {
  resetSaleGuards();
  registerSaleGuard(async () => ({ onConfirmed: async () => "wrote to my ledger" }));

  const allowed = await evaluateSaleGuards(context());
  assert.equal(allowed.onConfirmed.length, 1);
  assert.equal(await allowed.onConfirmed[0]({}), "wrote to my ledger");

  // Nothing may write a ledger entry for a sale that was refused.
  registerSaleGuard(async () => ({ code: "STOP", message: "stop" }));
  const refused = await evaluateSaleGuards(context());
  assert.equal(refused.refusal.code, "STOP");
  assert.deepEqual(refused.onConfirmed, []);
});

test("a non-function registration is refused at once", () => {
  resetSaleGuards();
  // Failing at registration beats failing on someone's bill.
  assert.throws(() => registerSaleGuard("not a function"), TypeError);
});

test("the pharmacy pack registers its guard by being loaded", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  // Reachable only through the pharmacy pack's routes, so a shop without
  // prescriptions never runs it — the same arrangement as cloth rentals.
  const { refusal } = await evaluateSaleGuards(context({
    items: [{ productId: "p1" }],
    productMap: { p1: { name: "Alprax", drugSchedule: "h1" } },
  }));
  assert.equal(refusal.code, "PRESCRIPTION_REQUIRED_FOR_SCHEDULE");
  assert.equal(refusal.publicData.schedule, "h1");
  assert.deepEqual(refusal.publicData.blockers, ["PRESCRIPTION_REQUIRED"]);
  resetSaleGuards();
});

/** A transaction stub that serves one prescription and captures the write-back. */
function fakeTx(prescription, { claimed = 1 } = {}) {
  const updates = [];
  return {
    updates,
    prescription: {
      findFirst: async () => prescription,
      updateMany: async (args) => { updates.push(args); return { count: claimed }; },
    },
  };
}

/** One strip of Alprax, as the chemist would have written the entry. */
const alpraxSlip = (over = {}) => ({
  id: "rx1", registerNumber: "RX-000001", status: "pending", prescribedOn: new Date().toISOString(),
  refillsAllowed: 0, refillsUsed: 0,
  items: [{ productId: "p1", name: "Alprax", qty: 1, unit: "strip" }],
  ...over,
});
const alpraxLine = (over = {}) => ({ productId: "p1", quantity: 1, enteredUnit: "strip", ...over });
const alprax = { p1: { name: "Alprax", drugSchedule: "h1", rateUnit: "strip", displayUnit: "strip" } };

test("a valid slip lets the sale through and closes the register entry", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  const tx = fakeTx(alpraxSlip());
  const { refusal, onConfirmed } = await evaluateSaleGuards(context({
    tx,
    body: { prescriptionId: "rx1" },
    items: [alpraxLine()],
    productMap: alprax,
  }));

  assert.equal(refusal, null);
  assert.equal(onConfirmed.length, 1);

  // Nothing is written until the bill actually exists.
  assert.equal(tx.updates.length, 0);
  await onConfirmed[0]({ tx, bill: { id: "bill1" }, billNo: "INV-7" });

  const [write] = tx.updates;
  assert.equal(write.where.id, "rx1");
  assert.equal(write.data.status, "dispensed");
  assert.equal(write.data.billId, "bill1");
  // The number is copied alongside the id so the register keeps saying what went
  // out even if the bill is later cancelled or purged.
  assert.equal(write.data.billNumber, "INV-7");
  // The first hand-over is not a refill, so the count does not move. That is the
  // scale dispensePrescription, canDispense and the refillable summary all use;
  // incrementing here too put the till one dispense ahead of the register, and a
  // slip handed over at the register could then buy Schedule H at the counter.
  assert.equal(write.data.refillsUsed, undefined);
  resetSaleGuards();
});

test("a repeat does move the count, so a slip walks toward exhaustion", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  // Already dispensed once, with two repeats the doctor allowed.
  const tx = fakeTx(alpraxSlip({ id: "rx2", status: "dispensed", refillsAllowed: 2 }));
  const { refusal, onConfirmed } = await evaluateSaleGuards(context({
    tx,
    body: { prescriptionId: "rx2" },
    items: [alpraxLine()],
    productMap: alprax,
  }));

  assert.equal(refusal, null);
  await onConfirmed[0]({ tx, bill: { id: "bill2" }, billNo: "INV-8" });
  assert.deepEqual(tx.updates[0].data.refillsUsed, { increment: 1 });
  // The write is conditional on the slip still standing where the decision
  // found it, so a second counter billing the same slip cannot also close it.
  assert.equal(tx.updates[0].where.status, "dispensed");
  assert.equal(tx.updates[0].where.refillsUsed, 0);
  resetSaleGuards();
});

test("a slip another counter closed first rolls this bill back", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  // Both counters passed the check; this one's conditional write matches no row.
  const tx = fakeTx(alpraxSlip(), { claimed: 0 });
  const { onConfirmed } = await evaluateSaleGuards(context({
    tx, body: { prescriptionId: "rx1" }, items: [alpraxLine()], productMap: alprax,
  }));
  await assert.rejects(
    onConfirmed[0]({ tx, bill: { id: "bill3" }, billNo: "INV-9" }),
    { code: "PRESCRIPTION_ALREADY_DISPENSED", statusCode: 409 },
  );
  resetSaleGuards();
});

test("a bill at the counter must hand over what the slip says", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  const refusalFor = async (items, productMap = alprax) => (await evaluateSaleGuards(context({
    tx: fakeTx(alpraxSlip()), body: { prescriptionId: "rx1" }, items, productMap,
  }))).refusal;

  // Until this check existed, a slip for one strip closed a bill for anything.
  const tooMany = await refusalFor([alpraxLine({ quantity: 3 })]);
  assert.equal(tooMany.code, "PRESCRIPTION_ITEMS_MISMATCH");
  assert.equal(tooMany.status, 409);
  assert.match(tooMany.message, /Alprax: 3 strip on the bill, but prescription RX-000001 allows 1/);

  const wrongUnit = await refusalFor([alpraxLine({ enteredUnit: "tablet" })]);
  assert.match(wrongUnit.message, /Alprax is prescribed in strip but billed in tablet/);

  const notListed = await refusalFor(
    [alpraxLine(), { productId: "p2", quantity: 1, enteredUnit: "strip" }],
    { ...alprax, p2: { name: "Tramadol", drugSchedule: "h1" } },
  );
  assert.match(notListed.message, /Tramadol is not on prescription RX-000001/);

  // A bandage bought alongside is an ordinary line; nobody prescribes a bandage.
  assert.equal(await refusalFor(
    [alpraxLine(), { productId: "p3", quantity: 2, enteredUnit: "piece" }],
    { ...alprax, p3: { name: "Bandage", drugSchedule: "otc" } },
  ), null);
});

test("a replayed sale is not held to the slip's lines", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  // The strips left the shop before the server heard of it, from a till that
  // may predate the line check. A valid slip is still required — that is the
  // law — but a disagreement about units cannot un-sell anything.
  const replayed = await evaluateSaleGuards(context({
    tx: fakeTx(alpraxSlip()), body: { prescriptionId: "rx1" }, isOfflineReplay: true,
    items: [alpraxLine({ quantity: 3, enteredUnit: "tablet" })], productMap: alprax,
  }));
  assert.equal(replayed.refusal, null);
  assert.equal(replayed.onConfirmed.length, 1, "the register entry still closes against the bill");

  const noSlip = await evaluateSaleGuards(context({
    tx: fakeTx(null), isOfflineReplay: true, items: [alpraxLine()], productMap: alprax,
  }));
  assert.equal(noSlip.refusal.code, "PRESCRIPTION_REQUIRED_FOR_SCHEDULE");
  resetSaleGuards();
});

test("a slip attached to an OTC bill closes with it at the counter, and is left alone on a replay", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  const crocin = { p1: { name: "Crocin", drugSchedule: "otc", rateUnit: "strip" } };
  const slip = (over) => alpraxSlip({ items: [{ productId: "p1", name: "Crocin", qty: 1, unit: "strip" }], ...over });
  const evaluate = (prescription, over = {}) => evaluateSaleGuards(context({
    tx: fakeTx(prescription), body: { prescriptionId: "rx1" }, items: [alpraxLine()], productMap: crocin, ...over,
  }));

  // The chemist attached it on purpose: they are dispensing this slip.
  assert.equal((await evaluate(slip())).onConfirmed.length, 1);

  // Used up, it cannot be dispensed again…
  const spent = slip({ status: "dispensed" });
  assert.equal((await evaluate(spent)).refusal.code, "PRESCRIPTION_NOT_AVAILABLE");

  // …but a sale that already happened needed no slip for an OTC line, so the
  // stale reference is ignored rather than turned into a conflict.
  const replayed = await evaluate(spent, { isOfflineReplay: true });
  assert.equal(replayed.refusal, null);
  assert.equal(replayed.onConfirmed.length, 0);
  resetSaleGuards();
});

/* ── Electronics: the serial a bill line names ─────────────────────────────── */

/** A transaction stub over a handful of registered units. */
function unitTx(units, { claimed = 1 } = {}) {
  const calls = { finds: 0, updates: [] };
  return {
    calls,
    productUnit: {
      findMany: async ({ where }) => {
        calls.finds += 1;
        return units.filter((unit) => where.id.in.includes(unit.id) && unit.shopId === where.shopId && !unit.deletedAt);
      },
      updateMany: async (args) => { calls.updates.push(args); return { count: claimed }; },
    },
  };
}
const handset = (over = {}) => ({
  id: "u1", shopId: "s", productId: "p1", status: "in_stock", billId: null, imei: "351234567890123",
  serialNumber: "SN-1", warrantyMonths: 12, ...over,
});
const phones = { p1: { name: "Galaxy A16" } };

test("a bill that names no serial costs the electronics guard nothing and is never refused", async () => {
  resetSaleGuards();
  const { registerUnitSaleGuard } = await import("../src/verticals/electronics/units/units.guard.js");
  registerUnitSaleGuard();

  // Every bill in every shop runs this guard. The register is the electronics
  // shop's own bookkeeping, so a line without a serial — an unscanned box, an
  // older till, a plan without the register — is a question for the counter.
  const tx = { productUnit: { findMany: async () => { throw new Error("must not query"); } } };
  const { refusal, onConfirmed } = await evaluateSaleGuards(context({
    tx, items: [{ productId: "p1", quantity: 2 }], productMap: phones,
  }));
  assert.equal(refusal, null);
  assert.equal(onConfirmed.length, 0);
  resetSaleGuards();
});

test("a chosen serial is reserved with the bill, on the state it was read in", async () => {
  resetSaleGuards();
  const { registerUnitSaleGuard } = await import("../src/verticals/electronics/units/units.guard.js");
  registerUnitSaleGuard();

  const tx = unitTx([handset()]);
  const { refusal, onConfirmed, decorateBillItem } = await evaluateSaleGuards(context({
    tx, body: { customerMobile: "+91 98765 43210" },
    items: [{ productId: "p1", quantity: 1, trackedUnitId: "u1" }], productMap: phones,
  }));
  assert.equal(refusal, null);

  // The line carries the link a return needs, and the words a customer looks for.
  const decoration = decorateBillItem[0]({
    item: { trackedUnitId: "u1" }, billItem: { quantityInBaseUnit: 1, note: "Blue" },
  });
  assert.deepEqual(decoration, { trackedUnitId: "u1", note: "Blue · IMEI 351234567890123 · S/N SN-1" });
  // Quantity 1 of a box of ten is ten pieces, and one serial cannot be all of them.
  assert.throws(
    () => decorateBillItem[0]({ item: { trackedUnitId: "u1" }, billItem: { quantityInBaseUnit: 10 } }),
    { code: "TRACKED_UNIT_QUANTITY" },
  );

  const soldAt = new Date(2026, 5, 15);
  await onConfirmed[0]({
    tx,
    billNo: "INV-42",
    bill: { id: "b1", businessDate: soldAt, customerId: null, customerName: "Ramesh", items: [{ trackedUnitId: "u1", lineTotal: 9999 }] },
  });
  const [write] = tx.calls.updates;
  assert.deepEqual(write.where, { id: "u1", shopId: "s", deletedAt: null, status: "in_stock", billId: null });
  assert.equal(write.data.status, "sold");
  assert.equal(write.data.billId, "b1");
  assert.equal(write.data.billNumber, "INV-42");
  assert.equal(write.data.customerPhone, "9876543210", "stored the way the register is searched");
  assert.equal(write.data.sellingPrice, 9999);
  assert.equal(write.data.warrantyUntil.getFullYear(), 2027, "twelve months of cover from the sale");
  resetSaleGuards();
});

test("a serial that cannot be honoured is refused while the cashier can still pick another", async () => {
  resetSaleGuards();
  const { registerUnitSaleGuard } = await import("../src/verticals/electronics/units/units.guard.js");
  registerUnitSaleGuard();

  const refusalFor = async (units, items) => (await evaluateSaleGuards(context({
    tx: unitTx(units), items, productMap: phones,
  }))).refusal;
  const line = (over = {}) => ({ productId: "p1", quantity: 1, trackedUnitId: "u1", ...over });

  assert.equal((await refusalFor([], [line()])).code, "TRACKED_UNIT_UNKNOWN");
  assert.equal((await refusalFor([handset({ shopId: "another-shop" })], [line()])).code, "TRACKED_UNIT_UNKNOWN");
  assert.equal((await refusalFor([handset({ productId: "p9" })], [line()])).code, "TRACKED_UNIT_UNKNOWN");
  assert.equal((await refusalFor([handset({ deletedAt: new Date() })], [line()])).code, "TRACKED_UNIT_UNKNOWN");

  const sold = await refusalFor([handset({ status: "sold", billNumber: "INV-7" })], [line()]);
  assert.equal(sold.code, "TRACKED_UNIT_UNAVAILABLE");
  assert.match(sold.message, /IMEI 351234567890123.*already sold on INV-7/);
  assert.match((await refusalFor([handset({ status: "rma" })], [line()])).message, /service centre/);

  assert.match((await refusalFor([handset()], [line(), line()])).message, /on this bill twice/);
  assert.equal((await refusalFor([handset()], [line({ quantity: 2 })])).code, "TRACKED_UNIT_QUANTITY");

  // An open-box return is back on the shelf and sells like any other.
  assert.equal(await refusalFor([handset({ status: "returned" })], [line()]), null);
  resetSaleGuards();
});

test("a handset another counter took first rolls this bill back", async () => {
  resetSaleGuards();
  const { registerUnitSaleGuard } = await import("../src/verticals/electronics/units/units.guard.js");
  registerUnitSaleGuard();

  const tx = unitTx([handset()], { claimed: 0 });
  const { onConfirmed } = await evaluateSaleGuards(context({
    tx, items: [{ productId: "p1", quantity: 1, trackedUnitId: "u1" }], productMap: phones,
  }));
  await assert.rejects(
    onConfirmed[0]({ tx, billNo: "INV-43", bill: { id: "b2", createdAt: new Date(), items: [{ trackedUnitId: "u1", lineTotal: 1 }] } }),
    { code: "UNIT_ALREADY_SOLD", statusCode: 409 },
  );
  resetSaleGuards();
});

test("a replayed sale reserves nothing and is never refused over a serial", async () => {
  resetSaleGuards();
  const { registerUnitSaleGuard } = await import("../src/verticals/electronics/units/units.guard.js");
  registerUnitSaleGuard();

  // The phone left the shop while the till was offline. The serial it names may
  // have been sold at another counter since; refusing now un-sells nothing.
  const tx = unitTx([handset({ status: "sold" })]);
  const { refusal, onConfirmed, decorateBillItem } = await evaluateSaleGuards(context({
    tx, isOfflineReplay: true, items: [{ productId: "p1", quantity: 1, trackedUnitId: "u1" }], productMap: phones,
  }));
  assert.equal(refusal, null);
  assert.equal(onConfirmed.length, 0);
  assert.equal(decorateBillItem.length, 0, "the line is stored without a link it could not honour");
  assert.equal(tx.calls.finds, 0);
  resetSaleGuards();
});

test("an unrestricted basket closes no register entry", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  // An OTC line carries a schedule, so it reaches the guard and only
  // evaluateSale decides it is unrestricted. There is no slip behind it, so
  // there must be no confirm hook either — one was handed back regardless, and
  // it dereferenced a null prescription the moment the bill was confirmed.
  const tx = { prescription: { findFirst: async () => null }, updates: [] };
  const { refusal, onConfirmed } = await evaluateSaleGuards(context({
    tx,
    items: [{ productId: "p1" }],
    productMap: { p1: { name: "Crocin", drugSchedule: "otc" } },
  }));

  assert.equal(refusal, null);
  assert.equal(onConfirmed.length, 0, "an OTC sale must not carry a prescription write");
  resetSaleGuards();
});

test("an estimate is never blocked", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  // A kacha quote hands nothing over. Refusing one would stop a pharmacy pricing
  // a prescription before the customer has decided to buy.
  const { refusal } = await evaluateSaleGuards(context({
    isEstimate: true,
    items: [{ productId: "p1" }],
    productMap: { p1: { name: "Alprax", drugSchedule: "h1" } },
  }));
  assert.equal(refusal, null);
  resetSaleGuards();
});

test("an unclassified or OTC basket never consults a prescription", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  // The lookup must not run for the ordinary case — a paracetamol sale should
  // cost a pharmacy nothing extra.
  const tx = { prescription: { findFirst: async () => { throw new Error("must not query"); } } };
  for (const drugSchedule of [null, undefined, "otc"]) {
    const { refusal } = await evaluateSaleGuards(context({
      tx, items: [{ productId: "p1" }], productMap: { p1: { name: "Crocin", drugSchedule } },
    }));
    assert.equal(refusal, null);
  }
  resetSaleGuards();
});
