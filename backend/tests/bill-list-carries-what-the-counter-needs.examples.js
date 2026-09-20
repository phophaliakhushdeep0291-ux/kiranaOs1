/**
 * The bills list is not a summary — it is the shop's offline copy.
 *
 * Its rows are written straight into IndexedDB by cacheBills(), and from there they
 * become the receipt the shop reprints, the text it shares on WhatsApp, the lines the
 * cancel dialog offers, the item count on the customer's ledger, and the fallback the
 * bill detail page renders when sync has not filled bill_items yet. loadBillDetail
 * never calls GET /bills/:id — it reads IndexedDB. So a column dropped from this list
 * is a column the counter does not have when the internet is gone.
 *
 * That is why the narrowing here is small and specific. `include: { items, payments,
 * location, giftCardTransactions }` sent all ~70 Bill columns, all 40 BillItem columns,
 * the same 16-column Location row once per bill, and gift-card rows. Three of those are
 * read nowhere in the app and are gone. Everything else stays, including the pricing
 * provenance the detail page shows, and Payment whole — not because a particular
 * column is read, but because this is the replica and Payment has not been audited
 * column by column.
 *
 * Both halves matter:
 *   GONE — the unread stay unread, so the list does not silently go wide again.
 *   KEPT — every field an offline screen reads is still on the row. This is the half
 *          that fails quietly: a missing column renders as blank on a reprinted
 *          receipt, and nobody finds out until a customer is standing there.
 */

import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import db from "../src/db.js";
import { confirmBill, listBills } from "../src/modules/bills/bills.service.js";
import { createProduct } from "../src/modules/products/products.service.js";
import { billQuerySchema } from "../src/modules/bills/bills.schema.js";

const shop = await db.shop.create({
  data: { name: "Bill list shape proof", ownerName: "Owner", city: "Indore", address: "1 Test Road" },
});
const owner = await db.user.create({
  data: {
    shopId: shop.id, name: "Owner", mobile: "9000000801", role: "owner",
    passwordHash: await bcrypt.hash("password", 10), pinHash: await bcrypt.hash("4242", 10),
  },
});
const user = { userId: owner.id, id: owner.id, role: "owner", shopId: shop.id };

const product = await createProduct(shop.id, {
  name: "Listed Biscuit", category: "Biscuits",
  displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
  defaultPricePerRateUnit: 10, costPerRateUnit: 6, mrp: 12,
  stockBaseQty: 100, gstRate: 5, isLooseItem: false,
}, { actor: { userId: owner.id } });

await confirmBill(shop.id, {
  billType: "normal_sale", gstMode: "inclusive", customerName: "Walk-in",
  items: [{ productId: product.id, name: product.name, quantity: 3, enteredUnit: "piece", ratePerRateUnit: 10 }],
  payments: [{ mode: "cash", amount: 30 }],
  discount: 0, offerDiscount: 0, waivedAmount: 0, roundOff: false, sensitiveActions: [],
  idempotencyKey: "bill-list-shape-1",
}, user);

const { bills } = await listBills(shop.id, { status: "active", page: 1, limit: 50 });
assert.equal(bills.length, 1, "the bill must be listed");
const [bill] = bills;
const [line] = bill.items;

/* ------------------------- what the counter still gets -------------------- */

// The bill row itself is untouched — no select on it, so a new Bill column keeps
// arriving without anyone editing this file.
for (const field of ["id", "billNo", "businessDate", "billType", "status", "customerName",
  "subtotal", "discount", "gst", "gstMode", "grandTotal", "paidAmount", "creditAmount"]) {
  assert.ok(field in bill, `the list must still carry bill.${field}`);
}

// Payment stays whole in the replica view.
assert.equal(bill.payments.length, 1);
assert.ok("amountPaise" in bill.payments[0], "the offline copy keeps Payment whole until its columns are audited");
assert.equal(Number(bill.payments[0].amount), 30);

// Every line field an offline screen reads. Asserted by name, because these are the
// ones that fail silently — a blank on a reprinted receipt, not an error.
for (const field of [
  "id", "billId", "productId", "name", "quantity", "enteredUnit", "baseUnit",
  "quantityInBaseUnit", "rateUnit", "ratePerRateUnit", "costPerRateUnit", "gstRate", "hsn",
  "conversionToBase", "sellingUnitId", "sellingUnitCode", "sellingUnitLabel",
  "originalBillItemId", "note",
  "lineDiscount", "lineTotal", "lineCost", "lineProfit", "originalUnitPrice",
  // The detail page explains WHY a price was what it was; that needs its provenance.
  "appliedPricingRuleId", "appliedPricingRuleType", "pricingExplanation",
  "pricingConfidence", "pricingCalculationVersion",
  "wasPriceOverridden", "priceOverrideReason", "priceApprovedByUserId",
  "addons",
]) {
  assert.ok(field in line, `a reprinted receipt needs item.${field}`);
}
assert.equal(Number(line.quantity), 3);
assert.equal(Number(line.lineTotal), 30);

/* ----------------------------- and what it does not ----------------------- */

for (const field of ["location", "giftCardTransactions"]) {
  assert.ok(!(field in bill), `${field} has no reader in the app and must not be sent per bill`);
}
for (const field of ["ratePerRateUnitPaise", "costPerRateUnitPaise", "lineDiscountPaise",
  "lineTotalPaise", "lineCostPaise", "lineProfitPaise", "originalUnitPricePaise"]) {
  assert.ok(!(field in line), `${field} has no reader in the app and must not be sent per line`);
}

/* --------------------------- the size of the answer ----------------------- */

// Unbounded, one caller asking for 100000 would build the shop's whole trading
// history in memory and serialise it. 2000 is what the app's offline cache warm
// actually asks for, so the product is unchanged.
assert.equal(billQuerySchema.parse({ limit: "2000" }).limit, 2000, "the app's own request must still be honoured");
assert.throws(() => billQuerySchema.parse({ limit: "100000" }), /Too big|less than or equal/i, "but an unbounded one must not be");
assert.throws(() => billQuerySchema.parse({ limit: "0" }), /Too small|greater than or equal/i);
assert.equal(billQuerySchema.parse({}).limit, 50, "and the default is unchanged");

/* ================== the SCREEN's view, which is a different job ============= */

// view=list renders a row: number, date, customer, total, how it was paid, how
// many lines. It is not the offline copy, so it does not carry the lines — and
// because it is not, it must never be what gets replicated. The client guards
// that end (frontend: src/tests/lean-bill-list-keeps-the-offline-copy.test.ts).

const listView = await listBills(shop.id, { status: "active", page: 1, limit: 50, view: "list" });
assert.equal(listView.view, "list", "the response says which shape it is, so the client can decide how to cache it");
const [row] = listView.bills;

// The count replaces the lines. The screen reads items.length with an itemCount
// fallback; this makes the fallback the answer.
assert.ok(!("items" in row), "the screen's row must not carry the lines");
assert.equal(row.itemCount, 1, "it carries how many there were");
assert.ok(!("_count" in row), "and Prisma's own shape does not reach the wire");

// Everything a row renders.
for (const field of ["id", "billNo", "billType", "status", "customerId", "customerName",
  "grandTotal", "paidAmount", "buyerPaidAmount", "creditAmount",
  "businessDate", "createdAt", "deletedAt", "cancelledAt", "createdByUserId", "locationId"]) {
  assert.ok(field in row, `the bills screen renders ${field}`);
}
assert.equal(Number(row.grandTotal), Number(bill.grandTotal), "and the money must match the full view exactly");

// The three that look droppable and are not.
//
// billIdentityKeys() collapses a pending local bill against its synced twin on
// clientBillId/idempotencyKey. Without them the client falls back to a content
// signature computed FROM THE ITEMS — which this shape does not send — so the
// fallback silently does nothing and the shop sees the same sale listed twice.
assert.ok("clientBillId" in row, "dedupe matches the pending twin on clientBillId");
assert.ok("idempotencyKey" in row, "or on idempotencyKey");
assert.ok("refundMode" in row, "resolveReturnRefundMode reads refundMode before it looks at payments");
assert.ok("returnOfBillId" in row, "and a sales return has to be recognisable as one");
assert.ok("updatedAt" in row, "the display dedupe sorts on updatedAt to pick the newer of a pair");

// Payments narrowed to what the row computes with: billPaid sums non-credit
// amounts, paymentModeOf reads the modes.
assert.equal(row.payments.length, 1);
assert.deepEqual(Object.keys(row.payments[0]).sort(), ["amount", "mode"]);
assert.equal(Number(row.payments[0].amount), 30);

/* ------------------- and the default is still the offline copy ------------- */

const defaulted = await listBills(shop.id, { status: "active", page: 1, limit: 50 });
assert.equal(defaulted.view, "full", "an unasked view stays the full one");
assert.ok(Array.isArray(defaulted.bills[0].items), "so every existing caller keeps its lines");
assert.equal(billQuerySchema.parse({}).view, "full", "including anyone reading the schema's default");
assert.equal(billQuerySchema.parse({ view: "list" }).view, "list");
assert.throws(() => billQuerySchema.parse({ view: "lean" }), /Invalid/i, "and a typo is refused, not silently treated as full");

console.log("Bill list shape examples passed");
