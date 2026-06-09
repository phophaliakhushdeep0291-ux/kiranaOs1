import assert from "node:assert/strict";

function requiresPayment(billType) {
  return billType !== "estimate";
}

function normalizeEstimateBill({ billType, payments = [], itemProfit = 0, paidAmount = 0, creditAmount = 0, waivedAmount = 0 }) {
  const isEstimate = billType === "estimate";

  return {
    paymentsToCreate: isEstimate ? [] : payments,
    shouldDeductStock: !isEstimate,
    shouldCreateStockLedger: !isEstimate,
    shouldCreatePaymentEntry: !isEstimate,
    shouldCreateUdharEntry: !isEstimate && creditAmount > 0,
    grossProfit: isEstimate ? 0 : itemProfit - waivedAmount,
    paidAmount: isEstimate ? 0 : paidAmount,
    creditAmount: isEstimate ? 0 : creditAmount,
    waivedAmount: isEstimate ? 0 : waivedAmount,
  };
}

function reportBillFilter({ shopId, status = "active" }) {
  return {
    shopId,
    status,
    billType: { not: "estimate" },
  };
}

assert.equal(requiresPayment("estimate"), false, "estimate bill should be allowed without payments");
assert.equal(requiresPayment("normal_sale"), true, "normal sale should still require payment");
assert.equal(requiresPayment("gst_invoice"), true, "GST invoice should still require payment");
assert.equal(requiresPayment("udhar_entry"), true, "udhar entry should still require payment/credit entry");

assert.deepEqual(
  normalizeEstimateBill({
    billType: "estimate",
    payments: [{ mode: "cash", amount: 23 }],
    itemProfit: 3,
    paidAmount: 23,
    creditAmount: 10,
    waivedAmount: 2,
  }),
  {
    paymentsToCreate: [],
    shouldDeductStock: false,
    shouldCreateStockLedger: false,
    shouldCreatePaymentEntry: false,
    shouldCreateUdharEntry: false,
    grossProfit: 0,
    paidAmount: 0,
    creditAmount: 0,
    waivedAmount: 0,
  },
  "estimate should not create sale side effects or P&L profit"
);

assert.deepEqual(
  normalizeEstimateBill({
    billType: "normal_sale",
    payments: [{ mode: "cash", amount: 23 }],
    itemProfit: 3,
    paidAmount: 23,
    creditAmount: 0,
    waivedAmount: 0,
  }),
  {
    paymentsToCreate: [{ mode: "cash", amount: 23 }],
    shouldDeductStock: true,
    shouldCreateStockLedger: true,
    shouldCreatePaymentEntry: true,
    shouldCreateUdharEntry: false,
    grossProfit: 3,
    paidAmount: 23,
    creditAmount: 0,
    waivedAmount: 0,
  },
  "normal sale should still behave like a sale"
);

assert.deepEqual(
  reportBillFilter({ shopId: "shop_1" }),
  { shopId: "shop_1", status: "active", billType: { not: "estimate" } },
  "reports should filter estimates out of sale/P&L calculations"
);

console.log("Bill estimate examples passed");
