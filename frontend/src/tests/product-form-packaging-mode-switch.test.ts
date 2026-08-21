import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { convertPackagingMode, formToInput, productToForm } from "@/features/core/products/pages/product-form-state";

/**
 * Switching "Stock counting" after the pack sizes are already on screen.
 *
 * The toggle sits directly above the pack list, so changing your mind about it is
 * an ordinary thing to do halfway through adding a product — and it is the one
 * moment where the two stock models have to be reconciled. Pooled keeps one number
 * in the main Opening Stock box (each pack's opening quantity is folded into it as
 * it is added); per-pack keeps a count on every row. Flipping between them must
 * carry the goods across, not quietly re-label them.
 */

// What ProductFormPanel's addAlternatePack writes for a pack added while the form
// is in "One shared stock": the pack's own count recorded on the row, AND its
// opening quantity folded into the shared pool in default packs. Pooled saves drop
// the row count; it is kept so that turning "Count each size" on later still knows
// this was 4 bags rather than part of one undifferentiated pile.
function addPackPooled(
  values: ReturnType<typeof productToForm>,
  pack: { unitCode: string; conversionToBase: number; openingQty: number; price: number },
  defaultConversion: number,
) {
  return {
    ...values,
    sellingUnits: [
      ...values.sellingUnits,
      {
        name: pack.unitCode,
        unitType: "packet",
        unitCode: pack.unitCode,
        packSizeValue: pack.conversionToBase,
        packSizeUnit: "gram",
        conversionToBase: pack.conversionToBase,
        defaultPrice: pack.price,
        minimumPrice: null,
        maximumPrice: null,
        costPrice: null,
        onHandQty: pack.openingQty,
        lowStockThreshold: null,
        isDefault: false,
        isActive: true,
      },
    ],
    stockQuantity: values.stockQuantity + (pack.openingQty * pack.conversionToBase) / defaultConversion,
  };
}

function atta() {
  return {
    ...productToForm(),
    name: "Ashirvaad Atta",
    unit: "packet",
    packSizeValue: 1,
    packSizeUnit: "kg",
    sellingPrice: 280,
    costPrice: 240,
    mrp: 300,
    stockQuantity: 10,
  } as ReturnType<typeof productToForm>;
}

describe("changing the stock-counting mode after packs are added", () => {
  it("keeps every pack's goods when pooled is switched to per-pack", () => {
    // 10 x 1 kg, then 4 x 5 kg and 20 x 500 g added while pooled.
    let values = atta();
    values = addPackPooled(values, { unitCode: "packet-5-kg", conversionToBase: 5000, openingQty: 4, price: 1350 }, 1000);
    values = addPackPooled(values, { unitCode: "packet-500-gram", conversionToBase: 500, openingQty: 20, price: 150 }, 1000);

    // Pooled, this is right: 10 + 20 + 10 = 40 one-kg packets = 40 kg on the shelf.
    expect(values.stockQuantity).toBe(40);
    const pooledPayload = formToInput(values);
    expect(pooledPayload.stockBaseQty).toBe(40000);
    // and the pool is the only count a pooled product states.
    for (const unit of pooledPayload.sellingUnits ?? []) {
      if (!unit.isDefault) expect(unit.onHandQty).toBeUndefined();
    }

    // The shopkeeper now decides to count each size separately — the toggle above
    // the pack list, then Save.
    const perPack = formToInput({ ...values, ...convertPackagingMode(values, "per_pack") });

    // The shelf is unchanged — 40 kg of atta, however it is counted.
    expect(perPack.stockBaseQty).toBe(40000);

    const byCode = Object.fromEntries((perPack.sellingUnits ?? []).map((u) => [u.unitCode, u.onHandQty]));
    // and it is still 4 bags and 20 half-kilo packets, not 40 one-kg packets.
    expect(byCode["packet-5-kg"]).toBe(4);
    expect(byCode["packet-500-gram"]).toBe(20);
    expect(byCode["packet-1-kg"]).toBe(10);
  });

  it("keeps every pack's goods when per-pack is switched back to pooled", () => {
    const values = {
      ...atta(),
      packagingMode: "per_pack" as const,
      sellingUnits: [
        {
          name: "packet 5 kg", unitType: "packet", unitCode: "packet-5-kg",
          packSizeValue: 5, packSizeUnit: "kg", conversionToBase: 5000,
          defaultPrice: 1350, minimumPrice: null, maximumPrice: null, costPrice: 1180,
          onHandQty: 4, isDefault: false, isActive: true,
        },
        {
          name: "packet 500 gram", unitType: "packet", unitCode: "packet-500-gram",
          packSizeValue: 500, packSizeUnit: "gram", conversionToBase: 500,
          defaultPrice: 150, minimumPrice: null, maximumPrice: null, costPrice: null,
          onHandQty: 20, isDefault: false, isActive: true,
        },
      ],
    } as ReturnType<typeof productToForm>;

    expect(formToInput(values).stockBaseQty).toBe(40000);

    const switched = { ...values, ...convertPackagingMode(values, "pooled") };
    const pooled = formToInput(switched);
    expect(pooled.stockBaseQty).toBe(40000);
    // 40 one-kg packets is how a pooled product states that same shelf.
    expect(switched.stockQuantity).toBe(40);
    // Pooled sends no per-pack counts, or a number nothing decrements starts drifting.
    for (const unit of pooled.sellingUnits ?? []) {
      if (!unit.isDefault) expect(unit.onHandQty).toBeUndefined();
    }
    // Switching back must land exactly where it started, not compound.
    const back = convertPackagingMode(switched, "per_pack");
    expect(back.stockQuantity).toBe(10);
    expect(formToInput({ ...switched, ...back }).stockBaseQty).toBe(40000);
  });
});

describe("a pooled product saved before per-pack existed", () => {
  it("moves its whole shelf onto the default pack, since no split is recorded", () => {
    // Loaded from the server: 40 kg pooled, alternates carry no count of their own.
    const values = {
      ...productToForm(),
      name: "Loose Atta",
      unit: "packet",
      packSizeValue: 1,
      packSizeUnit: "kg",
      sellingPrice: 280,
      stockQuantity: 40,
      sellingUnits: [
        {
          name: "packet 5 kg", unitType: "packet", unitCode: "packet-5-kg",
          packSizeValue: 5, packSizeUnit: "kg", conversionToBase: 5000,
          defaultPrice: 1350, minimumPrice: null, maximumPrice: null, costPrice: null,
          onHandQty: null, isDefault: false, isActive: true,
        },
      ],
    } as ReturnType<typeof productToForm>;

    const switched = { ...values, ...convertPackagingMode(values, "per_pack") };
    // Nothing is invented for the 5 kg row and nothing is lost: 40 kg, all of it
    // counted as the default pack until the shop counts the sizes apart.
    expect(switched.stockQuantity).toBe(40);
    expect(formToInput(switched).stockBaseQty).toBe(40000);
  });
});

describe("the add-a-pack draft follows the product's measure", () => {
  const source = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");

  // The draft is seeded when the PANEL opens, when a new product is still on the
  // trade's default measure. Describing it as 1 kg afterwards used to leave the
  // draft on "piece", so "one packet contains 5" removed 5 grams, not 5 kg.
  it("re-inherits the measure when the draft is opened after the product changed", () => {
    expect(source).toContain("function toggleExtraPack()");
    expect(source).toContain("onClick={toggleExtraPack}");
    expect(source).toContain("seededMeasureRef.current");
    // Only when it actually moved, or picking gram for a run of small packs would
    // be undone every time the draft is reopened.
    expect(source).toContain("if (productMeasure !== seededMeasureRef.current)");
    // and never to a measure this trade does not pack in.
    expect(source).toContain("if (packMeasureUnits.includes(productMeasure))");
  });
});
