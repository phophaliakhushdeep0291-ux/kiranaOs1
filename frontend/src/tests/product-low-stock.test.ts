import { describe, expect, it } from "vitest";
import { fromBaseQty, isLowStock, toBaseQty } from "@/features/products/pages/product-pricing";
import type { Product } from "@/types/api";

function product(overrides: Partial<Product>): Product {
  return { id: "p1", name: "Atta", defaultPricePerRateUnit: 40, ...overrides } as Product;
}

// Guards the "every item shows low stock" bug: stockBaseQty and lowStockThreshold are BOTH
// base units (the product form converts the entered alert via toBaseQty), and a product with
// no alert threshold is never "low".
describe("low stock classification", () => {
  it("compares base-unit stock against base-unit threshold", () => {
    // 5 kg in stock, alert at 2 kg — exactly what the form stores.
    const healthy = product({ unit: "kg", stockBaseQty: toBaseQty(5, "kg"), lowStockThreshold: toBaseQty(2, "kg") });
    expect(healthy.stockBaseQty).toBe(5000);
    expect(healthy.lowStockThreshold).toBe(2000);
    expect(isLowStock(healthy)).toBe(false);

    const low = product({ unit: "kg", stockBaseQty: toBaseQty(1, "kg"), lowStockThreshold: toBaseQty(2, "kg") });
    expect(isLowStock(low)).toBe(true);
  });

  it("treats products without an alert threshold as never low", () => {
    expect(isLowStock(product({ stockBaseQty: 0, lowStockThreshold: 0 }))).toBe(false);
    expect(isLowStock(product({ stockBaseQty: 100 }))).toBe(false);
  });

  it("round-trips the alert between form display units and storage", () => {
    expect(fromBaseQty(toBaseQty(2, "kg"), "kg")).toBe(2);
    expect(fromBaseQty(toBaseQty(10, "piece"), "piece")).toBe(10);
  });
});
