import { describe, expect, it } from "vitest";
import { computeBulkPatch, intentHasEffect, nextSellingPrice, nextStock, type BulkEditIntent } from "@/features/products/bulk-edit";
import type { Product } from "@/types/api";

function product(overrides: Record<string, unknown> = {}): Product & Record<string, unknown> {
  return {
    id: "p1", name: "Sugar", defaultPricePerRateUnit: 100, minPricePerRateUnit: 0, stockBaseQty: 50,
    ...overrides,
  } as never;
}

const NONE: BulkEditIntent = { priceMode: "none", priceValue: 0, stockMode: "none", stockValue: 0 };

describe("bulk price math", () => {
  it("applies percentage increases and decreases", () => {
    expect(nextSellingPrice(product(), { ...NONE, priceMode: "increase_pct", priceValue: 10 })).toBe(110);
    expect(nextSellingPrice(product(), { ...NONE, priceMode: "decrease_pct", priceValue: 25 })).toBe(75);
  });

  it("applies flat increases and decreases without going negative", () => {
    expect(nextSellingPrice(product(), { ...NONE, priceMode: "increase_flat", priceValue: 15 })).toBe(115);
    expect(nextSellingPrice(product({ defaultPricePerRateUnit: 10 }), { ...NONE, priceMode: "decrease_flat", priceValue: 25 })).toBe(0);
  });

  it("sets an absolute price", () => {
    expect(nextSellingPrice(product(), { ...NONE, priceMode: "set", priceValue: 42.5 })).toBe(42.5);
  });

  it("rounds to paise", () => {
    expect(nextSellingPrice(product({ defaultPricePerRateUnit: 33.33 }), { ...NONE, priceMode: "increase_pct", priceValue: 10 })).toBe(36.66);
  });
});

describe("min-price floor", () => {
  it("clamps a percentage cut up to the configured minimum and flags it", () => {
    const result = computeBulkPatch(
      product({ defaultPricePerRateUnit: 100, minPricePerRateUnit: 85 }),
      { ...NONE, priceMode: "decrease_pct", priceValue: 30 }, // would be 70, floor 85
    );
    expect(result.patch.defaultPricePerRateUnit).toBe(85);
    expect(result.flooredToMinimum).toBe(true);
  });

  it("does not floor when the new price stays above the minimum", () => {
    const result = computeBulkPatch(
      product({ defaultPricePerRateUnit: 100, minPricePerRateUnit: 60 }),
      { ...NONE, priceMode: "decrease_pct", priceValue: 30 },
    );
    expect(result.patch.defaultPricePerRateUnit).toBe(70);
    expect(result.flooredToMinimum).toBe(false);
  });
});

describe("bulk stock math", () => {
  it("sets, increases and decreases base stock without going negative", () => {
    expect(nextStock(product({ stockBaseQty: 50 }), { ...NONE, stockMode: "set", stockValue: 12 })).toBe(12);
    expect(nextStock(product({ stockBaseQty: 50 }), { ...NONE, stockMode: "increase", stockValue: 5 })).toBe(55);
    expect(nextStock(product({ stockBaseQty: 3 }), { ...NONE, stockMode: "decrease", stockValue: 10 })).toBe(0);
  });

  it("keeps millesimal precision", () => {
    expect(nextStock(product({ stockBaseQty: 1 }), { ...NONE, stockMode: "increase", stockValue: 0.005 })).toBe(1.005);
  });
});

describe("patch assembly", () => {
  it("combines price and stock and pairs the canonical fields", () => {
    const result = computeBulkPatch(product(), { priceMode: "increase_pct", priceValue: 10, stockMode: "set", stockValue: 20 });
    expect(result.patch).toMatchObject({ defaultPricePerRateUnit: 110, sellingPrice: 110, stockBaseQty: 20, stockQuantity: 20 });
    expect(result.noop).toBe(false);
  });

  it("is a noop when nothing changes", () => {
    const result = computeBulkPatch(product({ defaultPricePerRateUnit: 100 }), { ...NONE, priceMode: "set", priceValue: 100 });
    expect(result.noop).toBe(true);
    expect(result.patch).toEqual({});
  });

  it("intentHasEffect guards empty intents", () => {
    expect(intentHasEffect(NONE)).toBe(false);
    expect(intentHasEffect({ ...NONE, priceMode: "increase_pct", priceValue: 0 })).toBe(false);
    expect(intentHasEffect({ ...NONE, priceMode: "increase_pct", priceValue: 5 })).toBe(true);
    expect(intentHasEffect({ ...NONE, stockMode: "set", stockValue: 0 })).toBe(true);
  });
});
