import { validateGstin, validateHsn } from "../../utils/gst.js";

export const TAX_REVIEW_VERSION = "tax-review-v1";

// This reviews data quality, not statutory eligibility or tax payable. Never
// infer ITC from a recorded purchase tax, or taxable profit from cash movements.
export function buildTaxReview({ register, purchases = [], expenses = [], locationId = null }) {
  const findings = new Map();
  function add(code, sourceType, sourceId) {
    const finding = findings.get(code) || { code, count: 0, sources: [] };
    finding.count += 1;
    if (finding.sources.length < 25) finding.sources.push({ type: sourceType, id: String(sourceId) });
    findings.set(code, finding);
  }
  const invoices = new Set();
  for (const row of register.rows) {
    const key = JSON.stringify([row.sellerGstin, row.invoiceNumber]);
    if (!invoices.has(key)) {
      invoices.add(key);
      if (!validateGstin(row.sellerGstin).valid) add("seller_registration", "invoice", row.invoiceNumber);
      if (row.buyerGstin && !validateGstin(row.buyerGstin).valid) add("buyer_registration", "invoice", row.invoiceNumber);
      if (row.documentType === "credit_note" && !row.originalInvoiceNumber) add("return_reference", "invoice", row.invoiceNumber);
    }
    if (!validateHsn(row.hsn).valid) add("hsn_review", "invoice", row.invoiceNumber);
    if (![row.taxableValue, row.cgst, row.sgst, row.igst].every((value) => typeof value === "number" && Number.isFinite(value))) {
      add("invalid_amount", "invoice", row.invoiceNumber);
    }
  }
  const purchaseKeys = new Set();
  for (const receipt of purchases) {
    if (!receipt.supplierInvoiceNumber?.trim() || receipt.supplierInvoiceAmount == null) add("purchase_invoice", "purchase_receipt", receipt.id);
    if (receipt.matchStatus !== "matched" && receipt.matchStatus !== "approved_variance") add("purchase_match", "purchase_receipt", receipt.id);
    // Multiple receipts can legitimately refer to one invoice. Flag for review,
    // never delete, merge, or count the repeated invoice as extra tax credit.
    if (receipt.supplierId && receipt.supplierInvoiceNumber?.trim()) {
      const key = JSON.stringify([receipt.supplierId, receipt.supplierInvoiceNumber.trim().toUpperCase()]);
      if (purchaseKeys.has(key)) add("repeated_purchase_invoice", "purchase_receipt", receipt.id);
      purchaseKeys.add(key);
    }
  }
  for (const expense of expenses) {
    if (!expense.vendor?.trim()) add("expense_vendor", "expense", expense.id);
  }
  return {
    schemaVersion: TAX_REVIEW_VERSION,
    status: "review_required",
    filingEnabled: false,
    period: { from: register.from, to: register.to },
    scope: { locationId, sellerGstin: register.registrationScope?.selectedGstin || null },
    coverage: { invoiceCount: invoices.size, purchaseReceiptCount: purchases.length, expenseCount: expenses.length },
    findings: [...findings.values()],
    // Always present, including when books are empty or every data check passes.
    requiredReviews: ["sync_completeness", "gst_registration_scheme", "gst2b_itc", "expense_tax_evidence", "other_gst_adjustments", "filing_provider"],
    itrChecklist: ["taxpayer_year", "all_businesses", "ais_26as", "other_income", "stock_assets_loans", "deductions_taxes", "regime_return_audit"],
  };
}
