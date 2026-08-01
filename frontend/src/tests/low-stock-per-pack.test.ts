import { describe, expect, it } from "vitest";
import type { Product } from "@/types/api";

/**
 * "For this product this size is now less so we need to order this size."
 *
 * The case that justifies the whole feature is a product that reads as comfortably
 * stocked in total while one size has run out. The pooled number cannot express it,
 * because it has already added the sizes together.
 *
 * Mirrors calculateLowStockPacks in local-reporting.ts. Counts are in each pack's
 * OWN units (boxes, packets) — running them through a base-unit conversion here
 * would reintroduce the 1000x display bug that has bitten this codebase before.
 */
function lowStockPacks(products: Product[]) {
  return products
    .filter((product) => product.packagingMode === "per_pack" && Array.isArray(product.sellingUnits))
    .flatMap((product) =>
      (product.sellingUnits ?? [])
        .filter((unit) => (unit.isActive ?? true) && Number(unit.lowStockThreshold ?? 0) > 0)
        .map((unit) => ({
          productName: product.name,
          packName: unit.name,
          onHandQty: Number(unit.onHandQty ?? 0),
          threshold: Number(unit.lowStockThreshold ?? 0),
        })),
    )
    .filter((row) => row.onHandQty <= row.threshold)
    .sort((a, b) => a.onHandQty - b.onHandQty);
}

const maggi = {
  id: "p_maggi",
  name: "Maggi Noodles",
  defaultPricePerRateUnit: 14,
  packagingMode: "per_pack",
  // 48 packets + 1 box = 3,920 g. Healthy in total; one box left.
  sellingUnits: [
    { name: "70 g packet", unitType: "packet", unitCode: "pkt70", conversionToBase: 70, defaultPrice: 14, onHandQty: 48, lowStockThreshold: 12, isDefault: true, isActive: true },
    { name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 1, lowStockThreshold: 3, isDefault: false, isActive: true },
  ],
} as unknown as Product;

describe("per-size low stock", () => {
  it("names the size that needs ordering, not just the product", () => {
    const rows = lowStockPacks([maggi]);

    expect(rows).toHaveLength(1);
    expect(rows[0].packName).toBe("8-pack box");
    expect(rows[0].onHandQty).toBe(1);
    // The size that is fine must not be listed, or the alert is noise.
    expect(rows.some((row) => row.packName === "70 g packet")).toBe(false);
  });

  it("ignores a size with no alert level set, even at zero", () => {
    // A threshold of 0 means "do not track this size", not "alert at zero".
    const untracked = {
      ...maggi,
      id: "p_yippee",
      sellingUnits: [{ name: "70 g packet", unitType: "packet", unitCode: "y70", conversionToBase: 70, defaultPrice: 14, onHandQty: 0, lowStockThreshold: 0, isDefault: true, isActive: true }],
    } as unknown as Product;

    expect(lowStockPacks([untracked])).toHaveLength(0);
  });

  it("ignores an inactive size", () => {
    const retired = {
      ...maggi,
      id: "p_retired",
      sellingUnits: [{ name: "old carton", unitType: "box", unitCode: "old", conversionToBase: 5600, defaultPrice: 900, onHandQty: 0, lowStockThreshold: 2, isDefault: false, isActive: false }],
    } as unknown as Product;

    expect(lowStockPacks([retired])).toHaveLength(0);
  });

  it("never reports a pooled product", () => {
    // Loose rice sells as 1 kg and 5 kg from the same sack, so "which size is low"
    // is meaningless — it still reports through the ordinary product-level alert.
    const rice = {
      id: "p_rice",
      name: "Loose Rice",
      defaultPricePerRateUnit: 58,
      packagingMode: "pooled",
      sellingUnits: [{ name: "1 kg", unitType: "packet", unitCode: "kg1", conversionToBase: 1000, defaultPrice: 58, onHandQty: 0, lowStockThreshold: 5, isDefault: true, isActive: true }],
    } as unknown as Product;

    expect(lowStockPacks([rice])).toHaveLength(0);
  });

  it("puts the emptiest size first, since that is what to order first", () => {
    const many = {
      ...maggi,
      id: "p_many",
      sellingUnits: [
        { name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 2, lowStockThreshold: 3, isDefault: false, isActive: true },
        { name: "70 g packet", unitType: "packet", unitCode: "pkt70", conversionToBase: 70, defaultPrice: 14, onHandQty: 0, lowStockThreshold: 12, isDefault: true, isActive: true },
      ],
    } as unknown as Product;

    expect(lowStockPacks([many]).map((row) => row.packName)).toEqual(["70 g packet", "8-pack box"]);
  });
});
