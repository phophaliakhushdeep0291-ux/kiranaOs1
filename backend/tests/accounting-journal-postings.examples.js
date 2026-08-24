import assert from "assert";
import {
  postBillCreatedLedger,
  postExpenseEffectLedger,
  postPurchaseReceiptLedger,
  postPurchaseReturnCancelledLedger,
  postPurchaseReturnCreatedLedger,
  postSaleReturnLedger,
} from "../src/modules/finance/financial-ledger.service.js";
import { buildAccountingControl } from "../src/modules/finance/accounting-control.service.js";

function capture() {
  const rows = [];
  return {
    rows,
    tx: { financialLedger: { create: async ({ data }) => { rows.push({ id: `row-${rows.length + 1}`, ...data }); return data; } } },
  };
}

function byType(rows) {
  return [...rows].sort((left, right) => left.entryType.localeCompare(right.entryType));
}

const date = new Date("2026-07-22T10:00:00.000Z");

let proof = capture();
await postBillCreatedLedger(proof.tx, {
  shopId: "shop-1",
  bill: { id: "gst-sale-1", grandTotal: 118, gst: 18, createdAt: date },
  tenderPayments: [{ id: "cash-payment-1", mode: "cash", amount: 118 }],
});
assert.deepEqual(byType(proof.rows).map((row) => [row.entryType, row.amountPaise]), [
  ["cash_in", 11800n],
  ["gst_output", 1800n],
  ["gst_sales_reclassification", 1800n],
  ["sale", 11800n],
]);
let control = buildAccountingControl(proof.rows);
assert.equal(control.status, "balanced", "GST sale must stay balanced after output-tax reclassification");
assert.equal(control.trialBalance.accounts.find((account) => account.code === "4000")?.creditBalance.amount, 100, "net sales exclude output GST");
assert.equal(control.trialBalance.accounts.find((account) => account.code === "2200")?.creditBalance.amount, 18, "output GST remains an explicit liability");

await assert.rejects(
  () => postBillCreatedLedger(capture().tx, {
    shopId: "shop-1",
    bill: { id: "bad-sale", grandTotal: 300, gst: 0, createdAt: date },
    tenderPayments: [{ id: "bad-payment", mode: "cash", amount: 120 }],
  }),
  (error) => error?.code === "BILL_ACCOUNTING_EVIDENCE_MISMATCH",
  "a bill must never post when its tender evidence disagrees with its total",
);

await postSaleReturnLedger(proof.tx, {
  shopId: "shop-1",
  bill: { id: "gst-return-1", grandTotal: -118, gst: -18, createdAt: date, payments: [{ id: "refund-1", mode: "cash", amount: -118 }] },
  refundMode: "cash",
  refundAmount: 118,
});
await assert.rejects(
  () => postSaleReturnLedger(capture().tx, {
    shopId: "shop-1",
    bill: { id: "bad-return", grandTotal: -118, gst: -18, createdAt: date, payments: [{ id: "bad-refund", mode: "cash", amount: -100 }] },
    refundMode: "cash",
    refundAmount: 118,
  }),
  (error) => error?.code === "SALE_RETURN_PAYMENT_EVIDENCE_MISMATCH",
  "a return must never post when its linked refund payment disagrees with the return total",
);
control = buildAccountingControl(proof.rows);
assert.equal(control.status, "balanced");
assert.equal(control.trialBalance.debit.paise, 0, "full GST return must reverse every account balance");
assert.equal(control.trialBalance.credit.paise, 0);

proof = capture();
await postPurchaseReceiptLedger(proof.tx, {
  shopId: "shop-1",
  supplierId: "supplier-1",
  receipt: { id: "receipt-1", totalAmount: 1000, paidAmount: 300, dueAmount: 700, paymentMode: "upi", createdAt: date },
});
assert.deepEqual(byType(proof.rows).map((row) => [row.entryType, row.amountPaise]), [
  ["inventory_purchase", 100000n],
  ["supplier_payable", 70000n],
  ["upi_out", 30000n],
]);
assert.ok(proof.rows.every((row) => row.purchaseBillId === "receipt-1"));
control = buildAccountingControl(proof.rows);
assert.equal(control.status, "balanced", "purchase principal must balance inventory against paid and due legs");
assert.equal(control.trialBalance.accounts.find((account) => account.code === "1200")?.debitBalance.amount, 1000);
assert.equal(control.trialBalance.accounts.find((account) => account.code === "2000")?.creditBalance.amount, 700);

proof = capture();
const purchaseReturn = {
  id: "purchase-return-1",
  purchaseReceiptId: "receipt-1",
  supplierId: "supplier-1",
  totalAmount: 500,
  supplierCreditAmount: 300,
  refundAmount: 200,
  refundMode: "bank",
  createdAt: date,
};
await postPurchaseReturnCreatedLedger(proof.tx, { shopId: "shop-1", purchaseReturn });
await postPurchaseReturnCancelledLedger(proof.tx, { shopId: "shop-1", purchaseReturn, businessDate: date });
control = buildAccountingControl(proof.rows);
assert.equal(control.status, "balanced", "purchase return and cancellation must each be balanced source groups");
assert.equal(control.coverage.balancedGroups, 2);
assert.equal(control.trialBalance.debit.paise, 0, "cancelled purchase return must net every account to zero");
assert.equal(control.trialBalance.credit.paise, 0);

proof = capture();
await postExpenseEffectLedger(proof.tx, {
  shopId: "shop-1",
  expense: { id: "paid-expense", amount: 250, status: "paid", paymentMode: "cash", spentAt: date },
  keyBase: "expense:paid-expense:create",
});
await postExpenseEffectLedger(proof.tx, {
  shopId: "shop-1",
  expense: { id: "pending-expense", amount: 400, status: "pending", paymentMode: "bank", spentAt: date },
  keyBase: "expense:pending-expense:create",
});
control = buildAccountingControl(proof.rows);
assert.equal(control.status, "balanced", "paid and pending expenses must use tender and accrued-payable credit legs respectively");
assert.equal(control.trialBalance.accounts.find((account) => account.code === "6000")?.debitBalance.amount, 650);
assert.equal(control.trialBalance.accounts.find((account) => account.code === "2300")?.creditBalance.amount, 400);
assert.equal(control.trialBalance.accounts.find((account) => account.code === "1000")?.creditBalance.amount, 250);
assert.ok(control.limitations.some((item) => item.includes("do not yet contain enough immutable tax evidence")), "input-tax limits must be explicit");

console.log("accounting-journal-postings.examples.js OK");
