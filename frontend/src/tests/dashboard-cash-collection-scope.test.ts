import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard cash collection scope", () => {
  it("uses today's report window for dashboard cash instead of selected range paymentBreakdown", () => {
    const source = readFileSync("src/features/core/dashboard/pages/DashboardPage.tsx", "utf8");
    expect(source).toContain("FinancialAggregationService.buildSnapshot(today)");
    expect(source).toContain("const cash = finance?.cashSalesToday");
    expect(source).toContain("const upi = finance?.upiSalesToday");
    expect(source).toContain("const credit = finance?.udharSalesToday");
    expect(source).not.toContain("const cash = reportPayments?.cash");
  });

  it("dedupes local payments before report cash calculations", () => {
    const source = readFileSync("src/features/core/reports/local-reporting.ts", "utf8");
    expect(source).toContain("dedupePaymentsForDisplay");
    expect(source).toContain("const payments = dedupePaymentsForDisplay(filterRowsForCurrentScope(paymentsRaw))");
  });
});
