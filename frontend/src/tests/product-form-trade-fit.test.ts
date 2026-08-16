import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, defaultCategoryFor, type BusinessType } from "@/features/core/settings/business-types";
import { isScaleUnit } from "@/features/core/products/pages/product-pricing";
import { packMeasureUnitsFor, packSellingUnitsFor } from "@/features/core/products/pages/components/ProductFormPanel";
import { productFormSchema } from "@/features/core/products/pages/product-form-state";
import { packForBusinessType } from "@/features/verticals/registry";

const ALL_TRADES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];

/**
 * A clothing shop was being asked whether a shirt was "packed or loose", and
 * offered kg / gram / litre / ml to sell it in. Weight and volume are the units
 * of loose selling; a trade without that capability must never be shown them.
 */

const source = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");

describe("product form fits the trade", () => {
  it("knows which units need a weighing scale", () => {
    for (const unit of ["kg", "gram", "g", "litre", "ml", "KG"]) expect(isScaleUnit(unit)).toBe(true);
    for (const unit of ["piece", "meter", "pair", "dozen", "set", "plate"]) expect(isScaleUnit(unit)).toBe(false);
  });

  it("gives every trade pack measures it would actually use", () => {
    const measures = (type: BusinessType) => packMeasureUnitsFor(BUSINESS_TYPE_DEFS[type].primaryUnits);

    // A garment, a shoe, a handset and a sofa are all counted, never weighed.
    for (const type of ["clothing", "footwear", "electronics", "furniture", "other"] as const) {
      expect(measures(type), `${type} should count in pieces only`).toEqual(["piece"]);
    }

    // A grocer weighs and pours, but does not pack by the tablet.
    expect(measures("kirana")).toEqual(["piece", "gram", "kg", "ml", "litre"]);
    // A chemist packs by the tablet, and never by the kilo.
    expect(measures("pharmacy")).toEqual(["piece", "tablet", "gram", "ml"]);
    // A stationer sells loose, but by the piece — it must not be offered kilos.
    expect(measures("stationery")).toEqual(["piece"]);
  });

  it("settles what every registered trade is asked", () => {
    const posture = Object.fromEntries(
      (Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[]).map((type) => {
        const capabilities = packForBusinessType(type).capabilities;
        return [type, [
          capabilities.includes("LOOSE_ITEMS") ? "loose" : "-",
          capabilities.includes("BATCH_TRACKING") ? "batch" : "-",
        ].join("/")];
      }),
    );

    // Read this as the answer to "what does this shop's product form ask for?".
    expect(posture).toEqual({
      kirana: "loose/batch",
      stationery: "loose/-",
      pharmacy: "-/batch",
      cosmetics: "-/batch",
      clothing: "-/-",
      footwear: "-/-",
      auto_parts: "-/-",
      electronics: "-/-",
      furniture: "-/-",
      // A kitchen buys dated goods even though it sells undated dishes. The
      // dish leaving the pass has no use-by; the cream it was made from does.
      restaurant: "-/batch",
      // Raw inputs and finished output are batch-traced, but manufacturing
      // items are not sold loose at the counter.
      manufacturing: "-/batch",
      other: "-/-",
    });
  });

  it("asks only a loose-selling trade to choose packed or loose", () => {
    expect(source).toContain("const sellsLoose = hasCapability(\"LOOSE_ITEMS\")");
    // Existing loose stock stays editable after a trade switches away from it.
    expect(source).toContain("const showLooseChoice = sellsLoose || isLoose;");
    expect(source).toContain("{showLooseChoice ? (");
  });

  it("offers batch and expiry only where stock is dated", () => {
    // Restaurant sits with the dated trades, not the undated ones: the question
    // is what the shop STORES, not what it hands over. A kitchen holds dairy,
    // meat and produce — the shortest shelf life of any trade on this list —
    // so it tracks supplier lots and use-by dates like a chemist does.
    const dated = (["kirana", "pharmacy", "cosmetics", "restaurant"] as const)
      .every((type) => packForBusinessType(type).capabilities.includes("BATCH_TRACKING"));
    const undated = (["clothing", "footwear", "auto_parts", "electronics", "furniture"] as const)
      .some((type) => packForBusinessType(type).capabilities.includes("BATCH_TRACKING"));

    expect(dated).toBe(true);
    expect(undated).toBe(false);
    expect(source).toContain('hasCapability("BATCH_TRACKING") || !!batchTracking');
    expect(source).toContain("{showBatchTracking ? (");
  });

  it("does not dump every unit into the picker regardless of trade", () => {
    expect(source).toContain("(showLooseChoice || !isScaleUnit(unit) || unit === selectedUnit)");
    expect(source).not.toContain("filter((u) => !def.primaryUnits.includes(u)).map");
  });
});

/**
 * The quick chips write the SAME `unit` the trade-filtered picker above them
 * controls, so a fixed list quietly undid that filtering: a shoe shop could tap
 * "carton" but never "pair", a chemist "pouch" but never "strip".
 */
describe("the quick selling units come from the trade", () => {
  const chipsFor = (type: BusinessType) => packSellingUnitsFor(BUSINESS_TYPE_DEFS[type].primaryUnits);

  it("offers each trade the unit it actually sells in", () => {
    expect(chipsFor("pharmacy")).toContain("strip");
    expect(chipsFor("footwear")).toContain("pair");
    expect(chipsFor("restaurant")).toContain("plate");
    expect(chipsFor("manufacturing")).toContain("pallet");
    expect(chipsFor("clothing")).toContain("meter");
  });

  it("never offers a unit the picker above would refuse", () => {
    for (const type of ALL_TRADES) {
      const chips = chipsFor(type);
      // Anything can be sold singly, so every trade keeps "piece".
      expect(chips, `${type} cannot sell singly`).toContain("piece");
      for (const unit of chips) {
        expect(
          unit === "piece" || BUSINESS_TYPE_DEFS[type].primaryUnits.includes(unit),
          `${type} chip "${unit}" is not one of its own units`,
        ).toBe(true);
      }
      // Weight and volume are how loose goods are measured, never how a sealed
      // pack is counted.
      expect(chips.some(isScaleUnit), `${type} offers a scale unit as a pack`).toBe(false);
    }
  });

  it("never leaves a blank pack row measured in a unit the trade cannot pick", () => {
    // The row used to start on a hardcoded "500 gram". Seven trades do not list
    // gram, so the measure select rendered EMPTY while still holding it — and a
    // pack built from that blank box carried a 500-gram conversion on a product
    // counted in pieces, taking 500 off the shelf on one sale.
    for (const type of ALL_TRADES) {
      expect(
        packMeasureUnitsFor(BUSINESS_TYPE_DEFS[type].primaryUnits).length,
        `${type} has no pack measure to fall back on`,
      ).toBeGreaterThan(0);
    }
    expect(source).not.toContain('packSizeUnit: "gram"');
    expect(source).toContain("packMeasureUnits.includes(extraPack.packSizeUnit)");
    expect(source).toContain("packSellingUnits.includes(extraPack.unitType)");
  });
});

describe("the form asks each trade only what it can answer", () => {
  it("asks what a pack contains only where a pack is a real thing", () => {
    // A garment shop was shown a required "one piece contains 1 piece", which
    // says nothing and refused the save the moment the box was cleared.
    expect(source).not.toContain("const showPackContent = !isLoose;");
    expect(source).toContain('hasCapability("PACK_CONVERSION")');
    expect(source).toContain("isContainerUnit(selectedUnit)");
    // A pack already sized to something other than one keeps the box on screen
    // whatever the trade, so a conversion cannot go on multiplying stock behind
    // a field nobody can see.
    expect(source).toContain("|| packSizeValue !== 1");
  });

  it("starts a new product in a category its own trade lists", () => {
    for (const type of ALL_TRADES) {
      const categories = BUSINESS_TYPE_DEFS[type].categories.filter((category) => category !== "all");
      expect(categories, `${type} starts outside its own category list`).toContain(defaultCategoryFor(type));
    }
  });

  it("gates the drug schedule on the capability, not on the trade's name", () => {
    expect(source).not.toContain('getStoredBusinessType() === "pharmacy"');
    expect(source).toContain('hasCapability("PRESCRIPTION_TRACKING")');
    expect(packForBusinessType("pharmacy").capabilities).toContain("PRESCRIPTION_TRACKING");
  });

  it("shows a size grid's own total instead of a stock box it would discard", () => {
    // formToInput overwrites stockQuantity with the sum of the grid's cells, so
    // an editable box here is a number the shopkeeper types and the app throws
    // away.
    expect(source).toContain('data-testid="variant-grid-stock-total"');
    expect(source).toContain("{hasVariantGrid ? (");
  });
});

/**
 * A red star that a prefilled zero satisfies is not a requirement, it is a
 * decoration — and it teaches the shop to ignore the stars that are real.
 */
describe("the required markers mean what they say", () => {
  it("keeps a star only where the form will refuse an empty box", () => {
    expect(productFormSchema.safeParse({ name: "Test", sellingPrice: 0 }).success).toBe(false);
    expect(productFormSchema.safeParse({ name: "", sellingPrice: 10 }).success).toBe(false);
    expect(productFormSchema.safeParse({ name: "Test", sellingPrice: 10 }).success).toBe(true);
    expect(source).toContain(`<Field label={t("products.form.sellingPrice")} required`);
  });

  it("drops the star from the money and stock boxes a zero already satisfies", () => {
    // Zero cost, zero stock and zero MRP all save today, so nothing here is
    // required — MRP carries a warning instead, because zero is not "no MRP",
    // it is "no price ceiling at the counter".
    expect(productFormSchema.safeParse({ name: "Test", sellingPrice: 10, mrp: 0, costPrice: 0, stockQuantity: 0 }).success).toBe(true);
    expect(source).not.toContain(`<Field label={t("products.form.mrp")} required>`);
    expect(source).not.toContain(`<Field label={t("products.form.costPrice")} required>`);
    expect(source).toContain(`t("products.form.mrpZeroHint")`);
  });

  it("tells assistive tech which fields are required, since the asterisk is hidden from it", () => {
    expect(source).toContain(`control.setAttribute("aria-required", "true")`);
  });
});
