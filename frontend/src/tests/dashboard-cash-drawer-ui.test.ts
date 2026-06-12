import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/dashboard/pages/DashboardPage.tsx", "utf8");

describe("dashboard cash and drawer math", () => {
  it("keeps collected cash/UPI separate from net drawer or bank totals", () => {
    expect(source).toContain("reportPayments?.cashIn ?? cashIn");
    expect(source).toContain("reportPayments?.upiIn ?? upiIn");
    expect(source).not.toContain("reportPayments?.netCashInHand ?? Math.max(0, cashIn - supplierCashPaid)");
    expect(source).not.toContain("upiIn - supplierUpiPaid");
  });

  it("uses the explicit drawer total when finance or local reports provide it", () => {
    expect(source).toContain("financialSnapshot?.cashDrawer.expectedClosingCash");
    expect(source).toContain("ownerReport?.paymentBreakdown.netCashInHand");
  });
});
