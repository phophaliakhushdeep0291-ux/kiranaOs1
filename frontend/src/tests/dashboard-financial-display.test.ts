import { beforeEach, describe, expect, it } from "vitest";
import { aggregateFinancialRows } from "@/features/core/finance/services/FinancialAggregationService";
import { buildDashboardStats, dashboardCashInDrawer } from "@/features/core/dashboard/financial-display";
import { getLocalDashboardSnapshot } from "@/features/core/reports/queries";
import { writeInstantMemoryCache } from "@/lib/offline/instant-cache";
import type { LocalReportSnapshot } from "@/features/core/reports/local-reporting";

const date = "2026-10-03";
const staleCustomers = [{ customerId: "settled", customerName: "Settled customer", amount: 100, outstanding: 100 }];

beforeEach(() => {
  for (const key of ["bills", "customers", "customer_ledger"]) writeInstantMemoryCache(key, []);
});

describe("dashboard financial values", () => {
  it("does not hide backend results behind an unpopulated instant cache", () => {
    const result = buildDashboardStats({ date, localSnapshot: getLocalDashboardSnapshot(),
      backendPnL: { revenue: 121.5, grossProfit: 21.5, grossMarginPct: 17.7, cost: 100, totalBills: 1, cashSales: 121.5, upiSales: 0, udharSales: 0 },
      paymentSummary: { cash: 121.5, upi: 0, credit: 0, total: 121.5 }, billsToday: { total: 1 },
      udharSummary: { totalOutstanding: 100, customers: staleCustomers },
    });
    expect(result).toMatchObject({ revenue: 121.5, grossProfit: 21.5, cashCollected: 121.5, totalOutstanding: 100, billCount: 1 });
  });

  it("preserves an authoritative zero and empty debtor list after settlement", () => {
    const result = buildDashboardStats({ date,
      localSnapshot: { ...getLocalDashboardSnapshot(), hasCache: true, totalOutstanding: 100, outstandingCustomers: staleCustomers },
      financialSnapshot: aggregateFinancialRows({ date }),
      udharSummary: { totalOutstanding: 100, customers: staleCustomers },
    });
    expect(result.totalOutstanding).toBe(0);
    expect(result.outstandingCustomers).toEqual([]);
    expect(result.source).toBe("IndexedDB");
  });

  it("keeps a negative expected drawer and paise separate from collected cash", () => {
    const finance = aggregateFinancialRows({ date, openingCash: 50, cashExpenses: 171.5 });
    const stats = buildDashboardStats({ date, localSnapshot: getLocalDashboardSnapshot(), financialSnapshot: finance });
    expect(stats.cashCollected).toBe(0);
    expect(dashboardCashInDrawer(finance, null, stats)).toBe(-121.5);
  });

  it("does not use a week's collections or drawer as today's totals while finance loads", () => {
    const report = { range: { from: "2026-09-27", to: date }, today: { sales: 25.5, cashSales: 25.5, upiSales: 0, bankSales: 0, udharSales: 0 },
      paymentBreakdown: { cashIn: 999, purchaseCashPaid: 800, netCashInHand: 199 }, hasLocalData: true,
    } as LocalReportSnapshot;
    const stats = buildDashboardStats({ date, localSnapshot: getLocalDashboardSnapshot(), ownerReport: report });
    expect(stats.cashCollected).toBe(25.5);
    expect(stats.supplierCashPaid).toBe(0);
    expect(dashboardCashInDrawer(null, report, stats)).toBe(25.5);
  });

  it("counts every outstanding customer, including those after the first fifty", () => {
    writeInstantMemoryCache("customers", Array.from({ length: 61 }, (_, index) => ({ id: `c${index}`, name: `Customer ${index}`, udharAmount: 10.25 })));
    const cached = getLocalDashboardSnapshot();
    expect(cached.totalOutstanding).toBe(625.25);
    expect(cached.outstandingCustomers).toHaveLength(61);
  });

  it("recognizes a ledger-only cache as financial data", () => {
    writeInstantMemoryCache("customer_ledger", [{ id: "opening", customerId: "c1", type: "BILL", amount: 10.25 }]);
    expect(getLocalDashboardSnapshot()).toMatchObject({ hasCache: true, totalOutstanding: 10.25 });
  });
});
