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
 * provenance the detail page shows and Payment.amountPaise, which the client reads in
 * dozens of places.
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

// Payments whole, amountPaise included: the client reads it in dozens of places.
assert.equal(bill.payments.length, 1);
assert.ok("amountPaise" in bill.payments[0], "Payment.amountPaise is read by the client and must stay");
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

console.log("Bill list shape examples passed");
