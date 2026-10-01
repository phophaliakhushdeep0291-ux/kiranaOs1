import { describe, expect, it } from "vitest";
import { expenseLocationUnknown, expenseOverview, expenseSummaryWindowStart, expensesForLocation, shopDayKey } from "@/features/core/expenses/overview";
import type { Expense } from "@/types/api";

const now = new Date("2026-09-30T19:00:00Z"); // 1 October in the shop, still September in UTC.
function row(id: string, amount: number, spentAt: string, extra: Partial<Expense> = {}): Expense {
  return { id, amount, spentAt, title: id, category: "Transport", paymentMode: "cash", status: "paid", recurringInterval: "none", ...extra };
}

describe("expense totals on the offline device", () => {
  it("uses Indian shop day/month boundaries and a six-month window", () => {
    const overview = expenseOverview([
      row("today", 20, "2026-09-30T18:30:00Z"),
      row("yesterday", 10, "2026-09-30T18:29:59Z"),
      row("start", 6, "2026-04-30T18:30:00Z", { status: "pending" }),
      row("too-old", 100, "2026-04-30T18:29:59Z", { status: "pending" }),
    ], now);
    expect(overview).toMatchObject({ today: 20, yesterday: 10, month: 20, lastMonth: 10, pendingTotal: 6, pendingCount: 1, monthlyAverage: 6 });
    expect(overview.trend).toEqual([
      { month: "2026-05", total: 6 }, { month: "2026-06", total: 0 },
      { month: "2026-07", total: 0 }, { month: "2026-08", total: 0 },
      { month: "2026-09", total: 10 }, { month: "2026-10", total: 20 },
    ]);
  });

  it("sums paise exactly and handles category names as data", () => {
    const overview = expenseOverview([
      row("a", 0.1, now.toISOString(), { category: "__proto__" }),
      row("b", 0.2, now.toISOString(), { category: "__proto__", status: "pending" }),
      row("c", 1.005, now.toISOString()),
    ], now);
    expect(overview.today).toBe(1.31);
    expect(overview.byCategory).toEqual({ ["__proto__"]: 0.3, Transport: 1.01 });
    expect(overview.pendingTotal).toBe(0.2);
  });

  it("omits deleted rows, retired aliases and invalid timestamps", () => {
    const live = row("live", 25, now.toISOString());
    const rows = [live, row("deleted", 100, now.toISOString(), { deletedAt: now.toISOString() }),
      { ...live, id: "offline-deleted", deleted_at: now.toISOString() },
      { ...live, id: "retired", merged_into_id: "live" }, row("bad-date", 100, "invalid")];
    expect(expenseOverview(rows, now).today).toBe(25);
  });

  it("keeps branch totals separate and assigns legacy rows to primary", () => {
    const rows = [row("a", 10, now.toISOString(), { locationId: "primary" }),
      row("b", 20, now.toISOString(), { locationId: "branch-b" }), row("legacy", 30, now.toISOString())];
    expect(expenseOverview(expensesForLocation(rows, "primary", "primary"), now).today).toBe(40);
    expect(expenseOverview(expensesForLocation(rows, "branch-b", "primary"), now).today).toBe(20);
    expect(expensesForLocation(rows, "branch-b")).toHaveLength(2);
    expect(expenseLocationUnknown(expensesForLocation(rows, "branch-b"), "branch-b")).toBe(true);
    expect(expenseLocationUnknown(rows, "branch-b", "primary")).toBe(false);
  });

  it("rolls December/January buckets across years without using the device clock zone", () => {
    const result = expenseOverview([row("last-year", 10, "2025-12-31T18:29:59Z")], new Date("2025-12-31T18:30:00Z"));
    expect(result).toMatchObject({ today: 0, yesterday: 10, month: 0, lastMonth: 10 });
    expect(result.trend.map((p) => p.month)).toEqual(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
  });

  it("asks the server for exactly the window the cards count", () => {
    // Shop midnight on 1 May: the same boundary the "start"/"too-old" rows straddle above.
    expect(expenseSummaryWindowStart(now)).toBe("2026-04-30T18:30:00.000Z");
    expect(expenseSummaryWindowStart(new Date("2025-12-31T18:30:00Z"))).toBe("2025-07-31T18:30:00.000Z");
    expect(shopDayKey(new Date("2025-12-31T18:29:59Z"))).toBe("2025-12-31");
    expect(shopDayKey(new Date("2025-12-31T18:30:00Z"))).toBe("2026-01-01");
  });
});
