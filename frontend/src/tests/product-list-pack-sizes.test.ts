import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { activeInventorySellingUnits, packSizeLabel } from "@/features/core/inventory/stock-display";
import type { Product, ProductSellingUnit } from "@/types/api";

const source = readFileSync("src/features/core/products/pages/ProductsPage.tsx", "utf8");

function pack(over: Partial<ProductSellingUnit>): ProductSellingUnit {
  return {
    name: "packet 1 kg", unitType: "packet", unitCode: "packet-1-kg",
    packSizeValue: 1, packSizeUnit: "kg", conversionToBase: 1000,
    defaultPrice: 100, isDefault: false, isActive: true, ...over,
  } as ProductSellingUnit;
}

/**
 * The catalogue used to show the default pack and nothing else, so a shop selling
 * atta as a 1 kg packet AND a 5 kg bag could not tell the two apart from any list —
 * the only way to find out was to open the product.
 */
describe("a pack size reads the way a shopkeeper says it", () => {
  it("drops the container word, which is already on the line above", () => {
    expect(packSizeLabel(pack({ name: "packet 5 kg", packSizeValue: 5, packSizeUnit: "kg" }))).toBe("5 kg");
    expect(packSizeLabel(pack({ name: "packet 500 gram", packSizeValue: 500, packSizeUnit: "gram" }))).toBe("500 gram");
  });

  it("falls back to the full name for a pack with no size", () => {
    // A restaurant portion has no pack size: its conversion is recipe consumption.
    expect(packSizeLabel(pack({ name: "portion", packSizeValue: null, packSizeUnit: null }))).toBe("portion");
  });
});

describe("which sizes the catalogue lists", () => {
  it("leaves out a pack the shop has retired", () => {
    const product = {
      id: "p1", name: "Ashirvaad Atta", packagingMode: "per_pack",
      sellingUnits: [
        pack({ isDefault: true, onHandQty: 10 }),
        pack({ name: "packet 5 kg", unitCode: "packet-5-kg", packSizeValue: 5, conversionToBase: 5000, onHandQty: 4 }),
        pack({ name: "packet 10 kg", unitCode: "packet-10-kg", packSizeValue: 10, conversionToBase: 10000, onHandQty: 0, isActive: false }),
      ],
    } as unknown as Product;
    const shown = activeInventorySellingUnits(product).filter((row) => !row.isDefault).map(packSizeLabel);
    expect(shown).toEqual(["5 kg"]);
  });

  it("counts the overflow instead of printing it", () => {
    // Two of the narrowest columns in the table: a shop selling rice in four sizes
    // ran the line past the table's width and pushed the actions column off the side.
    expect(source).toContain("function summariseList");
    expect(source).toContain("summariseList(alternatePacks.map(packSizeLabel))");
    expect(source).toContain("summariseList(perPackCounts)");
  });

  it("shows each size's own count only where sizes are counted apart", () => {
    // Pooled sizes all draw on one pool, so a per-size count there would be fiction.
    expect(source).toContain('product.packagingMode === "per_pack" && packUnits.length > 1');
  });
});
