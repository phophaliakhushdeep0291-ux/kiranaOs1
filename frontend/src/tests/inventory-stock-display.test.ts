import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inventoryAverageUnitCost,
  inventoryDisplayQuantity,
  inventoryQuantityToBase,
  inventoryStockLabel,
  inventoryStockValue,
  inventoryUnitLabel,
  enrichInventoryRows,
  mergeInventoryRows,
  normalizeInventoryItem,
} from "@/features/core/inventory/stock-display";
import type { InventoryItem, ProductSellingUnit } from "@/types/api";

const oneKgPacket: ProductSellingUnit = {
  id: "unit_1kg",
  name: "packet 1 kg",
  unitType: "packet",
  unitCode: "packet-1-kg",
  packSizeValue: 1,
  packSizeUnit: "kg",
  conversionToBase: 1_000,
  barcode: "ATTA-1KG",
  defaultPrice: 62,
  minimumPrice: 58,
  maximumPrice: 70,
  costPrice: 50,
  isDefault: true,
  isActive: true,
};

function packagedProduct(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "product_atta",
    productId: "product_atta",
    name: "Test Atta",
    category: "grocery",
    brand: "Mill",
    unit: "packet",
    displayUnit: "packet 1 kg",
    baseUnit: "gram",
    rateUnit: "packet",
    barcode: "ATTA-1KG",
    sku: "ATTA-1KG",
    imageUrl: "data:image/png;base64,abc",
    stockBaseQty: 20_000,
    lowStockThreshold: 5_000,
    costPerRateUnit: 50,
    averageCostPrice: 50,
    defaultPricePerRateUnit: 62,
    sellingUnits: [oneKgPacket],
    ...overrides,
  };
}

describe("inventory stock display", () => {
  it("shows packaged stock in packets while preserving base quantity", () => {
    const item = packagedProduct();

    expect(inventoryDisplayQuantity(item)).toBe(20);
    expect(inventoryUnitLabel(item)).toBe("packet 1 kg");
    expect(inventoryAverageUnitCost(item)).toBe(50);
    expect(inventoryStockValue(item)).toBe(1_000);
    expect(inventoryQuantityToBase(item, 3, "packet-1-kg")).toBe(3_000);
  });

  it("normalizes product rows without losing product images", () => {
    const normalized = normalizeInventoryItem(packagedProduct());

    expect(normalized.stockBaseQty).toBe(20_000);
    expect(normalized.stockQuantity).toBe(20);
    expect(normalized.displayUnit).toBe("packet 1 kg");
    expect(normalized.imageUrl).toBe("data:image/png;base64,abc");
  });

  it("merges inventory API stock onto product metadata", () => {
    const productRow = packagedProduct();
    const inventoryApiRow = {
      id: "product_atta",
      name: "Test Atta",
      category: "grocery",
      baseUnit: "gram",
      displayUnit: "packet 1 kg",
      stockBaseQty: 15_000,
      lowStockThreshold: 5_000,
      costPerRateUnit: 52,
      defaultPricePerRateUnit: 62,
    } as InventoryItem;

    const [merged] = mergeInventoryRows([productRow], [inventoryApiRow]);

    expect(merged.imageUrl).toBe("data:image/png;base64,abc");
    expect(merged.sellingUnits).toEqual([oneKgPacket]);
    expect(inventoryDisplayQuantity(merged)).toBe(15);
    expect(inventoryUnitLabel(merged)).toBe("packet 1 kg");
  });

  /**
   * The Low Stock Alerts panel listed products that were not low.
   *
   * It enriched the server's low-stock list by merging the whole catalogue into
   * it — but `mergeInventoryRows` is a UNION, so the result was the whole
   * catalogue, sorted ascending by quantity. The panel then showed the three
   * smallest products in the shop whether or not any of them was below its
   * reorder level, while the metric card beside it counted only the real ones.
   */
  describe("narrowing a merge to the rows that were asked about", () => {
    const catalogue = [
      { id: "p1", name: "Rice", stockBaseQty: 900, lowStockThreshold: 0, imageUrl: "rice.png" } as InventoryItem,
      { id: "p2", name: "Salt", stockBaseQty: 4, lowStockThreshold: 0 } as InventoryItem,
      { id: "p3", name: "Atta", stockBaseQty: 2_000, lowStockThreshold: 5_000, imageUrl: "atta.png" } as InventoryItem,
    ];
    // Only Atta is under its threshold; Salt is simply a small number.
    const serverLowStock = [{ id: "p3", name: "Atta", stockBaseQty: 2_000, lowStockThreshold: 5_000 } as InventoryItem];

    it("keeps only the subject rows", () => {
      expect(mergeInventoryRows(catalogue, serverLowStock)).toHaveLength(3);
      expect(enrichInventoryRows(serverLowStock, catalogue).map((row) => row.id)).toEqual(["p3"]);
    });

    it("still fills them in from the catalogue", () => {
      // The server's low-stock row carries no image; the catalogue's does, and
      // the panel renders it. Narrowing must not cost the enrichment.
      const [row] = enrichInventoryRows(serverLowStock, catalogue);
      expect(row.imageUrl).toBe("atta.png");
      expect(row.stockBaseQty).toBe(2_000);
    });

    it("returns nothing when the subject is empty, rather than everything", () => {
      expect(enrichInventoryRows([], catalogue)).toEqual([]);
    });

    it("does not count a finished product as low stock", () => {
      // `isLowStock` is `qty <= threshold`, so a product at zero satisfies it.
      // The panel and the Low Stock filter both drop those rows; the metric card
      // did not, so it read "1" above an empty panel. All three now agree, and a
      // finished product is counted once — under Out of Stock.
      const page = readFileSync("src/features/core/inventory/pages/InventoryPage.tsx", "utf8");
      expect(page).toContain("const hasStock = (item: InventoryItem) => Number(item.stockBaseQty ?? 0) > 0;");
      expect(page).toContain("rows.filter((item) => isLowStock(item) && hasStock(item))");
      expect(page).toContain("(lowStock.data ?? []).filter(hasStock)");
      // The panel and the table keep their own qty > 0 guards.
      expect(page).toContain('.filter((item) => Number(item.stockBaseQty ?? 0) > 0)');
      expect(page).toContain('if (stockFilter === "low") return tracked && qty > 0 && isLowStock(item);');
    });

    it("is what the Low Stock Alerts panel actually calls", () => {
      // The bug was at the call site, not in the merge, so pin the call site.
      const page = readFileSync("src/features/core/inventory/pages/InventoryPage.tsx", "utf8");
      expect(page).toContain("enrichInventoryRows(lowStock.data, allInventoryRows)");
      expect(page).not.toContain("mergeInventoryRows(allInventoryRows, lowStock.data");
    });
  });
});

/**
 * "Recently added products shows 6000 piece, which is not right."
 *
 * The dashboard rail asked product-pricing to convert base units using the pack's
 * NAME ("piece 100 ml"). That name is in no conversion table, so the lookup took
 * its fallback factor of 1 and printed 6,000 ml of hair oil as 6,000 bottles —
 * under the bottle's own label, which made it read as a stock count.
 */
describe("stock label for a packed product", () => {
  const bottle: ProductSellingUnit = {
    id: "unit_100ml",
    name: "piece 100 ml",
    unitType: "piece",
    unitCode: "piece-100-ml",
    packSizeValue: 100,
    packSizeUnit: "ml",
    conversionToBase: 100,
    defaultPrice: 70,
    isDefault: true,
    isActive: true,
  } as ProductSellingUnit;

  const hairOil = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
    id: "product_oil",
    productId: "product_oil",
    name: "Almand drop",
    unit: "piece",
    displayUnit: "piece 100 ml",
    rateUnit: "piece",
    baseUnit: "ml",
    stockBaseQty: 6_000,
    sellingUnits: [bottle],
    ...overrides,
  } as InventoryItem);

  it("counts bottles, not millilitres", () => {
    expect(inventoryStockLabel(hairOil())).toBe("60 piece 100 ml");
  });

  it("leaves a plain measure alone", () => {
    // 5 kg of tej patta is 5, not 5,000: the old path got these right because
    // "kg" IS in the table, which is why only packed goods looked wrong.
    const looseSpice = {
      id: "product_tajpata",
      name: "TajPata",
      unit: "kg",
      displayUnit: "kg",
      rateUnit: "kg",
      baseUnit: "g",
      stockBaseQty: 5_000,
    } as InventoryItem;
    expect(inventoryStockLabel(looseSpice)).toBe("5 kg");
  });

  it("still shows a deficit", () => {
    // An oversold shelf is the number the owner most needs to see.
    expect(inventoryStockLabel(hairOil({ stockBaseQty: -300 }))).toBe("-3 piece 100 ml");
  });

  it("gives a per-pack product the count that pack actually holds", () => {
    // Each size is counted on its own shelf here, so there is no pooled total to
    // divide — dividing one would put a crate's stock under the packet's label.
    const maggi = {
      id: "product_maggi",
      name: "Maggi Noodles",
      unit: "packet",
      displayUnit: "70 g packet",
      baseUnit: "g",
      packagingMode: "per_pack",
      stockBaseQty: 6_160,
      sellingUnits: [
        { id: "su_pkt", name: "70 g packet", unitType: "packet", unitCode: "pkt70", conversionToBase: 70, onHandQty: 40, isDefault: true, isActive: true },
        { id: "su_crate", name: "24-pack crate", unitType: "carton", unitCode: "crate24", conversionToBase: 1_680, onHandQty: 2, isDefault: false, isActive: true },
      ],
    } as unknown as InventoryItem;
    expect(inventoryStockLabel(maggi)).toBe("40 70 g packet");
  });

  it("is what the dashboard rail calls", () => {
    // The defect was the call site's choice of helper, so pin the call site.
    const page = readFileSync("src/features/core/dashboard/pages/DashboardPage.tsx", "utf8");
    expect(page).toContain("{inventoryStockLabel(product)}");
    expect(page).not.toContain("fromBaseQty");
  });
});
