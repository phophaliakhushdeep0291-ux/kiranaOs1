/**
 * A catalogue exported from one shop has to import into the next one unchanged.
 *
 * That is the whole point of the export — an owner opening a second branch should not
 * retype four hundred items — so the test that matters is not "the CSV looks right"
 * but "the importer reads back what the exporter wrote". Pack sizes are the part that
 * used to fall on the floor: the importer hardcoded `sellingUnits: []`, so a product
 * sold in 1 kg, 5 kg, 500 g and 250 g arrived in the new shop with only its 1 kg pack
 * and the other three had to be re-entered by hand.
 */
import { describe, expect, it } from "vitest";
import type { Product } from "@/types/api";
import { buildProductExportCsv, productExportFileName } from "@/features/core/products/export/product-export-csv";
import { parseProductsCsv } from "@/features/core/products/import/product-import-csv";

const atta = {
  id: "server_product_1",
  name: "Ashirvaad Atta",
  category: "grocery",
  brand: "Ashirvaad",
  unit: "packet",
  rateUnit: "packet",
  baseUnit: "gram",
  packagingMode: "pooled",
  barcode: "8901234500011",
  hsn: "11010000",
  aliases: ["atta", "आटा"],
  mrp: 60,
  costPerRateUnit: 48,
  defaultPricePerRateUnit: 55,
  sellingPrice: 55,
  gstRate: 0,
  stockBaseQty: 72000,
  stockQuantity: 72,
  lowStockThreshold: 5000,
  reorderLevel: 10,
  isLooseItem: false,
  isActive: true,
  sellingUnits: [
    { name: "packet 1 kg", unitType: "packet", unitCode: "packet-1-kg", packSizeValue: 1, packSizeUnit: "kg", conversionToBase: 1000, defaultPrice: 55, costPrice: 48, maximumPrice: 60, barcode: null, onHandQty: null, isDefault: true, isActive: true },
    { name: "packet 5 kg", unitType: "packet", unitCode: "packet-5-kg", packSizeValue: 5, packSizeUnit: "kg", conversionToBase: 5000, defaultPrice: 265, costPrice: null, maximumPrice: null, barcode: "8901234500055", onHandQty: null, isDefault: false, isActive: true },
    { name: "packet 500 gram", unitType: "packet", unitCode: "packet-500-gram", packSizeValue: 500, packSizeUnit: "gram", conversionToBase: 500, defaultPrice: 30, costPrice: null, maximumPrice: null, barcode: null, onHandQty: null, isDefault: false, isActive: true },
    { name: "packet 250 gram", unitType: "packet", unitCode: "packet-250-gram", packSizeValue: 250, packSizeUnit: "gram", conversionToBase: 250, defaultPrice: 15, costPrice: null, maximumPrice: null, barcode: null, onHandQty: null, isDefault: false, isActive: true },
  ],
} as unknown as Product;

function roundTrip(products: Product[]) {
  const csv = buildProductExportCsv(products, "kirana");
  const parsed = parseProductsCsv(csv, undefined, "kirana");
  return { csv, parsed };
}

describe("product export imports back into another shop", () => {
  it("writes a file the importer accepts without remapping", () => {
    const { csv, parsed } = roundTrip([atta]);

    expect(csv.split("\n")[0]).toContain("Pack Sizes");
    expect(parsed.source).toBe("kiranaos");
    expect(parsed.headerError).toBeUndefined();
    expect(parsed.errorCount).toBe(0);
    expect(parsed.validCount).toBe(1);
  });

  it("carries the product's own details across", () => {
    const { parsed } = roundTrip([atta]);
    const input = parsed.rows[0].input!;

    expect(input).toEqual(expect.objectContaining({
      name: "Ashirvaad Atta",
      brand: "Ashirvaad",
      mrp: 60,
      hsn: "11010000",
    }));
    expect(parsed.rows[0].values.aliasesText).toBe("atta, आटा");
  });

  it("carries EVERY pack size, not just the default one", () => {
    const { parsed } = roundTrip([atta]);
    const units = parsed.rows[0].input!.sellingUnits ?? [];

    expect(units.map((unit) => `${unit.unitCode}@${unit.defaultPrice}`).sort()).toEqual([
      "packet-1-kg@55",
      "packet-250-gram@15",
      "packet-5-kg@265",
      "packet-500-gram@30",
    ]);
    // The sizes have to survive as MEASURES, not as bare numbers: a 5 kg pack whose
    // conversion came back as 5 would take 5 grams off the shelf per sale.
    expect(units.find((unit) => unit.unitCode === "packet-5-kg")?.conversionToBase).toBe(5000);
    expect(units.find((unit) => unit.unitCode === "packet-250-gram")?.conversionToBase).toBe(250);
  });

  it("keeps a pack's own barcode with it", () => {
    const { parsed } = roundTrip([atta]);
    const units = parsed.rows[0].input!.sellingUnits ?? [];

    expect(units.find((unit) => unit.unitCode === "packet-5-kg")?.barcode).toBe("8901234500055");
    expect(units.find((unit) => unit.unitCode === "packet-500-gram")?.barcode ?? null).toBeNull();
  });

  it("leaves per-pack cost and MRP blank so the new shop scales its own", () => {
    const { parsed } = roundTrip([atta]);
    const fiveKg = (parsed.rows[0].input!.sellingUnits ?? []).find((unit) => unit.unitCode === "packet-5-kg")!;

    expect(fiveKg.costPrice ?? null).toBeNull();
    expect(fiveKg.maximumPrice ?? null).toBeNull();
  });

  it("names the file after the shop and the day", () => {
    expect(productExportFileName("Packaging Walkthrough Store", new Date("2026-08-22T05:00:00.000Z")))
      .toBe("products-packaging-walkthrough-store-2026-08-22.csv");
  });
});
