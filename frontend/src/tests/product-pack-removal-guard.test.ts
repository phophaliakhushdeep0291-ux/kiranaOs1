import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { productsEn as productsEnglish } from "@/features/core/settings/translations/products";
import { productsHi as productsHindi } from "@/features/core/settings/translations/products.hi";

const source = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");

/**
 * Removing a pack size that still holds stock.
 *
 * The server refuses it (PACKAGING_UNIT_HAS_STOCK) because the goods would be
 * left with nothing counting them, and it compares against the SAVED quantity —
 * so zeroing the row and removing it in the same save is refused too. The form
 * used to allow the removal anyway: the row vanished, the save reported
 * "Updated", the product's stock fell by that pack's worth, and the refusal only
 * surfaced later as a sync conflict, with the screen and the server disagreeing
 * about how much stock the shop owned.
 */
describe("removing a pack that still has stock", () => {
  it("checks the saved quantity, not the one being typed", () => {
    const at = source.indexOf("function removeAlternatePack");
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, at + 1400);
    // The server compares against what it already stored, so the form must too.
    expect(body).toContain("editing?.sellingUnits?.find");
    expect(body).toContain("savedQty");
    expect(body).toContain("return;");
  });

  it("only guards per-pack products, where a pack carries its own count", () => {
    const at = source.indexOf("function removeAlternatePack");
    const body = source.slice(at, at + 1400);
    // Pooled sizes all draw on one pool, so dropping one strands nothing.
    expect(body).toContain('packagingMode === "per_pack"');
  });

  it("tells the shopkeeper what to do about it, in both languages", () => {
    const at = source.indexOf("function removeAlternatePack");
    const body = source.slice(at, at + 1400);
    expect(body).toContain('t("products.form.packHasStock")');
    expect(body).toContain('t("products.form.packHasStockHint")');
    expect(productsEnglish["products.form.packHasStock"]).toBe("Count this pack to zero first");
    // The hint names the amount, so the count and the pack are both on screen.
    expect(productsEnglish["products.form.packHasStockHint"]).toContain("{qty}");
    expect(productsHindi["products.form.packHasStock"]).toBeTruthy();
    expect(productsHindi["products.form.packHasStockHint"]).toContain("{qty}");
  });
});
