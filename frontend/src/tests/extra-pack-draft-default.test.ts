/**
 * The "add a pack" draft must open on a size that makes sense for its own measure.
 *
 * The draft inherits the product's measure — right, because a grocer adding to a 1 kg
 * packet is thinking about the same goods — but the size was a flat 500 for anything
 * that was not "piece". On a product described in kg that opened the draft on
 * "500 kg": half a tonne, with the scaled cost and MRP hints beneath it reading
 * ₹11,000 and ₹15,000. Nothing was wrong with the arithmetic; the number and the
 * measure simply disagreed, and a shop that typed a price without re-reading the size
 * would have built a 500 kg pack whose single sale empties the shelf.
 */
import { describe, expect, it } from "vitest";
import { emptyExtraPack } from "@/features/core/products/pages/components/ProductFormPanel";
import { sellingUnitConversion } from "@/features/core/products/pages/product-pricing";

describe("the extra-pack draft opens on a plausible size", () => {
  it.each([
    ["gram", "500"],
    ["ml", "500"],
    ["kg", "1"],
    ["litre", "1"],
    ["piece", "1"],
    // Trade units that are counted, not measured — 500 of them is not a pack either.
    ["box", "1"],
    ["dozen", "1"],
  ])("seeds %s with %s", (measure, expected) => {
    expect(emptyExtraPack("packet", measure).packSizeValue).toBe(expected);
  });

  it("never opens on a pack bigger than a kilo or a litre", () => {
    // The property behind the table: whatever the measure, the seeded pack is
    // something a counter actually sells. "500 kg" was 500_000 base units.
    for (const measure of ["gram", "ml", "kg", "litre", "piece", "box", "dozen"]) {
      const draft = emptyExtraPack("packet", measure);
      const baseQuantity = sellingUnitConversion(Number(draft.packSizeValue), measure);
      expect(baseQuantity, `${draft.packSizeValue} ${measure}`).toBeLessThanOrEqual(1000);
    }
  });

  it("leaves the money fields blank so each pack still scales from the product", () => {
    // Blank cost/MRP is what makes the server scale them per pack size; filling them
    // in here would freeze today's arithmetic into every future price change.
    expect(emptyExtraPack("packet", "kg")).toEqual(expect.objectContaining({
      unitType: "packet",
      packSizeUnit: "kg",
      price: "",
      mrp: "",
      costPrice: "",
      barcode: "",
      openingQty: "",
    }));
  });
});
