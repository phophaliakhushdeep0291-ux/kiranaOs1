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

test("stock handled by multiple vertical guards is merged and dropped on refusal", async () => {
  resetSaleGuards();
  registerSaleGuard(async () => ({ handledStockProductIds: ["dish", "combo"] }));
  registerSaleGuard(async () => ({ handledStockProductIds: new Set(["combo", "meal"]) }));
  const allowed = await evaluateSaleGuards(context());
  assert.deepEqual([...allowed.handledStockProductIds].sort(), ["combo", "dish", "meal"]);

  registerSaleGuard(async () => ({ code: "STOP", message: "stop" }));
  const refused = await evaluateSaleGuards(context());
  assert.equal(refused.handledStockProductIds.size, 0);
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
function fakeTx(prescription) {
  const updates = [];
  return {
    updates,
    prescription: {
      findFirst: async () => prescription,
      update: async (args) => { updates.push(args); return args; },
    },
  };
}

test("a valid slip lets the sale through and closes the register entry", async () => {
  resetSaleGuards();
  const { registerPrescriptionSaleGuard } = await import("../src/verticals/pharmacy/prescriptions/prescriptions.guard.js");
  registerPrescriptionSaleGuard();

  const tx = fakeTx({ id: "rx1", status: "pending", prescribedOn: new Date().toISOString(), refillsAllowed: 0, refillsUsed: 0 });
  const { refusal, onConfirmed } = await evaluateSaleGuards(context({
    tx,
    body: { prescriptionId: "rx1" },
    items: [{ productId: "p1" }],
    productMap: { p1: { name: "Alprax", drugSchedule: "h1" } },
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
  // Increment, never a set — a repeat slip walks toward exhaustion.
  assert.deepEqual(write.data.refillsUsed, { increment: 1 });
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
