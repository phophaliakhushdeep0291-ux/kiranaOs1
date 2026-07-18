import { describe, expect, it } from "vitest";
import { calculateHourlySales } from "@/features/reports/local-reporting";

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

  it("skips cancelled bills, returns, and out-of-range bills", () => {
    const rows = calculateHourlySales([
      { id: "b1", billType: "normal_sale", status: "cancelled", createdAt: localIso(10), grandTotal: 100 },
      { id: "b2", billType: "sales_return", status: "active", createdAt: localIso(10), grandTotal: -40 },
      { id: "b3", billType: "normal_sale", status: "active", createdAt: "2026-06-01T10:00:00Z", grandTotal: 60 },
    ] as never, RANGE);
    expect(rows.every((row) => row.sales === 0 && row.bills === 0)).toBe(true);
  });
});
