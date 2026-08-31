import { describe, expect, it } from "vitest";
import { getPlanForBusinessType } from "@/features/core/subscription/plans";

describe("shop-type subscription pricing", () => {
  it.each([
    ["kirana", 99, 299, 599], ["stationery", 249, 599, 999], ["other", 249, 599, 999],
    ["clothing", 349, 699, 1099], ["footwear", 349, 699, 1099], ["cosmetics", 349, 699, 1099],
    ["auto_parts", 399, 999, 1199], ["electronics", 399, 799, 1199], ["furniture", 399, 799, 1199],
    ["pharmacy", 499, 899, 1299],
    // Restaurant is sold as two plans, so `pro` resolves onto Dine-in's price
    // rather than sitting above it.
    ["restaurant", 799, 1499, 1499],
  ] as const)("prices %s for its POS market", (businessType, starter, growth, business) => {
    expect(getPlanForBusinessType("starter", businessType).price).toBe(starter);
    expect(getPlanForBusinessType("growth", businessType).price).toBe(growth);
    expect(getPlanForBusinessType("pro", businessType).price).toBe(business);
  });

  it("uses the revenue-plan annual prices", () => {
    expect(getPlanForBusinessType("starter", "kirana").annualPrice).toBe(999);
    expect(getPlanForBusinessType("growth", "kirana").annualPrice).toBe(2999);
    expect(getPlanForBusinessType("pro", "kirana").annualPrice).toBe(5999);
    expect(getPlanForBusinessType("growth", "auto_parts").annualPrice).toBe(8999);
    expect(getPlanForBusinessType("starter", "restaurant").annualPrice).toBe(7990);
    expect(getPlanForBusinessType("growth", "restaurant").annualPrice).toBe(14990);
  });
});
