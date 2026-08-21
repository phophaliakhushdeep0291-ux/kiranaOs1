import { describe, expect, it } from "vitest";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";

function round2(n: number) { return Math.round(n * 100) / 100; }
function perPackStockTotal(units: any[]) {
  return round2((units ?? []).reduce((t, u) => {
    if (u?.isActive === false) return t;
    return t + Number(u?.onHandQty ?? 0) * Number(u?.conversionToBase ?? 0);
  }, 0));
}

function baseValues(overrides: Record<string, unknown> = {}) {
  return { ...productToForm(), name: "Tata Salt", sellingPrice: 100, ...overrides } as Parameters<typeof formToInput>[0];
}

describe("REPRO: add extra packs", () => {
  it("per_pack + extra pack with opening qty", () => {
    const payload = formToInput(baseValues({
      unit: "packet",
      packSizeValue: 1,
      packSizeUnit: "kg",
      packagingMode: "per_pack",
      stockQuantity: 10,
      lowStockAlert: 2,
      sellingUnits: [{
        name: "500 g packet", unitType: "packet", unitCode: "packet-500-gram",
        packSizeValue: 500, packSizeUnit: "gram", conversionToBase: 500,
        barcode: null, defaultPrice: 55, minimumPrice: null, maximumPrice: null,
        costPrice: null, onHandQty: 20, lowStockThreshold: null,
        variantValue1: null, variantValue2: null, isDefault: false, isActive: true,
      }],
    }));
    console.log("packagingMode:", payload.packagingMode);
    console.log("stockBaseQty sent:", payload.stockBaseQty);
    console.log("perPackStockTotal:", perPackStockTotal(payload.sellingUnits as any[]));
    console.log("units:", JSON.stringify(payload.sellingUnits, null, 1));
    expect(round2(Number(payload.stockBaseQty))).toBe(perPackStockTotal(payload.sellingUnits as any[]));
  });

  it("pooled + extra pack (cost price)", () => {
    const payload = formToInput(baseValues({
      unit: "packet", packSizeValue: 1, packSizeUnit: "kg",
      packagingMode: "pooled", stockQuantity: 10, costPrice: 80,
      sellingUnits: [{
        name: "500 g packet", unitType: "packet", unitCode: "packet-500-gram",
        packSizeValue: 500, packSizeUnit: "gram", conversionToBase: 500,
        barcode: null, defaultPrice: 55, minimumPrice: null, maximumPrice: null,
        costPrice: null, onHandQty: null, lowStockThreshold: null,
        variantValue1: null, variantValue2: null, isDefault: false, isActive: true,
      }],
    }));
    console.log("POOLED units:", JSON.stringify(payload.sellingUnits, null, 1));
  });
});
