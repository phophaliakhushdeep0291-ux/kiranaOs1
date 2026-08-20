import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { billCreationSchema } from "@/lib/validation";

const billsPage = readFileSync("src/features/core/bills/pages/BillsPage.tsx", "utf8");
const billingEn = readFileSync("src/features/core/settings/translations/billing.ts", "utf8");
const billDetailPage = readFileSync("src/features/core/bills/pages/BillDetailPage.tsx", "utf8");
const billingPage = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
const billingSummary = readFileSync("src/features/core/billing/pages/components/BillingSummary.tsx", "utf8");
const paymentPanel = readFileSync("src/features/core/billing/pages/components/BillingPaymentPanel.tsx", "utf8");
const validationSchemas = readFileSync("src/lib/validation/schemas.ts", "utf8");

// Estimates (kacha bills) work the same as real bills — stock, payments, udhar, reports —
// and differ ONLY by their EST- number series plus estimate-specific views/filters.
describe("estimate bills work like real bills under their own number series", () => {
  it("keeps the EST- number series and estimate views", () => {
    expect(billingPage).toContain('EST-${year}-LOCAL-');
    expect(billsPage).toContain('function activeEstimateRows');
    expect(billsPage).toContain('value: "estimate", label: t("billing.bills.tab.estimate")');
    expect(billsPage).toContain('Clear Estimates');
    expect(billsPage).toContain('clear_estimates');
    // Wording moved into the dictionary; the estimate/real split is still pinned.
    expect(billsPage).toContain('billing.bills.moveEstimateToBin');
    expect(billingEn).toContain('"billing.bills.moveEstimateToBin": "Move estimate to recycle bin"');
  });

  it("counts estimates in the bill-history stats like real sales", () => {
    // Cancellation reverses the sale; history deletion only hides its row.
    expect(billsPage).toContain('return rows.filter((bill) => bill.status !== "cancelled" && !isMergedTwin(bill));');
    expect(billsPage).not.toContain('!isEstimateBill(bill) && !isDeleted(bill)');
  });

  it("gives estimate rows the same actions and payment badges as real bills", () => {
    // No estimate-only gating on return/refund or cancel.
    expect(billsPage).not.toContain('{!estimate && <DropdownMenuItem onClick={() => refundReverse(bill)}>');
    expect(billsPage).not.toContain('{!estimate && bill.status !== "cancelled"');
    // Payment mode badge renders for every row — the old "No payment" estimate badge is gone.
    expect(billsPage).not.toContain('No payment</span>');
    // Bill detail allows returns/edit for estimates too.
    expect(billDetailPage).toContain('billTypeStr !== "sales_return";');
    expect(billDetailPage).not.toContain('billTypeStr !== "estimate"');
  });

  it("labels estimate billing as a first-class bill type with the same payment options", () => {
    expect(billingSummary).toContain('billing.summary.estimateBill');
    expect(billingSummary).toContain('billing.summary.saveEstimateAction');
    expect(billingSummary).toContain('data-testid="button-bill-type-pakka"');
    expect(billingSummary).toContain('data-testid="button-bill-type-estimate"');
    // Estimates share the Pakka payment selector (cash/UPI/split/udhar); the old quote-only
    // "no payment" panel is gone.
    expect(paymentPanel).not.toContain('estimate-payment-panel');
    expect(paymentPanel).not.toContain('No payment saved');
    expect(billingPage).toContain('if (getPrinterConfigSync().autoPrint)');
  });

  it("prevents a GST invoice from being saved with GST disabled", () => {
    expect(validationSchemas).toContain('bill.billType === "gst_invoice" && bill.gstMode === "none"');
    expect(billingPage).toContain('nextBillType === BillInputBillType.gst_invoice && getTaxConfigSync().mode === "none"');
    expect(billingEn).toContain('"billing.page.gstModeRequired"');
    const common = {
      items: [{ name: "Taxed item", quantity: 1, enteredUnit: "piece", ratePerRateUnit: 118, lineDiscount: 0, gstRate: 18 }],
      payments: [{ mode: "cash" as const, amount: 118 }],
    };
    expect(billCreationSchema.safeParse({ ...common, billType: "gst_invoice", gstMode: "none" }).success).toBe(false);
    expect(billCreationSchema.safeParse({ ...common, billType: "gst_invoice", gstMode: "inclusive" }).success).toBe(true);
    expect(billCreationSchema.safeParse({ ...common, billType: "normal_sale", gstMode: "none" }).success).toBe(true);
  });
});
