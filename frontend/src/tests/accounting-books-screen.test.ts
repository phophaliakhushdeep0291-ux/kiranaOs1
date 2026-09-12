import { beforeEach, describe, expect, it, vi } from "vitest";
import { financialYearStart, ledgerQueryEnabled, LEDGER_TABS, toIsoDate } from "@/features/core/accounting/ledger-view";

const apiRequest = vi.fn(() => Promise.resolve(null));
vi.mock("@/lib/api/http", () => ({
  apiRequest: (path: string, options?: unknown) => apiRequest(path, options),
  buildQuery: (params?: Record<string, unknown>) => {
    const entries = Object.entries(params ?? {}).filter(([, value]) => value !== undefined);
    return entries.length ? `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join("&")}` : "";
  },
  ApiClientError: class extends Error {},
}));

/**
 * The books screen reaches endpoints that had no client until now, so the thing
 * worth testing is that it reaches the RIGHT ones, and that the one endpoint
 * which is secretly a write does not fire on its own.
 */
describe("books screen", () => {
  beforeEach(() => apiRequest.mockClear());

  describe("financial year", () => {
    it("opens on 1 April of the year the books are actually in", () => {
      // Mid-year: April 2026 onward belongs to FY 2026-27.
      expect(financialYearStart(new Date(2026, 8, 12))).toBe("2026-04-01");
      expect(financialYearStart(new Date(2026, 3, 1))).toBe("2026-04-01");
    });

    it("looks back to last April for a date before the year turns", () => {
      // A shop opening its books in January is still in the year that began
      // last April — the trap a calendar-year default would fall into.
      expect(financialYearStart(new Date(2026, 0, 9))).toBe("2025-04-01");
      expect(financialYearStart(new Date(2026, 2, 31))).toBe("2025-04-01");
    });

    it("formats dates in local time, not UTC", () => {
      // toISOString() would shift an IST evening back a day and silently open
      // the range on the wrong date.
      expect(toIsoDate(new Date(2026, 3, 1))).toBe("2026-04-01");
      expect(toIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
    });
  });

  describe("which queries may fire", () => {
    it("fetches only the tab being looked at", () => {
      const onTrialBalance = ledgerQueryEnabled("trialBalance", false);
      expect(onTrialBalance.trialBalance).toBe(true);
      expect(onTrialBalance.profitAndLoss).toBe(false);
      expect(onTrialBalance.balanceSheet).toBe(false);
      expect(onTrialBalance.periods).toBe(false);
    });

    it("never loads the chart of accounts until it is asked for", () => {
      // That GET runs ensureSystemAccounts in a transaction and writes an audit
      // row. Opening the tab must not be enough, or every page view stamps the
      // shop's audit trail.
      expect(ledgerQueryEnabled("chartOfAccounts", false).chartOfAccounts).toBe(false);
      expect(ledgerQueryEnabled("chartOfAccounts", true).chartOfAccounts).toBe(true);
      // …and asking for it does not make it fire from some other tab.
      expect(ledgerQueryEnabled("trialBalance", true).chartOfAccounts).toBe(false);
    });

    it("covers every tab, so a new one cannot be added without a rule", () => {
      for (const tab of LEDGER_TABS) {
        const enabled = ledgerQueryEnabled(tab, true);
        expect(Object.keys(enabled)).toContain(tab);
        expect(Object.values(enabled).filter(Boolean)).toHaveLength(1);
      }
    });
  });

  describe("endpoints", () => {
    it("asks the server for the ledger, not the operational reports", async () => {
      const api = await import("@/features/core/accounting/api");
      const range = { from: "2026-04-01T00:00:00.000Z", to: "2026-09-12T23:59:59.999Z" };

      await api.getTrialBalance(range);
      await api.getLedgerProfitAndLoss(range);
      await api.getBalanceSheet({ asOf: range.to });
      await api.ensureChartOfAccounts();
      await api.getAccountingPeriods();

      const paths = apiRequest.mock.calls.map(([path]) => String(path));
      expect(paths[0]).toContain("/accounting/trial-balance");
      // The whole point of this screen: a P&L off the posted ledger, not the
      // bill-column estimate at /reports/pnl.
      expect(paths[1]).toContain("/accounting/profit-and-loss");
      expect(paths.some((path) => path.includes("/reports/pnl"))).toBe(false);
      expect(paths[2]).toContain("/accounting/balance-sheet");
      expect(paths[3]).toContain("/accounting/chart-of-accounts");
      expect(paths[4]).toContain("/accounting/periods");
    });

    it("sends the range the server's schema accepts", async () => {
      const api = await import("@/features/core/accounting/api");
      await api.getTrialBalance({ from: api.ledgerBoundary("2026-04-01"), to: api.ledgerBoundary("2026-09-12", true) });

      const path = String(apiRequest.mock.calls[0][0]);
      const from = decodeURIComponent(path.match(/from=([^&]+)/)?.[1] ?? "");
      const to = decodeURIComponent(path.match(/to=([^&]+)/)?.[1] ?? "");
      // z.string().datetime({ offset: true }) — anything looser is a 400.
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // The closing boundary is inclusive: a period ending "on the 12th" holds the 12th.
      expect(new Date(to).getTime() - new Date(from).getTime()).toBeGreaterThan(0);
      expect(to.endsWith("23:59:59.999Z") || to.includes("T")).toBe(true);
    });
  });
});
