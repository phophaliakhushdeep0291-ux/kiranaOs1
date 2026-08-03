import { describe, expect, it } from "vitest";
import {
  inventoryAverageUnitCost,
  inventoryDisplayQuantity,
  inventoryQuantityToBase,
  inventoryStockValue,
  inventoryUnitLabel,
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
});
