import { describe, expect, it } from "vitest";
import { calculateDiscountSummary } from "@/features/reports/local-reporting";

const RANGE = { from: "2026-07-01", to: "2026-07-31" };

describe("calculateDiscountSummary", () => {
  it("splits bill-level discounts into manual/coupon/loyalty and sums line discounts", () => {
    const summary = calculateDiscountSummary([
      {
        id: "b1", billNo: "KOS-1", billType: "normal_sale", status: "active", createdAt: "2026-07-18T10:00:00Z",
        discount: 50, offerDiscount: 20, loyaltyDiscount: 10, discountReason: "regular customer",
        items: [{ lineDiscount: 9 }, { lineDiscount: 0 }],
      },
      {
        id: "b2", billNo: "KOS-2", billType: "normal_sale", status: "active", createdAt: "2026-07-18T11:00:00Z",
        discount: 0,
        items: [{ lineDiscount: 5 }],
      },
    ] as never, RANGE);
    expect(summary.total).toBe(64); // 50 + 9 + 5
    expect(summary.manual).toBe(20); // 50 − 20 coupon − 10 loyalty
    expect(summary.coupon).toBe(20);
    expect(summary.loyalty).toBe(10);
    expect(summary.line).toBe(14);
    expect(summary.discountedBillCount).toBe(2);
    expect(summary.recent[0].billNo).toBe("KOS-2"); // newest first
    expect(summary.recent[1].reason).toBe("regular customer");
  });

  it("ignores cancelled bills, returns, and bills outside the range", () => {
    const summary = calculateDiscountSummary([
      { id: "b1", billType: "normal_sale", status: "cancelled", createdAt: "2026-07-18T10:00:00Z", discount: 100 },
      { id: "b2", billType: "sales_return", status: "active", createdAt: "2026-07-18T10:00:00Z", discount: 40 },
      { id: "b3", billType: "normal_sale", status: "active", createdAt: "2026-06-01T10:00:00Z", discount: 30 },
    ] as never, RANGE);
    expect(summary.total).toBe(0);
    expect(summary.discountedBillCount).toBe(0);
  });

  it("reports no reason as null and keeps undiscounted bills out of the list", () => {
    const summary = calculateDiscountSummary([
      { id: "b1", billNo: "KOS-9", billType: "normal_sale", status: "active", createdAt: "2026-07-18T10:00:00Z", discount: 15 },
      { id: "b2", billNo: "KOS-10", billType: "normal_sale", status: "active", createdAt: "2026-07-18T11:00:00Z", discount: 0 },
    ] as never, RANGE);
    expect(summary.recent).toHaveLength(1);
    expect(summary.recent[0].reason).toBeNull();
    expect(summary.manual).toBe(15);
  });
});
