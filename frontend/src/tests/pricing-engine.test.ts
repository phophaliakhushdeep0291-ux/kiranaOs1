import { describe, expect, it } from "vitest";
import { evaluatePricing } from "@/features/core/pricing/engine/engine";
import { PricingRuleType, type PricingContext, type PricingRule } from "@/features/core/pricing/engine/types";
import { contextFromProduct, rulesFromProduct } from "@/features/core/pricing/engine/product-rules";
import { productSellingPrice } from "@/features/core/billing/pages/billing-calculations";

const baseCtx = (over: Partial<PricingContext> = {}): PricingContext => ({
  shopId: "shop_1",
  productId: "prod_surf",
  unitCode: "packet",
  quantity: 1,
  billDate: "2026-07-11T10:00:00.000Z",
  productCost: 20,
  defaultPrice: 30,
  minimumSellingPrice: 24,
  maximumRetailPrice: 35,
  source: "BILLING",
  ...over,
});

describe("pricing engine — precedence", () => {
  const wholesaleGroup: PricingRule = { id: "r_group", ruleType: PricingRuleType.CUSTOMER_GROUP_PRICE, customerGroup: "wholesale", fixedUnitPrice: 27, label: "Wholesale price" };
  const customerFixed: PricingRule = { id: "r_cust", ruleType: PricingRuleType.CUSTOMER_FIXED_PRICE, customerId: "cust_raj", fixedUnitPrice: 25.5, label: "Raj Traders price" };
  const customerQty: PricingRule = { id: "r_custqty", ruleType: PricingRuleType.CUSTOMER_QUANTITY_PRICE, customerId: "cust_raj", minQuantity: 12, fixedUnitPrice: 24.5 };

  it("customer-specific price overrides customer-group price", () => {
    const r = evaluatePricing(baseCtx({ customerId: "cust_raj", customerGroup: "wholesale" }), [wholesaleGroup, customerFixed]);
    expect(r.recommendedUnitPrice).toBe(25.5);
    expect(r.appliedRuleType).toBe(PricingRuleType.CUSTOMER_FIXED_PRICE);
    expect(r.explanation).toBe("Raj Traders price");
  });

  it("customer quantity price overrides fixed customer price when its range matches", () => {
    const r = evaluatePricing(baseCtx({ customerId: "cust_raj", customerGroup: "wholesale", quantity: 12 }), [wholesaleGroup, customerFixed, customerQty]);
    expect(r.recommendedUnitPrice).toBe(24.5);
    expect(r.appliedRuleType).toBe(PricingRuleType.CUSTOMER_QUANTITY_PRICE);
  });

  it("customer quantity price does NOT apply below its minimum quantity", () => {
    const r = evaluatePricing(baseCtx({ customerId: "cust_raj", quantity: 5 }), [customerFixed, customerQty]);
    expect(r.recommendedUnitPrice).toBe(25.5); // falls back to the fixed customer price
    expect(r.appliedRuleType).toBe(PricingRuleType.CUSTOMER_FIXED_PRICE);
  });

  it("customer-group price applies to a group member with no personal price", () => {
    const r = evaluatePricing(baseCtx({ customerId: "cust_new", customerGroup: "wholesale" }), [wholesaleGroup, customerFixed]);
    expect(r.recommendedUnitPrice).toBe(27);
    expect(r.appliedRuleType).toBe(PricingRuleType.CUSTOMER_GROUP_PRICE);
  });

  it("falls back to default price when nothing matches", () => {
    const r = evaluatePricing(baseCtx({ customerId: "walk_in" }), [wholesaleGroup, customerFixed]);
    expect(r.recommendedUnitPrice).toBe(30);
    expect(r.appliedRuleType).toBe(PricingRuleType.DEFAULT_PRICE);
    expect(r.explanation).toBe("Default product price applied");
  });
});

describe("pricing engine — general quantity slabs", () => {
  const slabs: PricingRule[] = [
    { id: "s1", ruleType: PricingRuleType.PRODUCT_QUANTITY_PRICE, minQuantity: 4, maxQuantity: 9, fixedUnitPrice: 28 },
    { id: "s2", ruleType: PricingRuleType.PRODUCT_QUANTITY_PRICE, minQuantity: 10, fixedUnitPrice: 26 },
  ];
  it("3 → 4 activates the slab; 4 → 3 falls back", () => {
    expect(evaluatePricing(baseCtx({ quantity: 3 }), slabs).recommendedUnitPrice).toBe(30);
    expect(evaluatePricing(baseCtx({ quantity: 4 }), slabs).recommendedUnitPrice).toBe(28);
    expect(evaluatePricing(baseCtx({ quantity: 10 }), slabs).recommendedUnitPrice).toBe(26);
    expect(evaluatePricing(baseCtx({ quantity: 3 }), slabs).appliedRuleType).toBe(PricingRuleType.DEFAULT_PRICE);
  });
  it("open-ended slab (no maximum) applies for very large quantities", () => {
    expect(evaluatePricing(baseCtx({ quantity: 500 }), slabs).recommendedUnitPrice).toBe(26);
  });
});

describe("pricing engine — safeguards", () => {
  it("floors below-minimum prices and flags approval", () => {
    const cheap: PricingRule = { id: "r", ruleType: PricingRuleType.CUSTOMER_FIXED_PRICE, customerId: "c", fixedUnitPrice: 18 };
    const r = evaluatePricing(baseCtx({ customerId: "c", minimumSellingPrice: 24 }), [cheap]);
    expect(r.recommendedUnitPrice).toBe(24);
    expect(r.requiresApproval).toBe(true);
    expect(r.trace.belowMinimum).toBe(true);
    expect(r.explanation).toMatch(/below the minimum/i);
  });
  it("caps prices above the configured MRP", () => {
    const pricey: PricingRule = { id: "r", ruleType: PricingRuleType.CUSTOMER_FIXED_PRICE, customerId: "c", fixedUnitPrice: 60 };
    const r = evaluatePricing(baseCtx({ customerId: "c", maximumRetailPrice: 35 }), [pricey]);
    expect(r.recommendedUnitPrice).toBe(35);
    expect(r.trace.aboveMaximum).toBe(true);
  });
});

describe("pricing engine — expiry + adjustment types + rounding", () => {
  it("ignores expired rules", () => {
    const expired: PricingRule = { id: "r", ruleType: PricingRuleType.PROMOTIONAL_PRICE, fixedUnitPrice: 22, validUntil: "2026-06-01T00:00:00.000Z" };
    expect(evaluatePricing(baseCtx(), [expired]).recommendedUnitPrice).toBe(30);
  });
  it("percentage discount and markup-on-cost resolve and round to paise", () => {
    const pct: PricingRule = { id: "p", ruleType: PricingRuleType.PROMOTIONAL_PRICE, adjustmentType: "PERCENTAGE_DISCOUNT", adjustmentValue: 10 };
    expect(evaluatePricing(baseCtx(), [pct]).recommendedUnitPrice).toBe(27); // 30 - 10%
    const markup: PricingRule = { id: "m", ruleType: PricingRuleType.PRODUCT_QUANTITY_PRICE, adjustmentType: "MARKUP_ON_COST", adjustmentValue: 33.33 };
    expect(evaluatePricing(baseCtx({ productCost: 20, minimumSellingPrice: 0 }), [markup]).recommendedUnitPrice).toBe(26.67);
  });
  it("same priority ties break toward the lower (customer-friendly) price deterministically", () => {
    const a: PricingRule = { id: "a", ruleType: PricingRuleType.PRODUCT_QUANTITY_PRICE, minQuantity: 1, fixedUnitPrice: 29 };
    const b: PricingRule = { id: "b", ruleType: PricingRuleType.PRODUCT_QUANTITY_PRICE, minQuantity: 1, fixedUnitPrice: 28 };
    expect(evaluatePricing(baseCtx(), [a, b]).recommendedUnitPrice).toBe(28);
  });
});

describe("pricing engine — parity with existing productSellingPrice", () => {
  // Proves the engine is a SUPERSET of current billing, not a divergent system.
  const product = {
    id: "prod_surf", name: "Surf Excel", rateUnit: "packet", displayUnit: "packet",
    defaultPricePerRateUnit: 30, minPricePerRateUnit: 24, costPerRateUnit: 20, mrp: 0,
    retailPrice: 28, retailFromQuantity: 4, wholesalePrice: 26, wholesaleFromQuantity: 10,
  } as unknown as Parameters<typeof rulesFromProduct>[0];

  for (const qty of [1, 3, 4, 9, 10, 25]) {
    it(`matches productSellingPrice at quantity ${qty}`, () => {
      const rules = rulesFromProduct(product);
      const ctx = contextFromProduct(product, { shopId: "s", quantity: qty, billDate: baseCtx().billDate, source: "BILLING" });
      const enginePrice = evaluatePricing(ctx, rules).recommendedUnitPrice;
      expect(enginePrice).toBe(productSellingPrice(product as never, qty));
    });
  }
});
