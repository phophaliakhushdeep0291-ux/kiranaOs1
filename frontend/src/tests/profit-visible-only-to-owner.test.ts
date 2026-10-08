import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { userHasPermission } from "@/features/core/staff/role-access";

/**
 * Profit is the owner's number. A cashier's or viewer's device is never sent
 * cost prices, so wherever the dashboard or reports fell back to working profit
 * out locally they reckoned every item at zero cost and showed the day's sales
 * as "Profit (Est.)" — on the cashier's home screen, every day. A manager was
 * shown a figure too, though the server keeps the P&L for the owner.
 */
describe("who is shown profit", () => {
  it("is the owner alone", () => {
    expect(userHasPermission({ role: "owner" }, "view_profit")).toBe(true);
    for (const role of ["admin", "staff", "viewer"]) {
      expect(userHasPermission({ role }, "view_profit"), role).toBe(false);
    }
  });

  it("follows the permission list the server sent with the login", () => {
    expect(userHasPermission({ role: "admin", permissions: ["view_reports", "view_profit"] } as never, "view_profit")).toBe(true);
    expect(userHasPermission({ role: "admin", permissions: ["view_reports"] } as never, "view_profit")).toBe(false);
  });
});

describe("the dashboard", () => {
  const dashboard = readFileSync("src/features/core/dashboard/pages/DashboardPage.tsx", "utf8");

  it("asks the server for the P&L only for a role that may see it", () => {
    expect(dashboard).toContain('const canViewProfit = userHasPermission(user, "view_profit");');
    expect(dashboard).toContain("const canFetchBackendPnL = profitEstimateFeature.allowed && canViewProfit;");
  });

  it("shows no profit figure, on any layout, to a role that may not see it", () => {
    expect(dashboard).toContain('{canViewProfit ? <KpiCard\n          label={t("dashboard.kpi.profitEst")}');
    expect(dashboard).toContain('{canViewProfit ? <MobileHealthCard href="/reports" label={t("dashboard.kpi.grossProfit")}');
    expect(dashboard).toContain("{canViewProfit ? <StatCard label={t(dbCfg.kpi.profit)}");
    expect(dashboard).toContain('{canViewProfit ? <p className="mt-1 text-xs text-muted-foreground">{t("dashboard.tile.grossMargin"');
    expect(dashboard).toContain('if (next === "profit" && !canViewProfit) return;');
    // Every profit label the page renders is one of the guarded ones above.
    expect(dashboard.match(/t\("dashboard\.kpi\.(profitEst|grossProfit)"\)/g)).toHaveLength(2);
    expect(dashboard.match(/t\(dbCfg\.kpi\.profit\)/g)).toHaveLength(1);
  });
});

describe("the reports overview", () => {
  const reports = readFileSync("src/features/core/reports/pages/ReportsPage.tsx", "utf8");

  it("drops the profit tiles, the margin column and the phone's profit tiles for such a role", () => {
    expect(reports).toContain('const canViewProfit = userHasPermission(user, "view_profit");');
    expect(reports).toContain('const PROFIT_KPI_IDS = new Set(["profit", "net"]);');
    expect(reports).toContain("kpis.filter((kpi) => canViewProfit || !PROFIT_KPI_IDS.has(kpi.id))");
    expect(reports).toContain('...(canViewProfit ? ["Margin (%)"] : [])');
    expect(reports).toContain('{canViewProfit ? <MobilePulseTile label="Profit (Est.)"');
    expect(reports).toContain('{canViewProfit ? <MobilePulseTile label="Net Profit"');
  });
});
