import { describe, expect, it } from "vitest";
import { aggregateFinancialRows } from "@/features/core/finance/services/FinancialAggregationService";
import {
  buildCashMovement,
  buildOpeningFloat,
  openingFloatFor,
  summarizeCashMovements,
  upsertOpeningFloat,
} from "@/features/core/reports/cash-drawer";

const date = "2026-07-31";

function cashBill(id: string, amount: number) {
  return {
    id,
    billNo: id,
    billType: "normal_sale",
    status: "active",
    grandTotal: amount,
    totalAmount: amount,
    paidAmount: amount,
    buyerPaidAmount: amount,
    creditAmount: 0,
    createdAt: `${date}T10:00:00.000`,
    created_at: `${date}T10:00:00.000`,
    sync_status: "synced",
    payments: [{ mode: "cash", amount }],
  };
}

function drawerFor(extra: Record<string, number> = {}) {
  return aggregateFinancialRows({
    date,
    bills: [cashBill("KOS-1", 1000)],
    billItems: [],
    payments: [{ id: "p1", billId: "KOS-1", mode: "cash", amount: 1000, paidAt: `${date}T10:00:00.000`, paid_at: `${date}T10:00:00.000`, createdAt: `${date}T10:00:00.000`, created_at: `${date}T10:00:00.000`, status: "active", sync_status: "synced" }],
    ledger: [],
    products: [],
    customers: [],
    ...extra,
  }).cashDrawer;
}

describe("expected cash in the drawer", () => {
  // Regression: openingCash, expenses and owner withdrawals were hardcoded to 0, so the
  // expected drawer only counted money that moved through bills. Any shop keeping a float
  // showed a permanent "over", and any shop paying rent from the till showed a false
  // "short" — the one number that catches theft was wrong every day.
  it("counts only sales when there is no float and nothing paid out", () => {
    expect(drawerFor().expectedClosingCash).toBe(1000);
  });

  it("adds the declared opening float", () => {
    const drawer = drawerFor({ openingCash: 2000 });
    expect(drawer.openingCash).toBe(2000);
    expect(drawer.expectedClosingCash).toBe(3000);
  });

  it("subtracts cash paid out as expenses", () => {
    const drawer = drawerFor({ cashExpenses: 200 });
    expect(drawer.expenses).toBe(200);
    expect(drawer.expectedClosingCash).toBe(800);
  });

  it("applies cash in and cash out", () => {
    const drawer = drawerFor({ cashIn: 500, cashOut: 300 });
    expect(drawer.cashIn).toBe(500);
    expect(drawer.cashOut).toBe(300);
    expect(drawer.expectedClosingCash).toBe(1200);
  });

  it("combines every till movement in one figure", () => {
    // 2000 float + 1000 cash sales + 500 in - 200 expenses - 300 out = 3000
    expect(drawerFor({ openingCash: 2000, cashIn: 500, cashExpenses: 200, cashOut: 300 }).expectedClosingCash).toBe(3000);
  });

  it("ignores negative or junk adjustments rather than inflating the drawer", () => {
    const drawer = drawerFor({ openingCash: -500, cashOut: Number.NaN });
    expect(drawer.openingCash).toBe(0);
    expect(drawer.cashOut).toBe(0);
    expect(drawer.expectedClosingCash).toBe(1000);
  });
});

describe("opening float is declared per day, never carried forward", () => {
  it("keeps one declaration per date, latest wins", () => {
    let list = upsertOpeningFloat([], buildOpeningFloat(date, 2000));
    list = upsertOpeningFloat(list, buildOpeningFloat(date, 2500));
    expect(list).toHaveLength(1);
    expect(openingFloatFor(list, date)).toBe(2500);
  });

  it("does not leak one day's float into another", () => {
    const list = upsertOpeningFloat([], buildOpeningFloat("2026-07-30", 2000));
    // Carrying forward would roll yesterday's uncounted shortage into today.
    expect(openingFloatFor(list, date)).toBe(0);
  });
});

describe("cash in / out totals", () => {
  it("sums each direction for the given date only", () => {
    const rows = [
      buildCashMovement(date, "in", 500, "extra change"),
      buildCashMovement(date, "out", 200, "petrol"),
      buildCashMovement(date, "out", 100, "tea"),
      buildCashMovement("2026-07-30", "out", 999, "yesterday"),
    ];
    expect(summarizeCashMovements(rows, date)).toEqual({ cashIn: 500, cashOut: 300 });
  });

  it("rejects a non-positive amount instead of recording it", () => {
    expect(buildCashMovement(date, "out", -50, "typo").amount).toBe(0);
    expect(buildCashMovement(date, "in", Number.NaN, "typo").amount).toBe(0);
  });
});
