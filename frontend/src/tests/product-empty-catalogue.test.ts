import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { productsEn as productsEnglish } from "@/features/core/settings/translations/products";
import { productsHi as productsHindi } from "@/features/core/settings/translations/products.hi";

const source = readFileSync("src/features/core/products/pages/ProductsPage.tsx", "utf8");
const setup = readFileSync("src/features/core/settings/pages/MerchantSetupPage.tsx", "utf8");

/**
 * A shop with nothing in its catalogue is the moment the "typing in every product
 * takes hours" problem is felt, and the screen offered only "Add a product". Both
 * ways out already existed — the 560-item starter catalog, two levels into
 * Settings, and the CSV importer behind a toolbar button — and neither was
 * reachable from the empty list.
 */
describe("the empty catalogue offers a way in", () => {
  it("offers the ready-made list, an import, and adding one", () => {
    expect(source).toContain("function EmptyCatalogue");
    expect(source).toContain('data-testid="empty-starter-catalog"');
    expect(source).toContain('data-testid="empty-import"');
    expect(source).toContain('data-testid="empty-add-one"');
  });

  it("sends the shop to the catalogue row, not the top of the checklist", () => {
    expect(source).toContain('setLocation("/settings/setup?focus=products")');
    // The setup page has to act on that, or the shop lands seven steps above it.
    expect(setup).toContain('get("focus")');
    expect(setup).toContain('[data-testid="starter-catalog-start"]');
  });

  it("keeps the filtered-to-nothing wording, which is a different problem", () => {
    // The products are there; a filter is hiding them, so offering a starter
    // catalog would be answering a question nobody asked.
    expect(source).toContain("if (filtered)");
    expect(source).toContain('t("products.list.emptyHintFilters")');
    expect(source).toContain("const catalogueIsFiltered");
  });

  it("says it in both languages", () => {
    for (const key of [
      "products.list.emptyStartTitle",
      "products.list.emptyStartHint",
      "products.list.emptyStarterCta",
      "products.list.emptyImportCta",
      "products.list.emptyAddCta",
    ] as const) {
      expect(productsEnglish[key]).toBeTruthy();
      expect(productsHindi[key]).toBeTruthy();
    }
    expect(productsEnglish["products.list.emptyStartTitle"]).toBe("Your catalogue is empty");
  });
});
