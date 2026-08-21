import { describe, expect, it } from "vitest";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import type { Product } from "@/types/api";

/**
 * A per-pack product's stock is the sum over its packs, and the two figures the
 * form sends have to agree on that or the save is refused outright.
 *
 * The server totals sum(count x pack size) across every active selling unit and
 * rejects any product total that disagrees (PACKAGING_STOCK_TOTAL_MISMATCH). The
 * form used to build that total from the main stock box alone, so "count each
 * size" worked only while every OTHER size was empty — giving a second pack any
 * count at all failed the save on create and on edit alike.
 *
 * The read side had the mirror-image fault: the main stock box was filled by
 * dividing the whole product's stock by the default pack's size, so a shelf of
 * 10 x 1 kg + 20 x 500 g read back as "20", and saving wrote that 20 onto the
 * 1 kg row — opening a product and pressing Save invented 10 kg of salt.
 */

function round2(n: number) { return Math.round(n * 100) / 100; }
function perPackStockTotal(units: any[]) {
  return round2((units ?? []).reduce((t, u) =>
    u?.isActive === false ? t : t + Number(u?.onHandQty ?? 0) * Number(u?.conversionToBase ?? 0), 0));
}
function baseValues(over: Record<string, unknown> = {}) {
  return { ...productToForm(), name: "Tata Salt", sellingPrice: 100, ...over } as Parameters<typeof formToInput>[0];
}
const extraPack = (over: Record<string, unknown> = {}) => ({
  name: "500 g packet", unitType: "packet", unitCode: "packet-500-gram",
  packSizeValue: 500, packSizeUnit: "gram", conversionToBase: 500, barcode: null,
  defaultPrice: 55, minimumPrice: null, maximumPrice: null, costPrice: null,
  onHandQty: null, lowStockThreshold: null, variantValue1: null, variantValue2: null,
  isDefault: false, isActive: true, ...over,
});

describe("per-pack stock totals every pack", () => {
  it("create: extra pack with an opening count is included in the product total", () => {
    const payload = formToInput(baseValues({
      unit: "packet", packSizeValue: 1, packSizeUnit: "kg", packagingMode: "per_pack",
      stockQuantity: 10, lowStockAlert: 2, sellingUnits: [extraPack({ onHandQty: 20 })],
    }));
    expect(payload.packagingMode).toBe("per_pack");
    // 10 x 1 kg + 20 x 500 g = 20,000 g. This used to be 10,000 and the server refused it.
    expect(payload.stockBaseQty).toBe(20000);
    expect(round2(Number(payload.stockBaseQty))).toBe(perPackStockTotal(payload.sellingUnits as any[]));
  });

  it("an inactive pack contributes nothing, matching the server's sum", () => {
    const payload = formToInput(baseValues({
      unit: "packet", packSizeValue: 1, packSizeUnit: "kg", packagingMode: "per_pack",
      stockQuantity: 10, sellingUnits: [extraPack({ onHandQty: 0, isActive: false })],
    }));
    expect(round2(Number(payload.stockBaseQty))).toBe(perPackStockTotal(payload.sellingUnits as any[]));
  });

  it("pooled is untouched: one shared pool, no per-pack counts", () => {
    const payload = formToInput(baseValues({
      unit: "packet", packSizeValue: 1, packSizeUnit: "kg", packagingMode: "pooled",
      stockQuantity: 30, sellingUnits: [extraPack()],
    }));
    expect(payload.stockBaseQty).toBe(30000);
    expect(payload.sellingUnits?.find((u) => u.isDefault)?.onHandQty).toBeUndefined();
  });
});

describe("editing a per-pack product does not move stock", () => {
  const saved = {
    id: "p1", name: "Tata Salt", category: "grocery", unit: "packet",
    displayUnit: "packet 1 kg", rateUnit: "packet", baseUnit: "gram",
    stockBaseQty: 20000, lowStockThreshold: 2000, packagingMode: "per_pack",
    sellingPrice: 100, defaultPricePerRateUnit: 100, mrp: 0, gstRate: 0,
    sellingUnits: [
      { id: "u1", name: "packet 1 kg", unitType: "packet", unitCode: "packet-1-kg", packSizeValue: 1,
        packSizeUnit: "kg", conversionToBase: 1000, defaultPrice: 100, costPrice: 80,
        onHandQty: 10, lowStockThreshold: 2, isDefault: true, isActive: true },
      { id: "u2", name: "500 g packet", unitType: "packet", unitCode: "packet-500-gram", packSizeValue: 500,
        packSizeUnit: "gram", conversionToBase: 500, defaultPrice: 55, costPrice: 42,
        onHandQty: 20, lowStockThreshold: null, isDefault: false, isActive: true },
    ],
  } as unknown as Product;

  it("shows the default pack's own count, not the whole shelf", () => {
    expect(productToForm(saved).stockQuantity).toBe(10);
    expect(productToForm(saved).lowStockAlert).toBe(2);
  });

  it("open and save is a no-op on stock", () => {
    const payload = formToInput(productToForm(saved));
    expect(payload.sellingUnits?.find((u) => u.isDefault)?.onHandQty).toBe(10);
    expect(payload.stockBaseQty).toBe(20000);
    expect(payload.sellingUnits?.find((u) => !u.isDefault)?.costPrice).toBe(42);
  });
});
