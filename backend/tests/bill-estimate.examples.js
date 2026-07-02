import assert from "node:assert/strict";

function requiresPayment(billType) {
  return billType !== "estimate";
}

// Mirrors bills.service.js createBill: estimates record the real tender collected (cash/UPI)
// so the bill + receipt show what was paid, but they never carry credit/udhar, never move
// stock, and never post P&L or the financial ledger. Reports keep them out via billType filter.
function normalizeEstimateBill({ billType, payments = [], itemProfit = 0, creditAmount = 0, waivedAmount = 0 }) {
  const isEstimate = billType === "estimate";
  const billPayments = isEstimate ? payments.filter((p) => p.mode !== "credit") : payments;
  const tenderPaid = billPayments
    .filter((p) => p.mode !== "credit")
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    paymentsToCreate: billPayments,
    shouldDeductStock: !isEstimate,
    shouldCreateStockLedger: !isEstimate,
    shouldCreateUdharEntry: !isEstimate && creditAmount > 0,
    shouldPostFinancialLedger: !isEstimate,
    grossProfit: isEstimate ? 0 : itemProfit - waivedAmount,
    paidAmount: tenderPaid,
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
    payments: [{ mode: "cash", amount: 23 }, { mode: "credit", amount: 10 }],
    itemProfit: 3,
    creditAmount: 10,
    waivedAmount: 2,
  }),
  {
    paymentsToCreate: [{ mode: "cash", amount: 23 }],
    shouldDeductStock: false,
    shouldCreateStockLedger: false,
    shouldCreateUdharEntry: false,
    shouldPostFinancialLedger: false,
    grossProfit: 0,
    paidAmount: 23,
    creditAmount: 0,
    waivedAmount: 0,
  },
  "estimate should record real tender but create no stock/udhar/P&L side effects"
);

assert.deepEqual(
  normalizeEstimateBill({
    billType: "estimate",
    payments: [],
  }),
  {
    paymentsToCreate: [],
    shouldDeductStock: false,
    shouldCreateStockLedger: false,
    shouldCreateUdharEntry: false,
    shouldPostFinancialLedger: false,
    grossProfit: 0,
    paidAmount: 0,
    creditAmount: 0,
    waivedAmount: 0,
  },
  "estimate without tender stays a pure quote"
);

assert.deepEqual(
  normalizeEstimateBill({
    billType: "normal_sale",
    payments: [{ mode: "cash", amount: 23 }],
    itemProfit: 3,
    creditAmount: 0,
    waivedAmount: 0,
  }),
  {
    paymentsToCreate: [{ mode: "cash", amount: 23 }],
    shouldDeductStock: true,
    shouldCreateStockLedger: true,
    shouldCreateUdharEntry: false,
    shouldPostFinancialLedger: true,
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
