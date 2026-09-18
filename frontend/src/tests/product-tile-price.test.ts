import { describe, expect, it } from "vitest";
import { productTilePrice, productSellingPrice } from "@/features/core/billing/pages/billing-calculations";
import type { Product, ProductSellingUnit } from "@/lib/api/client";

/**
 * A product tile must not advertise a price the counter will not charge.
 *
 * The tile showed the selling unit's listed `defaultPrice` raw. The cart prices
 * the line through the pricing engine, which caps it at the unit's ceiling — the
 * same ceiling the server enforces with PRICE_ABOVE_CONFIGURED_MAXIMUM. When the
 * two disagreed the cashier read one number off the screen and the bill printed
 * another: a ₹10 biscuit whose price had been raised to ₹25 without touching its
 * ₹10 MRP was quoted at ₹25 and rung at ₹10, and nobody was told.
 */

const product = (over: Partial<Product> = {}) => ({
  id: "p1", name: "Biscuit", mrp: 10,
  defaultPricePerRateUnit: 10, retailPricePerRateUnit: 10, retailFromQuantity: 1,
  ...over,
}) as unknown as Product;

const unit = (over: Partial<ProductSellingUnit> = {}) => ({
  id: "u1", name: "packet", unitCode: "packet-1", conversionToBase: 1,
  isDefault: true, isActive: true, defaultPrice: 10, maximumPrice: 10,
  ...over,
}) as unknown as ProductSellingUnit;

describe("the price on a product tile", () => {
  it("shows the listed price when it is within the ceiling", () => {
    const u = unit();
    expect(productTilePrice(product(), u, u)).toBe(10);
  });

  it("never advertises above the ceiling the till enforces", () => {
    // The state this was found in: listed 25, ceiling 10.
    const u = unit({ defaultPrice: 25 });
    expect(productTilePrice(product(), u, u)).toBe(10);
  });

  it("leaves a product with no ceiling alone", () => {
    // MRP is optional — loose goods and services have none, and a missing
    // ceiling must not read as a ceiling of zero that prices everything at ₹0.
    const u = unit({ defaultPrice: 40, maximumPrice: null });
    expect(productTilePrice(product({ mrp: 0 }), u, u)).toBe(40);
  });

  it("falls back to the product's own tier price when there is no selling unit", () => {
    const bare = product({ defaultPricePerRateUnit: 12, retailPricePerRateUnit: 12, mrp: 0 });
    expect(productTilePrice(bare, undefined, undefined)).toBe(productSellingPrice(bare, 1));
  });

  it("caps an alternate pack by its own ceiling, not the default pack's", () => {
    // A 5 kg bag carries its own maximumPrice; scaling the 1 kg MRP onto it is
    // what `sellingUnitMaxPrice` already handles, and the tile must honour it.
    const base = unit({ id: "u-default", conversionToBase: 1 });
    const bag = unit({ id: "u-bag", isDefault: false, conversionToBase: 5, defaultPrice: 90, maximumPrice: 50 });
    expect(productTilePrice(product(), bag, base)).toBe(50);
  });
});
