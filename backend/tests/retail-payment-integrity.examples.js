import assert from "node:assert/strict";
import { validateRetailQrPayment, validateRetailUpiPayment } from "../src/modules/payment-provider/retailPayment.validation.js";

const intent = { amountPaise: 12550, currency: "INR" };
const payment = {
  id: "pay_retail_1",
  order_id: "order_retail_1",
  amount: 12550,
  currency: "INR",
  status: "captured",
  captured: true,
  method: "upi",
};
const order = { id: "order_retail_1", amount: 12550, currency: "INR", status: "paid" };

assert.equal(validateRetailUpiPayment(intent, order.id, payment.id, payment, order).valid, true);

for (const [label, override] of [
  ["method", { method: "card" }],
  ["amount", { amount: 12551 }],
  ["currency", { currency: "USD" }],
  ["status", { status: "authorized", captured: false }],
  ["order", { order_id: "order_other" }],
]) {
  const result = validateRetailUpiPayment(intent, order.id, payment.id, { ...payment, ...override }, order);
  assert.equal(result.valid, false, `${label} mismatch must be rejected`);
}

assert.equal(validateRetailUpiPayment(intent, order.id, payment.id, payment, { ...order, status: "attempted" }).valid, false);

const qrIntent = { id: "intent_qr_1", shopId: "shop_1", locationId: "location_1", checkoutMode: "dynamic_qr", providerQrCodeId: "qr_1", amountPaise: 12550, currency: "INR" };
const qrCode = { id: "qr_1", type: "upi_qr", usage: "single_use", fixed_amount: true, payment_amount: 12550, notes: { intentId: "intent_qr_1", shopId: "shop_1", locationId: "location_1" } };
assert.equal(validateRetailQrPayment(qrIntent, qrCode, payment).valid, true);
for (const [label, invalidQr, invalidPayment] of [
  ["QR id", { ...qrCode, id: "qr_other" }, payment],
  ["variable amount", { ...qrCode, fixed_amount: false }, payment],
  ["multiple use", { ...qrCode, usage: "multiple_use" }, payment],
  ["intent binding", { ...qrCode, notes: { ...qrCode.notes, intentId: "intent_other" } }, payment],
  ["tenant binding", { ...qrCode, notes: { ...qrCode.notes, shopId: "shop_other" } }, payment],
  ["branch binding", { ...qrCode, notes: { ...qrCode.notes, locationId: "location_other" } }, payment],
  ["payment amount", qrCode, { ...payment, amount: 12551 }],
  ["payment method", qrCode, { ...payment, method: "card" }],
  ["capture status", qrCode, { ...payment, status: "authorized", captured: false }],
]) {
  assert.equal(validateRetailQrPayment(qrIntent, invalidQr, invalidPayment).valid, false, `${label} mismatch must fail closed`);
}
console.log("Retail payment integrity examples passed");
