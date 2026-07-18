import assert from "node:assert/strict";
import {
  calculateReceiptReconciliation,
  summarizePurchaseOrderReconciliation,
} from "../src/modules/purchase-orders/procurementReconciliation.js";

const matched = calculateReceiptReconciliation({
  expectedAmounts: [100, 50],
  actualAmounts: [100, 50],
  supplierInvoiceNumber: "INV-101",
  supplierInvoiceAmount: 150,
  approvedByUserId: "owner-1",
});
assert.deepEqual(matched, {
  expectedGoodsAmount: 150,
  goodsReceivedAmount: 150,
  supplierInvoiceAmount: 150,
  priceVarianceAmount: 0,
  invoiceVarianceAmount: 0,
  invoiceEvidenceComplete: true,
  hasVariance: false,
  approvalRequired: false,
  matchStatus: "matched",
});

const pending = calculateReceiptReconciliation({
  expectedAmounts: [100],
  actualAmounts: [100],
  supplierInvoiceNumber: "",
  supplierInvoiceAmount: null,
});
assert.equal(pending.matchStatus, "invoice_pending");
assert.equal(pending.invoiceEvidenceComplete, false);

const unexplainedVariance = calculateReceiptReconciliation({
  expectedAmounts: [100],
  actualAmounts: [105],
  supplierInvoiceNumber: "INV-102",
  supplierInvoiceAmount: 105,
  approvedByUserId: "owner-1",
});
assert.equal(unexplainedVariance.matchStatus, "variance_pending");
assert.equal(unexplainedVariance.priceVarianceAmount, 5);
assert.equal(unexplainedVariance.approvalRequired, true);

const approvedVariance = calculateReceiptReconciliation({
  expectedAmounts: [100],
  actualAmounts: [105],
  supplierInvoiceNumber: "INV-102",
  supplierInvoiceAmount: 107,
  varianceReason: "Approved supplier freight surcharge",
  approvedByUserId: "owner-1",
});
assert.equal(approvedVariance.matchStatus, "approved_variance");
assert.equal(approvedVariance.priceVarianceAmount, 5);
assert.equal(approvedVariance.invoiceVarianceAmount, 2);
assert.equal(approvedVariance.approvalRequired, false);

const orderSummary = summarizePurchaseOrderReconciliation({
  items: [{ orderedBaseQty: 10, receivedBaseQty: 10 }],
  receipts: [
    { matchStatus: "matched", expectedGoodsAmount: 100, totalAmount: 100, supplierInvoiceAmount: 100 },
    { matchStatus: "approved_variance", expectedGoodsAmount: 50, totalAmount: 55, supplierInvoiceAmount: 57 },
  ],
});
assert.equal(orderSummary.status, "approved_variance");
assert.equal(orderSummary.allGoodsReceived, true);
assert.equal(orderSummary.priceVarianceAmount, 5);
assert.equal(orderSummary.invoiceVarianceAmount, 2);

const partialSummary = summarizePurchaseOrderReconciliation({
  items: [{ orderedBaseQty: 10, receivedBaseQty: 5 }],
  receipts: [{ matchStatus: "matched", expectedGoodsAmount: 50, totalAmount: 50, supplierInvoiceAmount: 50 }],
});
assert.equal(partialSummary.status, "partial_delivery");

const pendingSummary = summarizePurchaseOrderReconciliation({
  items: [{ orderedBaseQty: 10, receivedBaseQty: 10 }],
  receipts: [{ matchStatus: "invoice_pending", expectedGoodsAmount: 100, totalAmount: 100, supplierInvoiceAmount: null }],
});
assert.equal(pendingSummary.status, "invoice_pending");
assert.equal(pendingSummary.invoicePendingCount, 1);

console.log("Procurement reconciliation examples passed");
