import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The typed multiplier is parsed in one place and applied in another, and the
 * join between them is not something a unit test on the parser can see. These
 * are source contracts in the same style as `billing-responsive-layout`: they
 * fail loudly if a refactor quietly unhooks the wiring and leaves `3*rice`
 * searching for nothing, or adding one.
 */

const billingPage = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
const billingSearch = readFileSync("src/features/core/billing/pages/components/BillingSearch.tsx", "utf8");
const english = readFileSync("src/features/core/settings/translations/billing.ts", "utf8");
const hindi = readFileSync("src/features/core/settings/translations/billing.hi.ts", "utf8");

describe("a typed quantity reaches the cart", () => {
  it("strips the multiplier before searching the catalogue", () => {
    // Filtering on the raw query would make `3*rice` match nothing at all,
    // which reads to a cashier as "we do not stock rice".
    expect(billingPage).toContain("const typedQuantity = useMemo(() => parseQuantityQuery(deferredSearch)");
    expect(billingPage).toContain("normalizeSearchText(typedQuantity.term)");
  });

  it("passes the multiplier to the cart when an item is added", () => {
    expect(billingPage).toContain("addToCart(product, sellingUnit, { quantity: typedQuantity.quantity ?? undefined })");
  });

  it("adds the typed quantity rather than one", () => {
    expect(billingPage).toContain("const addedQuantity = options?.quantity && options.quantity > 0 ? options.quantity : 1");
    expect(billingPage).toContain("quantity: addedQuantity");
  });

  it("accumulates onto a line that is already in the cart", () => {
    // Scanning the same packet twice counts twice; `3*rice` on a line holding
    // two makes five. Replacing instead of adding would silently lose a scan.
    expect(billingPage).toContain("roundQuantity(existing.quantity + addedQuantity)");
  });

  it("does not carry a multiplier past a configurator sheet", () => {
    // A dish that opens a portion/add-on sheet collects its own quantity there.
    // Carrying the typed count silently past that screen bills three of
    // whatever the cashier picks next.
    expect(billingPage).toMatch(/if \(data\) setPendingProductConfiguration/);
    expect(billingPage).toContain("else commitAddToCart(product, { sellingUnit, quantity: options?.quantity })");
  });
});

describe("the cashier can see what they typed", () => {
  it("shows the multiplier beside the results", () => {
    // Silent quantity is how somebody bills three and finds out at the total.
    expect(billingSearch).toContain('data-testid="typed-quantity-badge"');
    expect(billingSearch).toContain('t("billing.search.addingQuantity", { count: typedQuantity })');
  });

  it("only shows the badge when a multiplier was actually typed", () => {
    expect(billingSearch).toContain("{typedQuantity != null && (");
  });

  it("is translated in both languages the counter runs in", () => {
    expect(english).toContain('"billing.search.addingQuantity"');
    expect(hindi).toContain('"billing.search.addingQuantity"');
  });
});
