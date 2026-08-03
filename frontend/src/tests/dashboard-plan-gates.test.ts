import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("src/features/core/dashboard/pages/DashboardPage.tsx", "utf8");

describe("dashboard plan-gated backend fallbacks", () => {
  it("does not call the backend P&L endpoint unless profit/loss reports are included", () => {
    expect(dashboard).toContain("useFeature(\"profit_loss_estimate\")");
    expect(dashboard).toContain("const canFetchBackendPnL = profitEstimateFeature.allowed");
    expect(dashboard).toContain("enabled: canFetchBackendPnL");
    expect(dashboard).toContain("retry: 0");
    expect(dashboard).toContain("const backendPnL = canFetchBackendPnL ? pnl.data : undefined");
  });
});
