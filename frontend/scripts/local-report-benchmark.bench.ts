import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("@/lib/offline/db", () => ({
  offlineDB: { getAll: async (table: string) => state.rows[table] ?? [] },
  filterRowsForCurrentScope: <T>(rows: T[]) => rows,
}));
vi.mock("@/features/core/sync/local-data-hardening", () => ({
  hardenLocalFinancialData: async () => undefined,
}));

import { buildDailyClosingReport, buildLocalReportSnapshot } from "@/features/core/reports/local-reporting";

function fixture(count: number) {
  const products = Array.from({ length: 1000 }, (_, i) => ({
    id: `product-${i}`, name: `Product ${i}`, category: "grocery",
    baseUnit: "piece", stockUnit: "piece", rateUnit: "piece",
    costPrice: 60, stockBaseQty: 20, lowStockThreshold: 5,
  }));
  const bills = [], bill_items = [], payments = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(2026, 9, 2 - (i % 365), 12)).toISOString();
    const billId = `bill-${i}`;
    bills.push({
      id: billId, billNumber: billId, billType: "normal_sale", status: "paid",
      grandTotal: 100.25, totalAmount: 100.25, paidAmount: 100.25,
      buyerPaidAmount: 100.25, creditAmount: 0, createdAt: at, created_at: at,
      sync_status: "synced",
    });
    bill_items.push({
      id: `item-${i}`, billId, bill_id: billId, productId: products[i % 1000].id,
      name: products[i % 1000].name, quantity: 1, lineTotal: 100.25,
      ratePerRateUnit: 100.25, costPrice: 60, sync_status: "synced",
    });
    payments.push({
      id: `payment-${i}`, billId, bill_id: billId, kind: "bill_payment",
      mode: i % 2 ? "upi" : "cash", amount: 100.25, status: "active",
      paidAt: at, created_at: at, sync_status: "synced",
    });
  }
  return { products, bills, bill_items, payments };
}

it("measures report computation with a year of bills; excludes database I/O and rendering", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  try {
    const measurements = [];
    for (const count of [1000, 10000]) {
      state.rows = fixture(count);
      const closingTimes = [], reportTimes = [];
      let closing;
      let report;
      for (let run = 0; run < 3; run++) {
        let started = performance.now();
        closing = await buildDailyClosingReport("2026-10-02", { openingCash: 500, cashExpenses: 50.25 });
        closingTimes.push(performance.now() - started);
        started = performance.now();
        report = await buildLocalReportSnapshot({ from: "2025-10-03", to: "2026-10-02" });
        reportTimes.push(performance.now() - started);
      }
      expect(closing!.billCount).toBe(Math.ceil(count / 365));
      expect(closing!.totalSales).toBe(Math.ceil(count / 365) * 100.25);
      expect(closing!.expectedCashInDrawer).toBe(500 + Math.ceil(Math.ceil(count / 365) / 2) * 100.25 - 50.25);
      expect(report!.selected.sales).toBe(count * 100.25);
      expect(report!.selected.bills).toBe(count);
      expect(report!.selected.profitEstimate).toBe(count * 40.25);
      expect(report!.paymentBreakdown.cash).toBe(count / 2 * 100.25);
      expect(report!.paymentBreakdown.upi).toBe(count / 2 * 100.25);
      expect(report!.dailyTrend).toHaveLength(31);
      const median = (values: number[]) => values.sort((a, b) => a - b)[1];
      measurements.push({ bills: count, products: 1000, closingMedianMs: +median(closingTimes).toFixed(2), yearReportMedianMs: +median(reportTimes).toFixed(2), closing, report });
    }
    const result = {
      note: "Synthetic local computation only. In-memory read fixture; excludes IndexedDB, browser rendering and networking. Three-run medians.",
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      measurements,
    };
    const outputPath = process.env.REPORT_BENCHMARK_OUTPUT;
    if (outputPath) writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, measurements: measurements.map(({ closing, report, ...measurement }) => measurement) }, null, 2));
  } finally { vi.useRealTimers(); }
});
