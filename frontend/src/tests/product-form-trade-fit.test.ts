import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS } from "@/features/core/settings/business-types";
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

  it("offers a clothing shop no weight or volume pack measure", () => {
    const clothing = BUSINESS_TYPE_DEFS.clothing.primaryUnits;
    const sellsLoose = packForBusinessType("clothing").capabilities.includes("LOOSE_ITEMS");

    expect(sellsLoose).toBe(false);
    expect(packMeasureUnitsFor(clothing, sellsLoose)).toEqual(["piece"]);
  });

  it("keeps the kirana and pharmacy measures a counter actually needs", () => {
    const kirana = packMeasureUnitsFor(BUSINESS_TYPE_DEFS.kirana.primaryUnits, true);
    expect(kirana).toContain("kg");
    expect(kirana).toContain("ml");
    // A grocer does not pack goods by the tablet.
    expect(kirana).not.toContain("tablet");

    // A chemist does, and gets there without any loose-selling capability.
    const pharmacy = packMeasureUnitsFor(BUSINESS_TYPE_DEFS.pharmacy.primaryUnits, false);
    expect(pharmacy).toContain("tablet");
    expect(pharmacy).not.toContain("kg");
  });

  it("asks only a loose-selling trade to choose packed or loose", () => {
    expect(source).toContain("const sellsLoose = hasCapability(\"LOOSE_ITEMS\")");
    // Existing loose stock stays editable after a trade switches away from it.
    expect(source).toContain("const showLooseChoice = sellsLoose || isLoose;");
    expect(source).toContain("{showLooseChoice ? (");
  });

  it("does not dump every unit into the picker regardless of trade", () => {
    expect(source).toContain("(showLooseChoice || !isScaleUnit(unit) || unit === selectedUnit)");
    expect(source).not.toContain("filter((u) => !def.primaryUnits.includes(u)).map");
  });
});
