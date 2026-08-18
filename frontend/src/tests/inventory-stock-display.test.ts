import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inventoryAverageUnitCost,
  inventoryDisplayQuantity,
  inventoryQuantityToBase,
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
