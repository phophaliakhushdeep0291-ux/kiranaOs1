import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { aggregateFinancialRows } from "@/features/core/finance/services/FinancialAggregationService";
import { buildDashboardStats } from "@/features/core/dashboard/financial-display";
import { getLocalDashboardSnapshot } from "@/features/core/reports/queries";
import { writeInstantMemoryCache } from "@/lib/offline/instant-cache";
import type { LocalReportSnapshot } from "@/features/core/reports/local-reporting";

/**
 * Home asked the server for today's profit, payment summary, udhar summary and
 * bill count, and the refresh after every sale asked again on every counter with
 * Home open. buildDashboardStats shows each of them only while the device has no
 * figure of its own, so that is the only time they are fetched.
 */

const page = readFileSync("src/features/core/dashboard/pages/DashboardPage.tsx", "utf8");
const date = "2026-10-09";

const server = {
  backendPnL: { revenue: 901, grossProfit: 301, grossMarginPct: 33, cost: 600, totalBills: 9, cashSales: 901, upiSales: 0, udharSales: 0 },
  paymentSummary: { cash: 501, upi: 201, bank: 101, credit: 98, total: 901 },
  billsToday: { total: 9 },
  udharSummary: { totalOutstanding: 777, customers: [{ customerId: "server-only", customerName: "Server only", outstanding: 777 }] },
};

function report(pendingUdhar: number) {
  return {
    range: { from: date, to: date },
    today: { sales: 40, bills: 2, cashSales: 30, upiSales: 10, bankSales: 0, udharSales: 0, paymentsReceived: 0, discount: 0, profitEstimate: 8 },
    paymentBreakdown: { cashIn: 30, upiIn: 10, bankIn: 0, purchaseCashPaid: 0, purchaseUpiPaid: 0, purchaseBankPaid: 0, purchaseDue: 0, netCashInHand: 30 },
    pendingUdhar,
    hasLocalData: true,
  } as unknown as LocalReportSnapshot;
}

beforeEach(() => {
  for (const key of ["bills", "customers", "customer_ledger"]) writeInstantMemoryCache(key, []);
});

describe("Home's server reports", () => {
  it("are fetched only while the device has no figures of its own", () => {
    expect(page).toContain("const needsServerFigures = !financialSnapshot && !ownerReport && !localSnapshot.hasCache;");
    expect(page).toContain("const needsServerDebtors = !financialSnapshot && !localSnapshot.hasCache;");
    expect(page).toContain("useGetPnL({ from: today, to: today }, { query: { enabled: canFetchBackendPnL && needsServerFigures,");
    expect(page).toContain("useGetUdharSummary({ query: { enabled: needsServerDebtors,");
    expect(page).toContain("useGetPaymentSummary({ from: today, to: today }, { query: { enabled: needsServerFigures,");
    expect(page).toContain("useListBills({ from: today, to: today, limit: 1 }, { query: { enabled: needsServerFigures,");
  });

  it("are still what Home shows on a device with nothing of its own", () => {
    const stats = buildDashboardStats({ date, localSnapshot: getLocalDashboardSnapshot(), ...server });
    expect(stats).toMatchObject({ revenue: 901, cash: 501, billCount: 9, totalOutstanding: 777, source: "backend refresh" });
    expect(stats.outstandingCustomers).toEqual(server.udharSummary.customers);
  });

  // If one of these stops holding, a server figure can be what the owner sees,
  // and the gates above must widen with it.
  it("are never shown once the device's financial snapshot is read, even an empty one", () => {
    const local = { date, localSnapshot: getLocalDashboardSnapshot(), financialSnapshot: aggregateFinancialRows({ date }) };
    expect(buildDashboardStats({ ...local, ...server })).toEqual(buildDashboardStats(local));
  });

  it("are never shown while the instant cache has figures", () => {
    const local = { date, localSnapshot: { ...getLocalDashboardSnapshot(), hasCache: true } };
    expect(buildDashboardStats({ ...local, ...server })).toEqual(buildDashboardStats(local));
  });

  it("are not shown beside the local report, except the debtor list while udhar is pending", () => {
    const settled = { date, localSnapshot: getLocalDashboardSnapshot(), ownerReport: report(0) };
    expect(buildDashboardStats({ ...settled, ...server })).toEqual(buildDashboardStats(settled));

    // Why the udhar summary waits for the financial snapshot rather than the report.
    const pending = { date, localSnapshot: getLocalDashboardSnapshot(), ownerReport: report(120) };
    const { outstandingCustomers, ...figures } = buildDashboardStats({ ...pending, ...server });
    const { outstandingCustomers: localDebtors, ...localFigures } = buildDashboardStats(pending);
    expect(figures).toEqual(localFigures);
    expect(localDebtors).toEqual([]);
    expect(outstandingCustomers).toEqual(server.udharSummary.customers);
  });
});
