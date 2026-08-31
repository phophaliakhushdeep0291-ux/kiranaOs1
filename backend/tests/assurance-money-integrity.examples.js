import assert from "node:assert/strict";
import fs from "node:fs";
import { billingRules } from "../src/modules/assurance/rules/billing.rules.js";
import { cashClosingRules } from "../src/modules/assurance/rules/cash-closing.rules.js";
import { computeOutstanding, customerCreditRules } from "../src/modules/assurance/rules/customer-credit.rules.js";
import { expenseRules } from "../src/modules/assurance/rules/expense.rules.js";
import { purchaseRules } from "../src/modules/assurance/rules/purchase.rules.js";
import { syncIntegrityRules } from "../src/modules/assurance/rules/sync-integrity.rules.js";
import { moneyDiffers, sum } from "../src/modules/assurance/rule.interface.js";

function rule(rules, code) {
  const found = rules.find((candidate) => candidate.ruleCode === code);
  assert.ok(found, `Missing assurance rule ${code}`);
  return found;
}

function triggered(verdict, message) {
  assert.equal(verdict?.triggered, true, message);
  return verdict;
}

assert.equal(moneyDiffers(121.5, 121.50), false, "equivalent rupee values must match");
assert.equal(moneyDiffers(122, 121.99), true, "one paisa must never be hidden");
assert.equal(sum([49, 72.5]), 121.5, "mixed rupee and paisa values must sum through integer paise");

const paidExceeds = rule(billingRules, "BILL_PAID_EXCEEDS_TOTAL");
const paymentRowsMatch = rule(billingRules, "BILL_MARKED_PAID_WITHOUT_PAYMENTS");
const returnLedgerCredit = rule(billingRules, "UDHAR_RETURN_MISSING_LEDGER_CREDIT");
const udharReturn = {
  id: "return-udhar-1",
  billType: "sales_return",
  refundMode: "udhar",
  status: "active",
  customerId: "customer-1",
  grandTotal: -121.5,
  paidAmount: 0,
  creditAmount: -121.5,
  payments: [],
};
assert.equal(paidExceeds.evaluate({ bill: udharReturn }), null, "udhar return without cash tender is not an overpayment");
assert.equal(paymentRowsMatch.evaluate({ bill: udharReturn }), null, "zero paid amount correctly matches zero tender rows");
const missingCredit = triggered(returnLedgerCredit.evaluate({ bill: udharReturn, udharRows: [] }), "missing udhar return credit must be detected");
assert.equal(missingCredit.details.differenceRupees, 121.5, "return discrepancy must be an absolute rupee amount");
assert.equal(returnLedgerCredit.evaluate({
  bill: udharReturn,
  udharRows: [{ type: "payment", mode: "return", amount: 121.5, reversedAt: null }],
}), null, "matching udhar return credit must pass");

const cashReturn = { ...udharReturn, id: "return-cash-1", refundMode: "cash", paidAmount: -121.5, creditAmount: 0 };
assert.equal(paymentRowsMatch.evaluate({
  bill: { ...cashReturn, payments: [{ amount: -121.5, status: "confirmed" }] },
}), null, "confirmed negative refund tender must reconcile");
triggered(paymentRowsMatch.evaluate({
  bill: { ...cashReturn, payments: [{ amount: -121.5, status: "pending" }] },
}), "pending refund tender must not be treated as settled");
triggered(paymentRowsMatch.evaluate({
  bill: { ...cashReturn, paidAmount: -121.5, payments: [{ amount: -121.49, status: "confirmed" }] },
}), "one-paisa refund mismatch must be detected");

const ledgerAt = "2026-07-29T10:00:00.000Z";
const exactLedger = [
  { id: "debit", type: "debit", amount: 121.5, createdAt: ledgerAt },
  { id: "payment", type: "payment", amount: 121.49, createdAt: ledgerAt },
];
assert.deepEqual(computeOutstanding(exactLedger), {
  rawBalance: 0.01,
  balance: 0.01,
  debitSum: 121.5,
  paymentSum: 121.49,
  rowCount: 2,
}, "udhar balance must retain the last paisa");
triggered(rule(customerCreditRules, "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING").evaluate({
  ledger: [
    { id: "debit", type: "debit", amount: 121.5, createdAt: ledgerAt },
    { id: "overpayment", type: "payment", amount: 121.51, mode: "cash", createdAt: ledgerAt },
  ],
}), "one-paisa udhar overpayment must be detected");
triggered(rule(customerCreditRules, "UDHAR_LARGE_MANUAL_ADJUSTMENT").evaluate({
  settings: { largeAdjustmentPaise: 500000 },
  ledger: [{ id: "negative-adjustment", type: "payment", amount: -5000.01, mode: "manual", billId: null, createdAt: ledgerAt }],
}), "large negative manual adjustments must not escape the threshold");

const closingContext = {
  settings: { closingDifferenceAlertPaise: 20000 },
  snapshot: {
    totalSalesPaise: 20000,
    cashReceivedPaise: 20000,
    upiReceivedPaise: 0,
    oldUdharRecoveredPaise: 0,
    expectedCashPaise: 14000,
    totalBills: 1,
    lockedAt: null,
  },
  bills: [{ id: "sale-1", billNo: "KOS-1", billType: "sale", status: "active", grandTotal: 200, paidAmount: 200 }],
  payments: [
    { id: "cash-confirmed", billId: "sale-1", mode: "cash", amount: 200, status: "confirmed" },
    { id: "cash-pending", billId: "sale-1", mode: "cash", amount: 999, status: "pending" },
  ],
  udharPayments: [],
  expenses: [
    { id: "expense-paid", status: "paid", paymentMode: "cash", amount: 20 },
    { id: "expense-pending", status: "pending", paymentMode: "cash", amount: 500 },
  ],
  purchaseReceipts: [{ id: "receipt-1", paymentMode: "cash", paidAmount: 50 }],
  quickPurchases: [],
  purchaseReturns: [{ id: "purchase-return-1", refundMode: "cash", refundAmount: 10 }],
};
assert.equal(rule(cashClosingRules, "CLOSING_CASH_FIGURE_STALE").evaluate(closingContext), null, "pending payment rows must not inflate closing cash");
assert.equal(rule(cashClosingRules, "CLOSING_CASH_EXPENSES_NOT_DEDUCTED").evaluate(closingContext), null, "expected cash must include all recorded cash in and out");
const onePaisaClosing = triggered(rule(cashClosingRules, "CLOSING_CASH_EXPENSES_NOT_DEDUCTED").evaluate({
  ...closingContext,
  snapshot: { ...closingContext.snapshot, expectedCashPaise: 14001 },
}), "one-paisa expected-cash mismatch must be detected");
assert.equal(onePaisaClosing.details.differencePaise, 1);
triggered(rule(cashClosingRules, "CLOSING_SPLIT_PAYMENT_MISMATCH").evaluate({
  ...closingContext,
  bills: [{ ...closingContext.bills[0], paidAmount: 199.99 }],
}), "one-paisa tender split mismatch must be detected");
const physicalVariance = triggered(rule(cashClosingRules, "CLOSING_PHYSICAL_CASH_VARIANCE").evaluate({
  ...closingContext,
  snapshot: {
    ...closingContext.snapshot,
    openingCashPaise: 1000,
    manualCashInPaise: 500,
    manualCashOutPaise: 200,
    drawerExpectedCashPaise: 15300,
    countedCashPaise: 15299,
    cashVariancePaise: -1,
    cashCountRevision: 1,
  },
}), "a one-paisa physical drawer shortage must be detected");
assert.equal(physicalVariance.details.variancePaise, -1);
assert.equal(rule(cashClosingRules, "CLOSING_PHYSICAL_COUNT_MISSING").evaluate({
  ...closingContext,
  snapshot: { ...closingContext.snapshot, lockedAt: "2026-08-30T18:00:00.000Z", countedCashPaise: null },
})?.triggered, true, "a locked close must not omit its physical drawer count");

triggered(rule(purchaseRules, "PURCHASE_PAYMENT_EXCEEDS_TOTAL").evaluate({
  purchaseKind: "history",
  history: { billAmount: 100, purchasePaidAmount: 100.01 },
}), "one-paisa supplier overpayment must be detected");
triggered(rule(purchaseRules, "PURCHASE_MARKED_PAID_WITHOUT_PAYMENT").evaluate({
  purchaseKind: "history",
  history: { billAmount: 100, purchasePaidAmount: 99.99, purchasePaymentStatus: "paid" },
}), "one-paisa supplier payment shortfall must be detected");
triggered(rule(purchaseRules, "PURCHASE_AMOUNT_ITEM_TOTAL_MISMATCH").evaluate({
  purchaseKind: "receipt",
  receipt: { totalAmount: 100, items: [{ lineAmount: 99.99 }] },
}), "one-paisa purchase line mismatch must be detected");

triggered(rule(syncIntegrityRules, "BILL_MISSING_CHILD_ROWS").evaluate({
  bill: { grandTotal: 0.01, items: [], payments: [] },
}), "a one-paisa bill without items is still a partial financial record");

const materialExpenseSettings = { expenseReceiptRequiredAbovePaise: 100000 };
assert.equal(rule(expenseRules, "EXPENSE_UNATTRIBUTED").evaluate({
  settings: materialExpenseSettings,
  expense: { amount: 5000, recordedBy: "Owner User", recordedByUserId: "owner-1" },
}), null, "a material expense with a trusted creator id must pass attribution");
triggered(rule(expenseRules, "EXPENSE_UNATTRIBUTED").evaluate({
  settings: materialExpenseSettings,
  expense: { amount: 5000, recordedBy: "Owner User", recordedByUserId: null },
}), "a legacy free-text name must not be mistaken for authenticated attribution");
assert.equal(rule(expenseRules, "EXPENSE_ACTOR_SCOPE_MISMATCH").evaluate({
  shopId: "shop-1",
  expense: { recordedByUserId: "owner-1", recordedByRole: "owner" },
  expenseActor: { id: "owner-1", shopId: "shop-1" },
}), null, "a creator who belongs to the expense shop must pass scope validation");
triggered(rule(expenseRules, "EXPENSE_ACTOR_SCOPE_MISMATCH").evaluate({
  shopId: "shop-1",
  expense: { recordedByUserId: "owner-2", recordedByRole: "owner" },
  expenseActor: { id: "owner-2", shopId: "shop-2" },
}), "a creator id from another shop must be treated as an integrity incident");

const contextSource = fs.readFileSync("src/modules/assurance/context.service.js", "utf8");
assert.match(contextSource, /businessDate: \{ gte: dayStart, lte: dayEnd \}/, "closing assurance must use economic business date");
assert.match(contextSource, /const locationScope = snapshot\.storeId \? \{ locationId: snapshot\.storeId \} : \{\}/, "closing assurance must scope branch snapshots");
assert.match(contextSource, /startOfZonedDay\(new Date\(date\), env\.DAILY_CLOSING_TIMEZONE\)/, "closing assurance must use shop timezone boundaries");

const reportsSource = fs.readFileSync("src/modules/reports/reports.service.js", "utf8");
assert.match(reportsSource, /payment\.status === "confirmed"/, "financial reports must count only confirmed tenders");
assert.match(reportsSource, /subtractMoney\(addMoney\(cashReceived, cashPurchaseRefunds\), supplierCashPaid, cashExpensesPaid\)/, "daily closing must include recorded drawer inflows and outflows");

console.log("Financial assurance money integrity checks passed.");
