import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/db.js";
import { productData } from "./integration/factories.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import { confirmBill } from "../src/modules/bills/bills.service.js";

/**
 * The UTR from the shop's own UPI QR.
 *
 * There is no gateway in that flow: the guest's app moves the money bank-to-bank
 * and this software is never told it happened. So the reference a cashier types
 * is not evidence, and must never be recorded as though a provider supplied it.
 * What it IS good for is day close — it is the one string that matches this bill
 * against a line on a bank statement instead of trusting the counter forever.
 */

const shop = await db.shop.create({ data: {
  name: `UTR ${Date.now()}`, ownerName: "O", city: "C", address: "A",
  settingsJson: JSON.stringify({
    businessProfile: { businessType: "restaurant" },
    bank: { upi: "flowcafe@okhdfcbank", holder: "Flow Cafe" },
  }),
} });
const location = await resolveOperationalLocation(shop.id);

const chai = await db.product.create({ data: productData(shop.id, { name: "Masala Chai", defaultPricePerRateUnit: 40, stockBaseQty: 100 }) });
await db.productSellingUnit.create({ data: {
  shopId: shop.id, productId: chai.id, name: "glass", unitType: "piece", unitCode: `glass-${chai.id}`,
  conversionToBase: 1, defaultPrice: 40, isDefault: true,
} });

const sell = (payment) => confirmBill(shop.id, {
  clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "Walk-in",
  discount: 0, locationId: location.id,
  items: [{ productId: chai.id, name: chai.name, quantity: 1, enteredUnit: "glass", ratePerRateUnit: 40, gstRate: 0, lineDiscount: 0 }],
  payments: [payment],
}, { deviceId: "till", allowStockShortfall: true });

const paymentFor = async (bill) => db.payment.findFirstOrThrow({ where: { billId: bill.id ?? bill.bill?.id } });

/* ------------------------------- a UTR is kept, and kept in its place */

const withUtr = await sell({ mode: "upi", amount: 40, upiReference: "412345678901" });
const recorded = await paymentFor(withUtr);

assert.equal(recorded.providerReference, "412345678901", "the reference is stored where day close can find it");
assert.equal(
  recorded.confirmationSource, "manual",
  "and the payment stays operator-confirmed — a typed reference is not a provider saying so",
);
assert.equal(recorded.provider, "manual", "no provider was involved, and none is claimed");
assert.equal(recorded.mode, "upi");

/* --------------------------------- and is optional, because it is a courtesy */

const withoutUtr = await sell({ mode: "upi", amount: 40 });
const bare = await paymentFor(withoutUtr);
assert.equal(bare.providerReference, null, "a cashier who does not have the UTR to hand is not blocked from billing");
assert.equal(bare.confirmationSource, "manual");

/* ------------------------------- a shape UPI would reject never reaches the DB */

// Asserted against the schema, because that is the layer that guards it. The
// service takes what it is handed — a request reaches it only through the route,
// where zod has already run, and testing confirmBill directly would prove
// nothing about what a client can actually send.
const { confirmBillSchema } = await import("../src/modules/bills/bills.schema.js");
const validBill = {
  clientBillId: randomUUID(), billType: "normal_sale", gstMode: "none", customerName: "Walk-in",
  discount: 0, locationId: location.id,
  items: [{ productId: chai.id, name: chai.name, quantity: 1, enteredUnit: "glass", ratePerRateUnit: 40, gstRate: 0, lineDiscount: 0 }],
};

assert.ok(
  confirmBillSchema.safeParse({ ...validBill, payments: [{ mode: "upi", amount: 40, upiReference: "412345678901" }] }).success,
  "a real UTR is accepted",
);
assert.ok(
  !confirmBillSchema.safeParse({ ...validBill, payments: [{ mode: "upi", amount: 40, upiReference: "not a utr!" }] }).success,
  "spaces and punctuation are refused at the edge, not stored and puzzled over at day close",
);
assert.ok(
  !confirmBillSchema.safeParse({ ...validBill, payments: [{ mode: "upi", amount: 40, upiReference: "123" }] }).success,
  "and something too short to be a reference is not a reference",
);

console.log("upi-reference-recording: ok");
