import { describe, expect, it } from "vitest";
import { computeBillSavings } from "@/features/core/billing/pages/billing-calculations";
import type { CartItem } from "@/features/core/billing/pages/billing-types";

function line(overrides: Partial<CartItem> & { mrp?: number | null }): CartItem {
  const { mrp, ...rest } = overrides;
  return {
    product: { id: "p", name: "P", mrp: mrp ?? null } as CartItem["product"],
    quantity: 1,
    rate: 0,
    unit: "piece",
    ...rest,
  } as CartItem;
}

describe("computeBillSavings", () => {
  it("counts the MRP gap per line", () => {
    // MRP 50, sold 45, qty 2 → saved 10.
    expect(computeBillSavings([line({ mrp: 50, rate: 45, quantity: 2 })], 0)).toBe(10);
  });

  it("adds line discounts and the bill-level discount", () => {
    const cart = [
      line({ mrp: 50, rate: 45, quantity: 2, lineDiscount: 5 }), // 10 gap + 5 = 15
      line({ mrp: 0, rate: 60, quantity: 1 }), // no MRP → 0
    ];
    expect(computeBillSavings(cart, 20)).toBe(35); // 15 + 0 + 20
  });

  it("ignores products with no MRP or MRP at/below the sold rate", () => {
    expect(computeBillSavings([line({ mrp: 0, rate: 60, quantity: 1 })], 0)).toBe(0);
    expect(computeBillSavings([line({ mrp: 40, rate: 45, quantity: 1 })], 0)).toBe(0); // sold above MRP
  });

  it("never goes negative and rounds to paise", () => {
    expect(computeBillSavings([line({ mrp: 50.5, rate: 45.25, quantity: 3 })], 0)).toBe(15.75);
    expect(computeBillSavings([], 0)).toBe(0);
  });
});
