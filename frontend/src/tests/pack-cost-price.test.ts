import { describe, expect, it } from "vitest";
import type { Product, ProductSellingUnit } from "@/types/api";
import { sellingUnitCostPrice } from "@/features/core/products/pages/product-pricing";

/**
 * Parity with the server's sellingUnitCostPrice
 * (backend/src/modules/products/selling-unit-pricing.js, contracted by
 * backend/tests/pack-cost-price.examples.js). The cases below are that file's, so a
 * change to one rule that is not made in the other shows up here.
 *
 * Gross profit on every bill was computed from a stale cost basis. The default pack's
 * `costPrice` is only a COPY of the product's cost, while `costPerRateUnit` is the
 * weighted average each stock-in recomputes — so reading the copy priced goods at
 * whatever created the row and nothing the shop had bought since. On the counter it
 * also fed that dead price to the margin-floor pricing rule.
 */

const product = { costPerRateUnit: 80 } as unknown as Product;                              // Rs 80 per 1 kg packet
const defaultPack = { conversionToBase: 1000, isDefault: true } as unknown as ProductSellingUnit;
const halfKilo = { conversionToBase: 500 } as unknown as ProductSellingUnit;
const bagPack = { conversionToBase: 5000 } as unknown as ProductSellingUnit;

describe("sellingUnitCostPrice", () => {
  it("costs the default pack at the product's own figure", () => {
    expect(sellingUnitCostPrice(defaultPack, product, defaultPack)).toBe(80);
    expect(sellingUnitCostPrice(null, product, defaultPack)).toBe(80);
  });

  it("costs every other pack at its own size", () => {
    expect(sellingUnitCostPrice(halfKilo, product, defaultPack)).toBe(40);
    expect(sellingUnitCostPrice(bagPack, product, defaultPack)).toBe(400);
  });

  it("lets an alternate pack's own cost win outright", () => {
    // What the shopkeeper typed for THAT size is a fact about a real purchase, and
    // beating the multiple is exactly why a bulk pack is worth buying.
    expect(sellingUnitCostPrice({ ...bagPack, costPrice: 370 }, product, defaultPack)).toBe(370);
    expect(sellingUnitCostPrice({ ...halfKilo, costPrice: 44 }, product, defaultPack)).toBe(44);
  });

  it("prefers the product's cost over a stale copy on the default pack", () => {
    // The reported case: Loose Toor Dal seeds from the starter catalogue at 137.95,
    // is restocked at 120/kg, and sells at 155 — 35.00 of profit, not 17.05.
    const seeded = { ...defaultPack, costPrice: 137.95 } as unknown as ProductSellingUnit;
    const restocked = { costPerRateUnit: 120 } as unknown as Product;
    expect(sellingUnitCostPrice(seeded, restocked, seeded)).toBe(120);
    expect(155 - sellingUnitCostPrice(seeded, restocked, seeded)).toBe(35);
    // And a cost that has RISEN is not flattered by the stale copy either.
    expect(sellingUnitCostPrice({ ...defaultPack, costPrice: 120 }, { costPerRateUnit: 137.95 } as unknown as Product, defaultPack)).toBe(137.95);
  });

  it("keeps the copy as the fallback when the product carries no cost", () => {
    const seeded = { ...defaultPack, costPrice: 137.95 } as unknown as ProductSellingUnit;
    expect(sellingUnitCostPrice(seeded, { costPerRateUnit: 0 } as unknown as Product, defaultPack)).toBe(137.95);
    expect(sellingUnitCostPrice(seeded, {} as unknown as Product, defaultPack)).toBe(137.95);
  });

  it("invents no cost when there is none anywhere", () => {
    expect(sellingUnitCostPrice(halfKilo, { costPerRateUnit: 0 } as unknown as Product, defaultPack)).toBe(0);
    expect(sellingUnitCostPrice(halfKilo, {} as unknown as Product, defaultPack)).toBe(0);
  });

  it("does not scale a restaurant portion", () => {
    // Its conversion is how much recipe stock one portion consumes, so scaling a
    // rupee cost through it invents a number. Same carve-out sellingUnitMaxPrice makes.
    const portion = { unitType: "portion", conversionToBase: 1.4 } as unknown as ProductSellingUnit;
    const dish = { costPerRateUnit: 120 } as unknown as Product;
    expect(sellingUnitCostPrice(portion, dish, defaultPack)).toBe(120);
    expect(sellingUnitCostPrice({ ...portion, costPrice: 150 }, dish, defaultPack)).toBe(150);
  });

  it("falls back rather than dividing by an unusable conversion", () => {
    expect(sellingUnitCostPrice(halfKilo, product, { conversionToBase: 0 } as unknown as ProductSellingUnit)).toBe(80);
    expect(sellingUnitCostPrice({ conversionToBase: 0 } as unknown as ProductSellingUnit, product, defaultPack)).toBe(80);
    // Same size as the default pack is the default pack's cost, no arithmetic.
    expect(sellingUnitCostPrice({ conversionToBase: 1000 } as unknown as ProductSellingUnit, product, defaultPack)).toBe(80);
  });

  it("returns money rounded to paise", () => {
    expect(sellingUnitCostPrice(
      { conversionToBase: 100 } as unknown as ProductSellingUnit,
      { costPerRateUnit: 33.335 } as unknown as Product,
      { conversionToBase: 300, isDefault: true } as unknown as ProductSellingUnit,
    )).toBe(11.11);
  });
});
