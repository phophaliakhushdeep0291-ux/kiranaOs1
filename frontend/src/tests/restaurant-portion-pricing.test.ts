import { describe, expect, it } from "vitest";
import type { Product, ProductSellingUnit } from "@/types/api";
import { sellingUnitMaxPrice } from "@/features/core/products/pages/product-pricing";
import { resolveLinePrice } from "@/features/core/pricing/resolve-line-price";

const classic: ProductSellingUnit = {
  id: "portion-classic",
  name: "Classic",
  unitType: "portion",
  unitCode: "portion-classic",
  conversionToBase: 1,
  defaultPrice: 420,
  isDefault: true,
  isActive: true,
};

const large: ProductSellingUnit = {
  ...classic,
  id: "portion-large",
  name: "Large",
  unitCode: "portion-large",
  conversionToBase: 1.4,
  defaultPrice: 590,
  isDefault: false,
};

const dish = {
  id: "dish-flatbread",
  name: "Truffle Paneer Flatbread",
  rateUnit: "plate",
  displayUnit: "plate",
  defaultPricePerRateUnit: 420,
  minPricePerRateUnit: 0,
  costPerRateUnit: 180,
  mrp: 420,
  sellingUnits: [classic, large],
} as unknown as Product;

describe("restaurant portion pricing", () => {
  it("does not turn a recipe portion factor into a retail MRP ceiling", () => {
    const maximumRetailPrice = sellingUnitMaxPrice(large, dish, classic);
    const pricing = resolveLinePrice(dish, {
      quantity: 1,
      sellingUnitId: large.id,
      unitCode: large.unitCode,
      unitLabel: large.name,
      defaultPrice: large.defaultPrice,
      maximumRetailPrice,
      productCost: 180,
      useLegacyProductRules: false,
    });

    expect(maximumRetailPrice).toBe(0);
    expect(pricing.recommendedUnitPrice).toBe(590);
  });

  it("still honours a ceiling explicitly configured on that portion", () => {
    expect(sellingUnitMaxPrice({ ...large, maximumPrice: 625 }, dish, classic)).toBe(625);
  });
});
