import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { englishTranslations } from "@/features/core/settings/translations/english";
import { SHOP_PRODUCTS, getShopProductsProfile } from "@/features/core/settings/shop-products";
import { capabilitiesForBusinessType, packForBusinessType, verticalForPath } from "@/features/verticals/registry";

const productsPage = readFileSync(join(process.cwd(), "src/features/core/products/pages/ProductsPage.tsx"), "utf8");

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];
const BATCH_CAPABILITIES = ["BATCH_TRACKING", "EXPIRY_TRACKING"] as const;

/**
 * One catalogue, eleven trades.
 *
 * The sidebar has always reached this screen under the trade's own word for it —
 * `navConfig` labels `/products` "Menu", "Medicines" or "Parts". These cases pin
 * that the page now answers in the same word, and that the search box names the
 * identifier the trade actually types.
 */
describe("products page trade fit", () => {
  it("names the catalogue in every registered trade's own words", () => {
    expect(Object.keys(SHOP_PRODUCTS).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopProductsProfile(businessType);
      for (const key of [profile.totalLabelKey, profile.totalHintKey, profile.searchPlaceholderKey, profile.focusKey]) {
        expect(englishTranslations[key]?.trim().length, `${businessType}: ${key}`).toBeGreaterThan(2);
      }
      // The focus line is a sentence of trade advice, not a label — a two-word
      // entry would mean the trade was filled in to satisfy the type alone.
      expect(englishTranslations[profile.focusKey].length, businessType).toBeGreaterThan(40);
    }
  });

  it("agrees with the sidebar word that reached the screen", () => {
    // The bug this closes: the nav said "Menu" and the page it opened said
    // "Total Products". Any trade whose nav renames /products must count its
    // rows under a different word from the generic one.
    for (const businessType of BUSINESS_TYPES) {
      // `navConfig.products` holds a dictionary KEY now, not the word, so the
      // skip has to resolve it first — comparing the key against "Products"
      // never matched and put kirana, which does not rename /products, into the
      // check it was written to exempt.
      if (englishTranslations[BUSINESS_TYPE_DEFS[businessType].navConfig.products] === "Products") continue;
      expect(
        englishTranslations[getShopProductsProfile(businessType).totalLabelKey],
        businessType,
      ).not.toBe("Total Products");
    }

    expect(englishTranslations[getShopProductsProfile("restaurant").totalLabelKey]).toBe("Total Dishes");
    expect(englishTranslations[getShopProductsProfile("pharmacy").totalLabelKey]).toBe("Total Medicines");
    expect(englishTranslations[getShopProductsProfile("auto_parts").totalLabelKey]).toBe("Total Parts");
  });

  it("names the identifier each trade actually searches by", () => {
    // The placeholder matters more than the heading: it is the screen telling a
    // shop what its own catalogue can be found by.
    const placeholders = new Set(
      BUSINESS_TYPES.map((businessType) => englishTranslations[getShopProductsProfile(businessType).searchPlaceholderKey]),
    );
    expect(placeholders.size).toBeGreaterThanOrEqual(9);

    expect(englishTranslations[getShopProductsProfile("pharmacy").searchPlaceholderKey]).toContain("salt");
    expect(englishTranslations[getShopProductsProfile("auto_parts").searchPlaceholderKey]).toContain("OEM");
    expect(englishTranslations[getShopProductsProfile("stationery").searchPlaceholderKey]).toContain("ISBN");
  });

  it("never links a shop into another trade's screens", () => {
    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopProductsProfile(businessType);
      const hrefs = profile.links.map((link) => link.href);
      expect(new Set(hrefs).size, businessType).toBe(hrefs.length);

      for (const link of profile.links) {
        expect(link.href.startsWith("/"), `${businessType}: ${link.href}`).toBe(true);
        const owner = verticalForPath(link.href);
        expect(owner ?? packForBusinessType(businessType).id, `${businessType}: ${link.href}`).toBe(
          packForBusinessType(businessType).id,
        );
      }
    }
  });

  it("only offers dated-stock tooling to a shop that can open it", () => {
    // Deliberately weaker than the same case on the stock and report screens.
    // Which dated trades want this link differs by screen — a restaurant's
    // catalogue is its menu, and dishes do not carry a lot number even though
    // the ingredients behind them do. What must never happen is the dead end:
    // the link shown to a shop whose route is gated shut.
    for (const businessType of BUSINESS_TYPES) {
      const link = getShopProductsProfile(businessType).links.find((entry) => entry.href === "/inventory/batches");
      if (!link) continue;

      const capabilities = capabilitiesForBusinessType(businessType);
      expect(BATCH_CAPABILITIES.some((capability) => capabilities.includes(capability)), businessType).toBe(true);
      expect(link.capabilities).toEqual([...BATCH_CAPABILITIES]);
    }
  });

  it("wires the map into the page instead of hardcoding one trade's words", () => {
    expect(productsPage).toContain("getShopProductsProfile(useBusinessTypeKey())");
    expect(productsPage).toContain("<TradeFocusStrip");
    expect(productsPage).toContain("t(tradeProfile.totalLabelKey)");
    expect(productsPage).toContain("t(tradeProfile.totalHintKey)");
    expect(productsPage).toContain("t(tradeProfile.searchPlaceholderKey)");

    // The generic strings these replaced must be gone from the list screen, or a
    // chemist would read "Total Medicines" over a box asking for a product name.
    expect(productsPage).not.toContain('t("products.stats.total")');
    expect(productsPage).not.toContain('t("products.search.placeholder")');
  });
});
