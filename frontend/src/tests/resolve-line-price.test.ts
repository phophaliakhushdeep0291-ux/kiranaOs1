import { describe, expect, it } from "vitest";
import { resolveLinePrice, normalizeApiRule } from "@/features/pricing/resolve-line-price";
import { productSellingPrice } from "@/features/billing/pages/billing-calculations";

const product = {
  id: "p_surf", name: "Surf Excel", rateUnit: "packet", displayUnit: "packet",
  defaultPricePerRateUnit: 30, minPricePerRateUnit: 24, costPerRateUnit: 20, mrp: 0,
  retailPrice: 28, retailFromQuantity: 4, wholesalePrice: 26, wholesaleFromQuantity: 10,
} as never;

describe("resolveLinePrice — billing integration", () => {
  it("with no shop rules equals productSellingPrice (no regression)", () => {
    for (const qty of [1, 4, 10, 25]) {
      const r = resolveLinePrice(product, { quantity: qty });
      expect(r.recommendedUnitPrice).toBe(productSellingPrice(product, qty));
    }
  });

  it("an owner customer rule overrides the product tier", () => {
    const rule = normalizeApiRule({ id: "r1", ruleType: "CUSTOMER_FIXED_PRICE", status: "ACTIVE", customerId: "raj", fixedUnitPrice: 25.5, name: "Raj price" })!;
    const withRaj = resolveLinePrice(product, { quantity: 1, customerId: "raj", shopRules: [rule] });
    expect(withRaj.recommendedUnitPrice).toBe(25.5);
    expect(withRaj.explanation).toBe("Raj price");
    // A different customer does not get Raj's price.
    expect(resolveLinePrice(product, { quantity: 1, customerId: "other", shopRules: [rule] }).recommendedUnitPrice).toBe(30);
  });

  it("customer-group rule applies via the customer's group", () => {
    const rule = normalizeApiRule({ id: "g1", ruleType: "CUSTOMER_GROUP_PRICE", status: "ACTIVE", customerGroup: "wholesale", fixedUnitPrice: 27, name: "Wholesale" })!;
    expect(resolveLinePrice(product, { quantity: 1, customerGroup: "wholesale", shopRules: [rule] }).recommendedUnitPrice).toBe(27);
  });

  it("normalizeApiRule drops non-active and unknown rule rows", () => {
    expect(normalizeApiRule({ id: "x", ruleType: "CUSTOMER_FIXED_PRICE", status: "ARCHIVED", fixedUnitPrice: 1 })).toBeNull();
    expect(normalizeApiRule({ id: "y", ruleType: "NONSENSE", fixedUnitPrice: 1 })).toBeNull();
  });
});
