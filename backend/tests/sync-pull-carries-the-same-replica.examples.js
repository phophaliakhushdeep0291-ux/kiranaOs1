/**
 * A pulled bill is the same offline copy the bills list sends — so it sends the
 * same columns.
 *
 * `bill-list-carries-what-the-counter-needs.examples.js` audited BillItem and
 * Payment column by column, by following the client's access paths, and narrowed
 * GET /api/bills to what has a reader. GET /api/sync/pull fills the SAME IndexedDB
 * tables (bill_items, payments) from the SAME rows, and does it far more often —
 * every device, on a cadence that starts at 2.5s — but it was still sending whole
 * rows. Measured over 397 one-line bills, the columns with no reader were ~160KB
 * of a 1136KB response.
 *
 * Both halves matter here for the same reason they do there:
 *   KEPT — every field an offline screen reads is still on the row. This is the
 *          half that fails quietly: a blank on a reprinted receipt, found by a
 *          customer standing at the counter, not by an error.
 *   GONE — the unread stay unread, so a later `items: true` cannot quietly put
 *          fifteen columns back on every device's sync.
 *
 * Both pull protocols are covered. `since=` and `afterSeq=` load their bills
 * through different functions, and narrowing one while leaving the other wide
 * would be invisible: a device on the sequence feed would simply keep paying.
 */

import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import db from "../src/db.js";
import { confirmBill } from "../src/modules/bills/bills.service.js";
import { createProduct } from "../src/modules/products/products.service.js";
import { pullSince } from "../src/modules/sync/sync.service.js";

const shop = await db.shop.create({
  data: { name: "Sync pull shape proof", ownerName: "Owner", city: "Indore", address: "1 Test Road" },
});
const owner = await db.user.create({
  data: {
    shopId: shop.id, name: "Owner", mobile: "9000000811", role: "owner",
    passwordHash: await bcrypt.hash("password", 10), pinHash: await bcrypt.hash("4242", 10),
  },
});
const user = { userId: owner.id, id: owner.id, role: "owner", shopId: shop.id };

const product = await createProduct(shop.id, {
  name: "Pulled Biscuit", category: "Biscuits",
  displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
  defaultPricePerRateUnit: 10, costPerRateUnit: 6, mrp: 12,
  stockBaseQty: 100, gstRate: 5, isLooseItem: false,
}, { actor: { userId: owner.id } });

await confirmBill(shop.id, {
  billType: "normal_sale", gstMode: "inclusive", customerName: "Walk-in",
  items: [{ productId: product.id, name: product.name, quantity: 3, enteredUnit: "piece", ratePerRateUnit: 10 }],
  payments: [{ mode: "cash", amount: 30 }],
  discount: 0, offerDiscount: 0, waivedAmount: 0, roundOff: false, sensitiveActions: [],
  idempotencyKey: "sync-pull-shape-1",
}, user);

// Every field an offline screen reads off a line. Asserted by name because these
// are the ones that fail silently rather than loudly.
const LINE_FIELDS_THE_COUNTER_READS = [
  "id", "billId", "productId", "name", "quantity", "enteredUnit", "baseUnit",
  "quantityInBaseUnit", "rateUnit", "ratePerRateUnit", "costPerRateUnit", "gstRate", "hsn",
  "conversionToBase", "sellingUnitId", "sellingUnitCode", "sellingUnitLabel",
  "originalBillItemId", "note",
  "lineDiscount", "lineTotal", "lineCost", "lineProfit", "originalUnitPrice",
  "appliedPricingRuleId", "appliedPricingRuleType", "pricingExplanation",
  "pricingConfidence", "pricingCalculationVersion",
  "wasPriceOverridden", "priceOverrideReason", "priceApprovedByUserId",
];

// The seven shadow columns. The client does its money in the Float columns and its
// own paise helpers; nothing reads these off a bill.
const LINE_FIELDS_WITH_NO_READER = [
  "ratePerRateUnitPaise", "costPerRateUnitPaise", "lineDiscountPaise",
  "lineTotalPaise", "lineCostPaise", "lineProfitPaise", "originalUnitPricePaise",
];

const PAYMENT_SHAPE = ["amount", "billId", "clientPaymentId", "createdAt", "id", "idempotencyKey", "mode", "status"];

const PAYMENT_FIELDS_WITH_NO_READER = [
  "amountPaise", "shopId", "sourceDeviceId", "provider",
  "providerReference", "confirmationSource", "confirmedAt", "retailPaymentIntentId",
];

function assertReplicaShape(bill, protocolName) {
  // The bill row itself is untouched — no select on it, so a new Bill column keeps
  // arriving without anyone editing this file.
  for (const field of ["id", "billNo", "businessDate", "billType", "status", "customerName",
    "subtotal", "discount", "gst", "gstMode", "grandTotal", "paidAmount", "creditAmount"]) {
    assert.ok(field in bill, `${protocolName}: the replica must still carry bill.${field}`);
  }

  assert.equal(bill.items.length, 1, `${protocolName}: the line must be pulled`);
  const [line] = bill.items;
  for (const field of LINE_FIELDS_THE_COUNTER_READS) {
    assert.ok(field in line, `${protocolName}: a reprinted receipt needs item.${field}`);
  }
  assert.equal(Number(line.quantity), 3, `${protocolName}: and the quantity must survive the narrowing`);
  assert.equal(Number(line.lineTotal), 30, `${protocolName}: as must the money`);
  for (const field of LINE_FIELDS_WITH_NO_READER) {
    assert.ok(!(field in line), `${protocolName}: ${field} has no reader and must not be pulled per line`);
  }

  assert.equal(bill.payments.length, 1, `${protocolName}: the tender must be pulled`);
  const [tender] = bill.payments;
  assert.deepEqual(
    Object.keys(tender).sort(),
    PAYMENT_SHAPE,
    `${protocolName}: the replica's payment shape is the same audit the bills list carries`,
  );
  assert.equal(Number(tender.amount), 30, `${protocolName}: the tender's money must match`);
  assert.equal(tender.mode, "cash");
  for (const field of PAYMENT_FIELDS_WITH_NO_READER) {
    assert.ok(!(field in tender), `${protocolName}: ${field} has no reader that reaches it through a bill`);
  }

  // The one deliberate difference from the /api/bills replica. A pulled line has
  // never carried its addons — the client's pull writer does not read them — so
  // adding them would put data on every device's sync that nothing consumes.
  // Asserted so the divergence stays a decision rather than an accident.
  assert.ok(!("addons" in line), `${protocolName}: a pulled line carries no addons, by decision`);
}

/* ---------------------------- the since= protocol ------------------------- */

const since = await pullSince(shop.id, new Date(0).toISOString(), { role: "owner" });
assert.equal(since.bills.length, 1, "the bill must be pulled by timestamp");
assertReplicaShape(since.bills[0], "since=");

/* --------------------------- the afterSeq protocol ------------------------ */

// A different function loads these rows (loadSequenceEntities, not pullSince's own
// query), so the shape has to be proved separately or one of the two drifts wide.
const bySeq = await pullSince(shop.id, undefined, { afterSeq: "0", role: "owner" });
assert.equal(bySeq.sync.protocol, "server_sequence_v2", "the sequence feed must be what answered");
const billChange = bySeq.changes.find((change) => change.entity_type === "bill" && change.entity);
assert.ok(billChange, "the sequence feed must carry the bill");
assertReplicaShape(billChange.entity, "afterSeq=");

/* ------------------- the two protocols agree with each other -------------- */

assert.deepEqual(
  Object.keys(since.bills[0].items[0]).sort(),
  Object.keys(billChange.entity.items[0]).sort(),
  "both pull protocols must replicate a line identically",
);
assert.deepEqual(
  Object.keys(since.bills[0].payments[0]).sort(),
  Object.keys(billChange.entity.payments[0]).sort(),
  "and a tender identically",
);

console.log("Sync pull replica shape examples passed");
