import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { productsEn as productsEnglish } from "@/features/core/settings/translations/products";
import { productsHi as productsHindi } from "@/features/core/settings/translations/products.hi";

const source = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");

/**
 * Removing a pack size that still holds stock.
 *
 * This used to be refused: the shopkeeper had to count the pack to zero, save,
 * and only then remove it — two saves and a red error to stop selling a size.
 * The refusal was guarding something real, because perPackStockTotal is computed
 * from the incoming units, so a removed pack silently lowers the product's total
 * and without a ledger row that drop has no explanation.
 *
 * It now writes the stock off instead of forbidding the removal: one save, and
 * the server records a ledger row naming the pack and the amount. The screen
 * says so first, because a delete that quietly takes ten litres off the books is
 * not something to discover later.
 */
describe("removing a pack that still has stock", () => {
  it("removes it rather than refusing", () => {
    const at = source.indexOf("function removeAlternatePack");
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, at + 1400);
    // The old guard returned early and left the row in place.
    expect(body).not.toContain("packHasStock");
    expect(body).toContain("form.setValue(\"sellingUnits\"");
  });

  it("still reads the SAVED quantity, which is what gets written off", () => {
    const at = source.indexOf("function removeAlternatePack");
    const body = source.slice(at, at + 1400);
    // What the shopkeeper is typing has not happened yet; the write-off is of
    // what the server currently holds.
    expect(body).toContain("editing?.sellingUnits?.find");
    expect(body).toContain("savedQty");
  });

  it("only warns for per-pack products, where a pack carries its own count", () => {
    const at = source.indexOf("function removeAlternatePack");
    const body = source.slice(at, at + 1400);
    // Pooled sizes all draw on one pool, so dropping one strands nothing and
    // there is no write-off to announce.
    expect(body).toContain('packagingMode === "per_pack"');
  });

  it("says what will happen, with the amount, in both languages", () => {
    const at = source.indexOf("function removeAlternatePack");
    const body = source.slice(at, at + 1400);
    expect(body).toContain('t("products.form.packRemovedWithStock")');
    expect(body).toContain('t("products.form.packRemovedWithStockHint")');
    expect(productsEnglish["products.form.packRemovedWithStock"]).toBe("Pack removed, stock written off");
    // The hint names the amount, so the count and the pack are both on screen.
    expect(productsEnglish["products.form.packRemovedWithStockHint"]).toContain("{qty}");
    expect(productsHindi["products.form.packRemovedWithStock"]).toBeTruthy();
    expect(productsHindi["products.form.packRemovedWithStockHint"]).toContain("{qty}");
  });
});
