import { describe, expect, it } from "vitest";
import { partitionProductRules } from "@/features/pricing/use-pricing-rules";
import type { ApiPricingRule } from "@/features/pricing/api";

const rules: ApiPricingRule[] = [
  { id: "s2", ruleType: "PRODUCT_QUANTITY_PRICE", productId: "p1", minQuantity: 10, fixedUnitPrice: 26 },
  { id: "s1", ruleType: "PRODUCT_QUANTITY_PRICE", productId: "p1", minQuantity: 4, maxQuantity: 9, fixedUnitPrice: 28 },
  { id: "g1", ruleType: "CUSTOMER_GROUP_PRICE", productId: "p1", customerGroup: "Wholesale", fixedUnitPrice: 27 },
  { id: "c1", ruleType: "CUSTOMER_FIXED_PRICE", productId: "p1", customerId: "raj", fixedUnitPrice: 25.5 },
  { id: "other", ruleType: "PRODUCT_QUANTITY_PRICE", productId: "p2", minQuantity: 1, fixedUnitPrice: 99 },
];

describe("partitionProductRules", () => {
  it("splits a product's rules and sorts slabs ascending; ignores other products", () => {
    const p = partitionProductRules(rules, "p1");
    expect(p.quantitySlabs.map((r) => r.id)).toEqual(["s1", "s2"]); // 4 before 10
    expect(p.groupPrices.map((r) => r.id)).toEqual(["g1"]);
    expect(p.customerPrices.map((r) => r.id)).toEqual(["c1"]);
    // p2's slab must not leak into p1's editor.
    expect(p.quantitySlabs.some((r) => r.id === "other")).toBe(false);
  });
});
