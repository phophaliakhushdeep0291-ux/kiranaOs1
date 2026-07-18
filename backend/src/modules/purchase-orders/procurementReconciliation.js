import { round2, subtractMoney, sumMoney } from "../../utils/money.js";

export const PURCHASE_MATCH_TOLERANCE = 0.01;

function hasMoneyVariance(value) {
  return Math.abs(round2(Number(value || 0))) > PURCHASE_MATCH_TOLERANCE;
}

export function calculateReceiptReconciliation({
  expectedAmounts,
  actualAmounts,
  supplierInvoiceNumber,
  supplierInvoiceAmount,
  varianceReason,
  approvedByUserId,
}) {
  const expectedGoodsAmount = sumMoney(expectedAmounts.map((value) => Number(value || 0)));
  const goodsReceivedAmount = sumMoney(actualAmounts.map((value) => Number(value || 0)));
  const priceVarianceAmount = subtractMoney(goodsReceivedAmount, expectedGoodsAmount);
  const hasInvoiceNumber = typeof supplierInvoiceNumber === "string" && supplierInvoiceNumber.trim().length > 0;
  const hasInvoiceAmount = supplierInvoiceAmount !== undefined && supplierInvoiceAmount !== null && Number.isFinite(Number(supplierInvoiceAmount));
  const normalizedInvoiceAmount = hasInvoiceAmount ? round2(Number(supplierInvoiceAmount)) : null;
  const invoiceVarianceAmount = normalizedInvoiceAmount === null
    ? null
    : subtractMoney(normalizedInvoiceAmount, goodsReceivedAmount);
  const invoiceEvidenceComplete = hasInvoiceNumber && normalizedInvoiceAmount !== null;
  const hasVariance = hasMoneyVariance(priceVarianceAmount) || (invoiceVarianceAmount !== null && hasMoneyVariance(invoiceVarianceAmount));
  const hasApproval = typeof varianceReason === "string" && varianceReason.trim().length >= 3 && Boolean(approvedByUserId);
  const approvalRequired = invoiceEvidenceComplete && hasVariance && !hasApproval;

  return {
    expectedGoodsAmount,
    goodsReceivedAmount,
    supplierInvoiceAmount: normalizedInvoiceAmount,
    priceVarianceAmount,
    invoiceVarianceAmount,
    invoiceEvidenceComplete,
    hasVariance,
    approvalRequired,
    matchStatus: !invoiceEvidenceComplete
      ? "invoice_pending"
      : hasVariance
        ? hasApproval ? "approved_variance" : "variance_pending"
        : "matched",
  };
}

export function summarizePurchaseOrderReconciliation(order) {
  const receipts = Array.isArray(order?.receipts) ? order.receipts : [];
  const items = Array.isArray(order?.items) ? order.items : [];
  const allGoodsReceived = items.length > 0 && items.every((item) => Number(item.receivedBaseQty || 0) + 0.001 >= Number(item.orderedBaseQty || 0));
  const invoicePendingCount = receipts.filter((receipt) => receipt.matchStatus === "invoice_pending").length;
  const approvedVarianceCount = receipts.filter((receipt) => receipt.matchStatus === "approved_variance").length;
  const matchedCount = receipts.filter((receipt) => receipt.matchStatus === "matched").length;
  const expectedGoodsAmount = sumMoney(receipts.map((receipt) => Number(receipt.expectedGoodsAmount || 0)));
  const goodsReceivedAmount = sumMoney(receipts.map((receipt) => Number(receipt.totalAmount || 0)));
  const supplierInvoiceAmount = sumMoney(receipts.map((receipt) => Number(receipt.supplierInvoiceAmount || 0)));
  const priceVarianceAmount = subtractMoney(goodsReceivedAmount, expectedGoodsAmount);
  const invoiceVarianceAmount = subtractMoney(supplierInvoiceAmount, goodsReceivedAmount);

  const status = receipts.length === 0
    ? "not_received"
    : invoicePendingCount > 0
      ? "invoice_pending"
      : !allGoodsReceived
        ? "partial_delivery"
        : approvedVarianceCount > 0
          ? "approved_variance"
          : "matched";

  return {
    status,
    allGoodsReceived,
    receiptCount: receipts.length,
    matchedCount,
    approvedVarianceCount,
    invoicePendingCount,
    expectedGoodsAmount,
    goodsReceivedAmount,
    supplierInvoiceAmount,
    priceVarianceAmount,
    invoiceVarianceAmount,
  };
}
