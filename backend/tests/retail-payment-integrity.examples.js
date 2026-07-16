import assert from "node:assert/strict";
import { validateRetailUpiPayment } from "../src/modules/payment-provider/retailPayment.validation.js";

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
console.log("Retail payment integrity examples passed");
