import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { isScaleUnit } from "@/features/core/products/pages/product-pricing";
import { packMeasureUnitsFor } from "@/features/core/products/pages/components/ProductFormPanel";
import { packForBusinessType } from "@/features/verticals/registry";

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
