import { describe, expect, it } from "vitest";
import { cartItemKey, type CartItem } from "@/features/billing/pages/billing-types";
import { formToInput, type ProductFormData } from "@/features/products/pages/product-form-state";
import type { Product, ProductSellingUnit } from "@/types/api";

function packedForm(overrides: Partial<ProductFormData> = {}): ProductFormData {
  return {
    name: "Test Atta",
    category: "grocery",
    brand: "Test",
    unit: "packet",
    packSizeValue: 500,
    packSizeUnit: "gram",
    sellingUnits: [],
    barcode: "PACK-500",
    hsn: "",
    aliasesText: "",
    mrp: 35,
    costPrice: 24,
    sellingPrice: 30,
    gstRate: 0,
    minimumSellingPrice: 25,
    retailPrice: 30,
    retailFromQuantity: 1,
    wholesalePrice: 28,
    wholesaleFromQuantity: 10,
    stockQuantity: 10,
    lowStockAlert: 2,
    reorderLevel: 4,
    description: "",
    imageUrl: "",
    isLooseItem: false,
    isActive: true,
    ...overrides,
  };
}

describe("packed product selling units", () => {
  it("stores packet count separately from inventory base quantity", () => {
    const input = formToInput(packedForm());
    expect(input.baseUnit).toBe("gram");
    expect(input.displayUnit).toBe("packet 500 gram");
    expect(input.stockBaseQty).toBe(5_000);
    expect(input.lowStockThreshold).toBe(1_000);
    expect(input.sellingUnits?.[0]).toEqual(expect.objectContaining({
      name: "packet 500 gram",
      unitCode: "packet-500-gram",
      conversionToBase: 500,
      defaultPrice: 30,
      isDefault: true,
    }));
  });

  it("keeps alternate pack sizes and prices on the same product", () => {
    const oneKg: ProductSellingUnit = {
      name: "packet 1 kg",
      unitType: "packet",
      unitCode: "packet-1-kg",
      packSizeValue: 1,
      packSizeUnit: "kg",
      conversionToBase: 1_000,
      barcode: "PACK-1KG",
      defaultPrice: 58,
      minimumPrice: 54,
      maximumPrice: 65,
      costPrice: 48,
      isDefault: false,
      isActive: true,
    };
    const input = formToInput(packedForm({ sellingUnits: [oneKg] }));
    expect(input.sellingUnits).toHaveLength(2);
    expect(input.sellingUnits?.map((unit) => [unit.unitCode, unit.defaultPrice, unit.conversionToBase])).toEqual([
      ["packet-500-gram", 30, 500],
      ["packet-1-kg", 58, 1_000],
    ]);
  });

  it("uses product plus selling unit as the cart identity", () => {
    const product = { id: "product_atta", name: "Test Atta", defaultPricePerRateUnit: 30 } as Product;
    const pack500 = { name: "packet 500 gram", unitType: "packet", unitCode: "packet-500-gram", conversionToBase: 500, defaultPrice: 30, isDefault: true, isActive: true } as ProductSellingUnit;
    const pack1Kg = { ...pack500, name: "packet 1 kg", unitCode: "packet-1-kg", conversionToBase: 1_000, defaultPrice: 58, isDefault: false };
    const line500 = { product, quantity: 1, rate: 30, unit: pack500.name, sellingUnit: pack500 } as CartItem;
    const line1Kg = { product, quantity: 1, rate: 58, unit: pack1Kg.name, sellingUnit: pack1Kg } as CartItem;
    expect(cartItemKey(line500)).not.toBe(cartItemKey(line1Kg));
  });
});
