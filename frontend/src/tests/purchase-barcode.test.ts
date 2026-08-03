import { describe, expect, it } from "vitest";
import { resolvePurchaseBarcode } from "@/features/core/purchases/purchase-barcode";
import type { Product } from "@/types/api";

const product = (overrides: Partial<Product>): Product => ({
  id: "p1",
  name: "Rice",
  defaultPricePerRateUnit: 50,
  ...overrides,
});

describe("purchase barcode resolution", () => {
  it("matches primary barcode, SKU, and selling-unit barcode case-insensitively", () => {
    const rows = [product({ barcode: "89010001", sku: "RICE-1", sellingUnits: [{ name: "Bag", unitType: "pack", unitCode: "bag", conversionToBase: 10, barcode: "BAG-10", defaultPrice: 500, isDefault: false, isActive: true }] })];
    expect(resolvePurchaseBarcode(rows, " 89010001 ")?.id).toBe("p1");
    expect(resolvePurchaseBarcode(rows, "rice-1")?.id).toBe("p1");
    expect(resolvePurchaseBarcode(rows, "bag-10")?.id).toBe("p1");
  });

  it("fails closed for blank, unknown, or duplicate codes", () => {
    const rows = [product({ id: "p1", barcode: "same" }), product({ id: "p2", barcode: "same" })];
    expect(resolvePurchaseBarcode(rows, "")).toBeNull();
    expect(resolvePurchaseBarcode(rows, "missing")).toBeNull();
    expect(resolvePurchaseBarcode(rows, "same")).toBeNull();
  });
});
