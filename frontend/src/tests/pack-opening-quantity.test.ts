import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sellingUnitConversion } from "@/features/core/products/pages/product-pricing";
import { productsEn as productsEnglish } from "@/features/core/settings/translations/products";

const source = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");

// "Other pack sizes" now takes an opening quantity. It is a stock-IN expressed in that
// pack, NOT a separate count for it: every pack size draws on one base-unit pool, so the
// quantity is converted and added to the product's opening stock. Storing it per pack
// would create a number that nothing decrements on sale, drifting from real stock the
// moment one is sold.
function addedInDefaultUnits(openingQty: number, packSize: number, packUnit: string, defaultSize: number, defaultUnit: string) {
  const packConversion = sellingUnitConversion(packSize, packUnit);
  const packBaseQuantity = sellingUnitConversion(defaultSize, defaultUnit);
  return packBaseQuantity > 0 ? (openingQty * packConversion) / packBaseQuantity : 0;
}

describe("opening quantity on an alternate pack", () => {
  it("converts through the base unit into the product's own unit", () => {
    // 20 x 500 g packets = 10,000 g. Product is sold as 1 kg packets -> 10 of them.
    expect(addedInDefaultUnits(20, 500, "gram", 1, "kg")).toBe(10);
  });

  it("handles a pack larger than the product's own unit", () => {
    // 3 x 5 kg bags = 15,000 g against a 1 kg default -> 15.
    expect(addedInDefaultUnits(3, 5, "kg", 1, "kg")).toBe(15);
  });

  it("handles a pack smaller than the product's own unit", () => {
    // 4 x 250 g = 1,000 g against a 1 kg default -> 1.
    expect(addedInDefaultUnits(4, 250, "gram", 1, "kg")).toBe(1);
  });

  it("contributes nothing when left blank", () => {
    expect(addedInDefaultUnits(0, 500, "gram", 1, "kg")).toBe(0);
  });
});

describe("the field is wired safely", () => {
  it("adds to the shared opening stock when the packs share one pool", () => {
    expect(source).toContain('form.setValue("stockQuantity"');
  });

  // Per-packaging stock changed the rule this file originally pinned: a per-pack
  // count is no longer "a number nothing decrements", because sale, cancellation,
  // sale return and stock-in all maintain it now. The hazard moved rather than went
  // away — in per_pack mode the opening quantity is that pack's OWN count, so
  // folding it into the shared pool as well would count the same goods twice.
  it("does not also fold the opening quantity into the pool when counting per pack", () => {
    const at = source.indexOf("function addAlternatePack");
    const body = source.slice(at, at + 3200);
    expect(body).toContain('packagingMode === "per_pack"');
    // The pooled branch is skipped entirely by zeroing the quantity it works from.
    // Read off the DRAFT, which is the row clamped to units this trade actually
    // packs in — see the extra-pack measure guard in product-form-trade-fit.
    expect(body).toContain('const openingQty = packagingMode === "per_pack" ? 0 : Number(extraPackDraft.openingQty)');
  });

  it("only applies a positive quantity", () => {
    expect(source).toContain("if (openingQty > 0)");
  });

  it("tells the shopkeeper the packs share one stock", () => {
    expect(source).toContain("share this one stock");
    // The field label moved into the i18n catalogue, so assert the key the form
    // renders and the English text that key still resolves to.
    expect(source).toContain(`t("products.form.openingQuantity")`);
    expect(productsEnglish["products.form.openingQuantity"]).toBe("Opening quantity (Optional)");
  });

  it("guards against a zero default conversion instead of dividing by it", () => {
    expect(source).toContain("packBaseQuantity > 0");
  });
});
