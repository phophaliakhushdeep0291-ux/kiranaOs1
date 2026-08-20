import { describe, expect, it } from "vitest";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import type { Product } from "@/types/api";

/**
 * The product form is where per-packaging stock is switched on and the opening
 * counts are typed. Two things have to hold, and neither is visible by reading the
 * form:
 *
 *  1. A pooled product must be completely unaffected. It is the default and every
 *     existing product is one.
 *  2. In per_pack mode the opening quantity is that pack's OWN count and must not
 *     also be added to the shared pool, or the same goods are counted twice.
 */

function baseValues(overrides: Record<string, unknown> = {}) {
  return {
    ...productToForm(),
    name: "Maggi Noodles",
    sellingPrice: 108,
    ...overrides,
  } as Parameters<typeof formToInput>[0];
}

describe("packaging mode round-trips through the product form", () => {
  it("defaults to pooled and sends no per-pack counts", () => {
    const payload = formToInput(baseValues({ name: "Loose Rice", sellingPrice: 58, stockQuantity: 40 }));

    expect(payload.packagingMode).toBe("pooled");
    const defaultUnit = payload.sellingUnits?.find((unit) => unit.isDefault);
    // Undefined, not 0 — a pooled product must not claim a per-pack count of zero,
    // which a low-stock report would read as "this size has run out".
    expect(defaultUnit?.onHandQty).toBeUndefined();
  });

  it("carries per-pack counts on the default unit when per_pack is chosen", () => {
    const payload = formToInput(
      baseValues({ packagingMode: "per_pack", stockQuantity: 12, lowStockAlert: 3 }),
    );

    expect(payload.packagingMode).toBe("per_pack");
    const defaultUnit = payload.sellingUnits?.find((unit) => unit.isDefault);
    expect(defaultUnit?.onHandQty).toBe(12);
    expect(defaultUnit?.lowStockThreshold).toBe(3);
  });

  it("keeps each additional pack's own count separate", () => {
    const payload = formToInput(
      baseValues({
        packagingMode: "per_pack",
        stockQuantity: 12,
        sellingUnits: [
          {
            name: "70 g packet",
            unitType: "packet",
            unitCode: "packet-70-gram",
            packSizeValue: 70,
            packSizeUnit: "gram",
            conversionToBase: 70,
            defaultPrice: 14,
            onHandQty: 48,
            lowStockThreshold: 12,
            isDefault: false,
            isActive: true,
          },
        ],
      }),
    );

    const packet = payload.sellingUnits?.find((unit) => unit.unitCode === "packet-70-gram");
    expect(packet?.onHandQty).toBe(48);
    expect(packet?.lowStockThreshold).toBe(12);

    // The whole point: the two sizes report independently, so "which size is low?"
    // has an answer.
    const low = (payload.sellingUnits ?? []).filter(
      (unit) =>
        unit.onHandQty != null &&
        unit.lowStockThreshold != null &&
        unit.onHandQty <= unit.lowStockThreshold,
    );
    expect(low).toHaveLength(0);
  });

  it("restores the saved mode when editing an existing product", () => {
    const saved = { id: "p1", name: "Maggi", defaultPricePerRateUnit: 108, packagingMode: "per_pack" } as Product;
    expect(productToForm(saved).packagingMode).toBe("per_pack");
    // A legacy record without either a mode or individual pack quantities is a
    // pooled product.
    expect(productToForm({ ...saved, packagingMode: undefined }).packagingMode).toBe("pooled");
  });

  it("recognises legacy per-pack products from their saved pack quantities", () => {
    const legacyProduct = {
      id: "p1",
      name: "Almond drop",
      packagingMode: undefined,
      sellingUnits: [
        { name: "300 ml", unitCode: "piece-300-ml", onHandQty: 20, isDefault: true },
        { name: "60 ml", unitCode: "piece-60-ml", onHandQty: 30, isDefault: false },
      ],
    } as Product;

    expect(productToForm(legacyProduct).packagingMode).toBe("per_pack");
  });
});
