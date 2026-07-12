import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/api/client";
import { calculateCartSubtotal, calculateDiscount, calculateGrandTotal, cartItemProfit, clampAmount, lineNeedsOwnerApproval, normalizeSearchText, productCostPrice, productMinSellingPrice, productSearchText, productSellingPrice, roundMoney } from "@/features/billing/pages/billing-calculations";
import type { CartItem } from "@/features/billing/pages/billing-types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Sugar",
    category: "Grocery",
    aliases: ["chini", "चीनी"],
    defaultPricePerRateUnit: 42,
    ...overrides,
  };
}

describe("billing calculations", () => {
  it("rounds and clamps money inputs consistently", () => {
    expect(roundMoney(10.125)).toBe(10.13);
    expect(clampAmount(150, 0, 100)).toBe(100);
    expect(clampAmount(Number.NaN, 0, 100)).toBe(0);
  });

  it("calculates subtotal, discount, and total without changing billing math", () => {
    const cart: CartItem[] = [
      { product: product(), quantity: 2, rate: 42, unit: "kg" },
      { product: product({ id: "prod-2", name: "Oil", defaultPricePerRateUnit: 120 }), quantity: 1, rate: 120, unit: "packet" },
    ];

    expect(calculateCartSubtotal(cart)).toBe(204);
    expect(calculateDiscount(204, 999)).toBe(204);
    expect(calculateGrandTotal(204, 14)).toBe(190);
  });

  it("chooses wholesale, retail, and base selling price at the same thresholds as billing", () => {
    const rice = product({
      sellingPrice: 55,
      retailPrice: 52,
      retailFromQuantity: 2,
      wholesalePrice: 48,
      wholesaleFromQuantity: 10,
    });

    expect(productSellingPrice(rice, 1)).toBe(55);
    expect(productSellingPrice(rice, 2)).toBe(52);
    expect(productSellingPrice(rice, 10)).toBe(48);
  });

  it("calculates item profit from product cost and edited rate", () => {
    const item: CartItem = { product: product({ averageCostPrice: 35 }), quantity: 3, rate: 42, unit: "kg" };

    expect(productCostPrice(item.product)).toBe(35);
    expect(productMinSellingPrice(product({ minimumSellingPrice: 39 }))).toBe(39);
    expect(cartItemProfit(item)).toBe(21);
  });

  it("flags lines that need owner PIN — typed-below-min and engine-floored", () => {
    const priced = product({ minimumSellingPrice: 40, defaultPricePerRateUnit: 45 });

    // Auto-priced at or above the floor → no approval.
    expect(lineNeedsOwnerApproval({ product: priced, quantity: 1, rate: 45, unit: "kg" })).toBe(false);
    // Cashier typed a rate under the floor → approval.
    expect(lineNeedsOwnerApproval({ product: priced, quantity: 1, rate: 38, unit: "kg", manualRate: true })).toBe(true);
    // Custom line is never gated by this rule.
    expect(lineNeedsOwnerApproval({ product: priced, quantity: 1, rate: 5, unit: "kg", isCustom: true })).toBe(false);
    // Engine floored a below-margin rule: rate sits AT the min, but the flag is set → approval.
    expect(lineNeedsOwnerApproval({
      product: priced, quantity: 12, rate: 40, unit: "kg",
      pricing: { explanation: "Bulk", appliedRuleType: "PRODUCT_QUANTITY_PRICE", originalUnitPrice: 45, requiresApproval: true, confidence: 1 },
    })).toBe(true);
    // Manual override lifted the price above the floor — a stale flag must NOT re-gate it.
    expect(lineNeedsOwnerApproval({
      product: priced, quantity: 12, rate: 44, unit: "kg", manualRate: true,
      pricing: { explanation: "Bulk", appliedRuleType: "PRODUCT_QUANTITY_PRICE", originalUnitPrice: 45, requiresApproval: true, confidence: 1 },
    })).toBe(false);
  });

  it("normalizes product search text for aliases and Hindi names", () => {
    const searchText = productSearchText(product({ name: "चीनी", category: "Kirana", aliases: ["sugar", "chini"] }));

    expect(normalizeSearchText("ChInI!!!")).toBe("chini");
    expect(searchText).toContain(normalizeSearchText("चीनी"));
    expect(searchText).toContain("sugar");
    expect(searchText).toContain("kirana");
  });
});
