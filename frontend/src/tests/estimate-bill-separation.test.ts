import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const billsPage = readFileSync("src/features/bills/pages/BillsPage.tsx", "utf8");
const billingPage = readFileSync("src/features/billing/pages/BillingPage.tsx", "utf8");
const billingSummary = readFileSync("src/features/billing/pages/components/BillingSummary.tsx", "utf8");
const paymentPanel = readFileSync("src/features/billing/pages/components/BillingPaymentPanel.tsx", "utf8");

describe("estimate bill workflow separation", () => {
  it("keeps estimates separate from real sales in bill history", () => {
    expect(billsPage).toContain('function activeEstimateRows');
    expect(billsPage).toContain('totalBills: currentReal.length');
    expect(billsPage).toContain('sparkFromRows(periodBills, sparkEnd, (rows) => realSaleRows(rows).length)');
    expect(billsPage).toContain('No payment');
    expect(billsPage).toContain('Clear Estimates');
    expect(billsPage).toContain('clear_estimates');
    expect(billsPage).toContain('Move estimate to recycle bin');
  });

  it("does not expose sale-only actions for estimate rows", () => {
    expect(billsPage).toContain('{!estimate && <DropdownMenuItem onClick={() => refundReverse(bill)}>');
    expect(billsPage).toContain('{!estimate && bill.status !== "cancelled"');
  });

  it("labels estimate billing as a first-class bill type with the same payment options", () => {
    expect(billingSummary).toContain('Estimate Bill');
    expect(billingSummary).toContain('Save Estimate Bill');
    expect(billingSummary).toContain('data-testid="button-bill-type-pakka"');
    expect(billingSummary).toContain('data-testid="button-bill-type-estimate"');
    // Estimates now share the Pakka payment selector (cash/UPI/split/udhar); the old quote-only
    // "no payment" panel is gone.
    expect(paymentPanel).not.toContain('estimate-payment-panel');
    expect(paymentPanel).not.toContain('No payment saved');
    expect(billingPage).toContain('EST-${year}-LOCAL-');
    expect(billingPage).toContain('if (getPrinterConfigSync().autoPrint)');
  });
});
