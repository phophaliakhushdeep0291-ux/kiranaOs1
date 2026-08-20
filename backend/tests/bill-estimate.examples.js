import assert from "node:assert/strict";
import { confirmBillSchema } from "../src/modules/bills/bills.schema.js";

// Estimates (kacha bills) work the same as real bills — they move stock, record payments,
// carry udhar, and count in sales/cash/P&L reports. The ONLY differences: their own EST-
// number series, and the GST report (an estimate is not a tax document). Legacy quote-era
// estimate ops (no payment data at all) are still accepted as unpaid so old offline queues
// can't get stuck in conflict.

function requiresPayment({ billType, payments = [], creditAmount = 0 }) {
  const legacyQuoteEstimate = billType === "estimate" && payments.length === 0 && creditAmount <= 0;
  return !legacyQuoteEstimate;
}

// Mirrors bills.service.js createBill — no estimate special-casing in the sale effects.
function normalizeBill({ billType, payments = [], itemProfit = 0, creditAmount = 0, waivedAmount = 0 }) {
  const tenderPaid = payments
    .filter((p) => p.mode !== "credit")
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    paymentsToCreate: payments.filter((p) => p.mode !== "credit"),
    shouldDeductStock: true,
    shouldCreateStockLedger: true,
    shouldCreateUdharEntry: creditAmount > 0,
    shouldPostFinancialLedger: true,
    grossProfit: itemProfit - waivedAmount,
    paidAmount: tenderPaid,
    creditAmount,
    waivedAmount,
    usesEstimateSeries: billType === "estimate",
  };
}

function gstReportFilter({ shopId, status = "active" }) {
  return {
    shopId,
    status,
    billType: { not: "estimate" },
  };
}

assert.equal(
  requiresPayment({ billType: "estimate", payments: [], creditAmount: 0 }),
  false,
  "legacy quote-shaped estimate (no payment data) is still accepted as unpaid"
);
assert.equal(
  requiresPayment({ billType: "estimate", payments: [{ mode: "cash", amount: 10 }] }),
  true,
  "estimate with payment data validates like a real bill"
);
assert.equal(requiresPayment({ billType: "normal_sale" }), true, "normal sale still requires payment");

assert.deepEqual(
  normalizeBill({
    billType: "estimate",
    payments: [{ mode: "cash", amount: 13.5 }, { mode: "credit", amount: 10 }],
    itemProfit: 3,
    creditAmount: 10,
    waivedAmount: 0,
  }),
  {
    paymentsToCreate: [{ mode: "cash", amount: 13.5 }],
    shouldDeductStock: true,
    shouldCreateStockLedger: true,
    shouldCreateUdharEntry: true,
    shouldPostFinancialLedger: true,
    grossProfit: 3,
    paidAmount: 13.5,
    creditAmount: 10,
    waivedAmount: 0,
    usesEstimateSeries: true,
  },
  "estimate behaves exactly like a real sale — stock, tender, udhar, ledger — under the EST- series"
);

const commonInvoice = {
  items: [{ name: "Taxed item", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 118, gstRate: 18 }],
  payments: [{ mode: "cash", amount: 118 }],
};
assert.equal(
  confirmBillSchema.safeParse({ ...commonInvoice, billType: "gst_invoice", gstMode: "none" }).success,
  false,
  "a GST invoice cannot disable GST",
);
assert.equal(
  confirmBillSchema.safeParse({ ...commonInvoice, billType: "gst_invoice", gstMode: "inclusive" }).success,
  true,
  "a GST invoice accepts inclusive GST",
);
assert.equal(
  confirmBillSchema.safeParse({ ...commonInvoice, billType: "normal_sale", gstMode: "none" }).success,
  true,
  "a non-tax Pakka bill may explicitly use no GST",
);

assert.deepEqual(
  normalizeBill({
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
    usesEstimateSeries: false,
  },
  "normal sale is unchanged"
);

assert.deepEqual(
  gstReportFilter({ shopId: "shop_1" }),
  { shopId: "shop_1", status: "active", billType: { not: "estimate" } },
  "only the GST report filters estimates out — every other report counts them as sales"
);

console.log("Bill estimate examples passed");
