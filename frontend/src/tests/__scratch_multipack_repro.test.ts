import { describe, expect, it } from "vitest";
import { productFormSchema, formToInput } from "@/features/products/pages/product-form-state";
import { sellingUnitCode, sellingUnitConversion, sellingUnitName } from "@/features/products/pages/product-pricing";
import { productCreationSchema } from "@/lib/validation/schemas";

function extraPack(unitType: string, size: number, packUnit: string, price: number) {
  return {
    name: sellingUnitName(unitType, size, packUnit),
    unitType,
    unitCode: sellingUnitCode(unitType, size, packUnit),
    packSizeValue: size,
    packSizeUnit: packUnit,
    conversionToBase: sellingUnitConversion(size, packUnit),
    barcode: null,
    defaultPrice: price,
    minimumPrice: null,
    maximumPrice: null,
    costPrice: null,
    isDefault: false,
    isActive: true,
  };
}

function baseForm(overrides: Record<string, unknown> = {}) {
  // Exactly what the Add Product form holds after a user fills it + adds packs.
  return productFormSchema.parse({
    name: "Sugar",
    category: "grocery",
    unit: "packet",
    packSizeValue: 1,
    packSizeUnit: "kg",
    sellingUnits: [],
    aliasesText: "",
    mrp: 60,
    costPrice: 40,
    sellingPrice: 50,
    minimumSellingPrice: 45,
    retailPrice: 50,
    retailFromQuantity: 1,
    wholesalePrice: 48,
    wholesaleFromQuantity: 10,
    stockQuantity: 20,
    lowStockAlert: 2,
    gstRate: 0,
    reorderLevel: 0,
    description: "",
    imageUrl: "",
    isLooseItem: false,
    isActive: true,
    batchTrackingEnabled: false,
    ...overrides,
  });
}

describe("multi-packaging Add Product repro", () => {
  it("2 extra packs (bag 5kg, pouch 500g): form -> input -> creation schema", () => {
    const values = baseForm({
      sellingUnits: [extraPack("bag", 5, "kg", 240), extraPack("pouch", 500, "g", 26)],
    });
    const input = formToInput(values, "1234");
    expect(input.sellingUnits).toHaveLength(3);
    const parsed = productCreationSchema.parse(input);
    expect(parsed.sellingUnits).toHaveLength(3);
    console.log("PAYLOAD_UNITS", JSON.stringify(parsed.sellingUnits));
  });

  it("same unitType different sizes (packet 1kg default + packet 500g + packet 5kg)", () => {
    const values = baseForm({
      sellingUnits: [extraPack("packet", 500, "g", 26), extraPack("packet", 5, "kg", 240)],
    });
    const input = formToInput(values, "1234");
    expect(input.sellingUnits).toHaveLength(3);
    productCreationSchema.parse(input);
  });

  it("piece-based packs (box of 12 piece + carton of 144 piece)", () => {
    const values = baseForm({
      unit: "piece",
      packSizeValue: 1,
      packSizeUnit: "piece",
      sellingUnits: [extraPack("box", 12, "piece", 550), extraPack("carton", 144, "piece", 6200)],
    });
    const input = formToInput(values, "1234");
    expect(input.sellingUnits).toHaveLength(3);
    productCreationSchema.parse(input);
    console.log("PIECE_UNITS", JSON.stringify(input.sellingUnits?.map((u) => ({ code: u.unitCode, conv: u.conversionToBase }))));
  });

  it("loose item with extra packs", () => {
    const values = baseForm({
      isLooseItem: true,
      unit: "kg",
      sellingUnits: [extraPack("bag", 5, "kg", 240)],
    });
    const input = formToInput(values, "1234");
    productCreationSchema.parse(input);
  });
});
