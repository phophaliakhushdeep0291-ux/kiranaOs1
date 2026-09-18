import { describe, expect, it } from "vitest";
import { calculateHourlySales } from "@/features/core/reports/local-reporting";

const RANGE = { from: "2026-07-01", to: "2026-07-31" };

function localIso(hour: number, minute = 0) {
  // Build a LOCAL-time date so the bucketing (getHours) is timezone-stable in tests.
  const date = new Date(2026, 6, 18, hour, minute, 0);
  return date.toISOString();
}

describe("calculateHourlySales", () => {
  it("buckets sales into local hours and counts bills", () => {
    const rows = calculateHourlySales([
      { id: "b1", billType: "normal_sale", status: "active", createdAt: localIso(9, 5), grandTotal: 100 },
      { id: "b2", billType: "normal_sale", status: "active", createdAt: localIso(9, 45), grandTotal: 50 },
      { id: "b3", billType: "estimate", status: "active", createdAt: localIso(18), grandTotal: 80 },
    ] as never, RANGE);
    expect(rows).toHaveLength(24);
    expect(rows[9]).toEqual({ hour: 9, sales: 150, bills: 2 });
    expect(rows[18]).toEqual({ hour: 18, sales: 80, bills: 1 });
    expect(rows.reduce((sum, row) => sum + row.bills, 0)).toBe(3);
  });

  it("skips cancelled and out-of-range bills", () => {
    const rows = calculateHourlySales([
      { id: "b1", billType: "normal_sale", status: "cancelled", createdAt: localIso(10), grandTotal: 100 },
      { id: "b2", billType: "normal_sale", status: "active", createdAt: "2026-06-01T10:00:00Z", grandTotal: 60 },
    ] as never, RANGE);
    expect(rows.every((row) => row.sales === 0 && row.bills === 0)).toBe(true);
  });

  it("nets a refund out of the hour it was recorded in", () => {
    // The hour the money moved, not the hour of the sale being refunded. Total
    // Sales counts a return in the range the RETURN falls in, so bucketing it by
    // the original sale's hour would stop the two agreeing the moment somebody
    // returns today what they bought last week.
    const rows = calculateHourlySales([
      { id: "b1", billType: "normal_sale", status: "active", createdAt: localIso(10), grandTotal: 100 },
      { id: "b2", billType: "sales_return", status: "active", createdAt: localIso(16), grandTotal: -40 },
    ] as never, RANGE);
    expect(rows[10]).toEqual({ hour: 10, sales: 100, bills: 1 });
    expect(rows[16]).toEqual({ hour: 16, sales: -40, bills: 0 });
    // Which is the property that matters: the hours add up to the day's sales.
    expect(rows.reduce((sum, row) => sum + row.sales, 0)).toBe(60);
  });

  it("counts customers served, so a refund is money but not a bill", () => {
    const rows = calculateHourlySales([
      { id: "b1", billType: "normal_sale", status: "active", createdAt: localIso(9), grandTotal: 100 },
      { id: "b2", billType: "sales_return", status: "active", createdAt: localIso(9), grandTotal: -100 },
    ] as never, RANGE);
    expect(rows[9]).toEqual({ hour: 9, sales: 0, bills: 1 });
  });
});
