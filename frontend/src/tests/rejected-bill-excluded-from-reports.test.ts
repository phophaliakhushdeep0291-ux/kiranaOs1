import { describe, expect, it } from "vitest";
import { aggregateFinancialRows } from "@/features/finance/services/FinancialAggregationService";

const date = "2026-06-06";

function bill(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    billNo: id,
    billNumber: id,
    billType: "normal_sale",
    status: "active",
    grandTotal: 100,
    totalAmount: 100,
    paidAmount: 100,
    buyerPaidAmount: 100,
    creditAmount: 0,
    grossProfit: 40,
    createdAt: `${date}T10:00:00.000`,
    created_at: `${date}T10:00:00.000`,
    sync_status: "synced",
    ...overrides,
  };
}

function totalsFor(bills: Array<Record<string, unknown>>) {
  return aggregateFinancialRows({ date, bills, billItems: [], payments: [], ledger: [], products: [], customers: [] });
}

describe("bills the server permanently rejected", () => {
  // Regression: a CREATE_BILL / CREATE_SALE_RETURN that came back CONFLICT left its optimistic
  // row live in IndexedDB (and in cache:bills, so it survived reloads). Local reports kept
  // counting revenue and profit the server had refused — permanent silent divergence.
  it("excludes a conflicted bill from revenue and profit", () => {
    const clean = totalsFor([bill("KOS-1")]);
    const withRejected = totalsFor([bill("KOS-1"), bill("KOS-REJECTED", { sync_status: "conflict" })]);

    expect(clean.revenueToday).toBe(100);
    expect(withRejected.revenueToday).toBe(100);
    expect(withRejected.profitToday).toBe(clean.profitToday);
  });

  it("still counts bills that are merely waiting to sync", () => {
    // Offline-first: a pending or retryable bill is real money already taken at the counter.
    // Excluding it would under-report every sale until the network came back.
    // Amounts/times differ so display de-duplication cannot collapse the two rows.
    const inFlight = (id: string, syncStatus: string) => bill(id, {
      sync_status: syncStatus,
      grandTotal: 250,
      totalAmount: 250,
      paidAmount: 250,
      buyerPaidAmount: 250,
      createdAt: `${date}T14:30:00.000`,
      created_at: `${date}T14:30:00.000`,
    });

    expect(totalsFor([bill("KOS-1"), inFlight("KOS-PENDING", "pending_sync")]).revenueToday).toBe(350);
    expect(totalsFor([bill("KOS-1"), inFlight("KOS-FAILED", "failed")]).revenueToday).toBe(350);
  });

  it("treats the camelCase syncStatus spelling the same way", () => {
    const withRejected = totalsFor([bill("KOS-1"), bill("KOS-REJECTED", { sync_status: undefined, syncStatus: "conflict" })]);
    expect(withRejected.revenueToday).toBe(100);
  });
});
