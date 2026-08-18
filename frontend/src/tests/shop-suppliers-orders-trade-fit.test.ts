import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { loadHindiDictionary } from "@/features/core/settings/i18n";
import { englishTranslations } from "@/features/core/settings/translations/english";
import { SHOP_SUPPLIERS, getShopSuppliersProfile } from "@/features/core/settings/shop-suppliers";
import { SHOP_ORDERS, getShopOrdersProfile } from "@/features/core/settings/shop-orders";
import { packForBusinessType, verticalForPath } from "@/features/verticals/registry";
import { I18N_HARDCODED_ALLOWLIST } from "./i18n-hardcoded-allowlist";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const suppliersPage = read("src/features/core/suppliers/pages/SuppliersPage.tsx");
const ordersPage = read("src/features/core/orders/pages/OrdersReceivedPage.tsx");

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];

describe("suppliers page trade fit", () => {
  it("names who every registered trade buys from", () => {
    expect(Object.keys(SHOP_SUPPLIERS).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopSuppliersProfile(businessType);
      for (const key of [profile.headingKey, profile.pluralWordKey, profile.singularWordKey, profile.focusKey]) {
        expect(englishTranslations[key]?.trim().length, `${businessType}: ${key}`).toBeGreaterThan(2);
      }
      expect(englishTranslations[profile.focusKey].length, businessType).toBeGreaterThan(40);
    }
  });

  it("uses the word the trade actually says", () => {
    // A chemist buys from stockists and distributors holding their own drug
    // licences; a factory buys from vendors. "Supplier" is the generic, and it
    // is wrong often enough that the map is not ceremony.
    expect(englishTranslations[getShopSuppliersProfile("pharmacy").singularWordKey]).toBe("Distributor");
    expect(englishTranslations[getShopSuppliersProfile("manufacturing").singularWordKey]).toBe("Vendor");
    expect(englishTranslations[getShopSuppliersProfile("restaurant").singularWordKey]).toBe("Vendor");
    expect(englishTranslations[getShopSuppliersProfile("kirana").singularWordKey]).toBe("Supplier");

    const words = new Set(BUSINESS_TYPES.map((bt) => englishTranslations[getShopSuppliersProfile(bt).singularWordKey]));
    expect(words.size).toBeGreaterThanOrEqual(3);
  });

  it("sends every trade to the screen that books its goods in", () => {
    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopSuppliersProfile(businessType);
      expect(profile.links.some((link) => link.href === "/purchase-bills"), businessType).toBe(true);

      for (const link of profile.links) {
        const owner = verticalForPath(link.href);
        expect(owner ?? packForBusinessType(businessType).id, `${businessType}: ${link.href}`).toBe(
          packForBusinessType(businessType).id,
        );
      }
    }
  });

  it("wires the map into the page", () => {
    expect(suppliersPage).toContain("getShopSuppliersProfile(useBusinessTypeKey())");
    expect(suppliersPage).toContain("<TradeFocusStrip");
    expect(suppliersPage).toContain("t(tradeProfile.headingKey)");
    // The generic word must be gone from the page, or a chemist would read
    // "Distributors" in the heading and "Add Supplier" on the button beside it.
    expect(suppliersPage).not.toContain(">Suppliers</h1>");
    expect(suppliersPage).not.toContain("Add Supplier\n");
  });
});

describe("orders page trade fit", () => {
  it("describes the order queue for every registered trade", () => {
    expect(Object.keys(SHOP_ORDERS).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopOrdersProfile(businessType);
      expect(englishTranslations[profile.headingKey]?.trim().length, businessType).toBeGreaterThan(2);
      // Accepting an order is a promise to a named person who is already
      // waiting; what makes that promise fail differs per trade, so the line
      // has to say something rather than fill the type.
      expect(englishTranslations[profile.focusKey].length, businessType).toBeGreaterThan(60);
    }
  });

  it("stops calling it 'online orders' for the trades that run an order book", () => {
    expect(englishTranslations[getShopOrdersProfile("restaurant").headingKey]).toBe("Orders");
    expect(englishTranslations[getShopOrdersProfile("furniture").headingKey]).toBe("Customer orders");
    expect(englishTranslations[getShopOrdersProfile("manufacturing").headingKey]).toBe("Buyer orders");
    expect(englishTranslations[getShopOrdersProfile("kirana").headingKey]).toBe("Online orders");
  });

  it("never links a shop into another trade's screens", () => {
    for (const businessType of BUSINESS_TYPES) {
      for (const link of getShopOrdersProfile(businessType).links) {
        const owner = verticalForPath(link.href);
        expect(owner ?? packForBusinessType(businessType).id, `${businessType}: ${link.href}`).toBe(
          packForBusinessType(businessType).id,
        );
      }
    }
  });

  it("wires the map into the page", () => {
    expect(ordersPage).toContain("getShopOrdersProfile(useBusinessTypeKey())");
    expect(ordersPage).toContain("<TradeFocusStrip");
    expect(ordersPage).toContain("t(tradeProfile.headingKey)");
    expect(ordersPage).not.toContain(">Online orders</h1>");
  });

  it("keeps singular and plural as separate keys, not an English 's' suffix", () => {
    // `${n} order${n === 1 ? "" : "s"}` cannot be translated at all: Hindi does
    // not pluralise by adding a letter. Every count on these screens is two keys.
    for (const source of [ordersPage, suppliersPage]) {
      expect(source).not.toMatch(/\$\{[^}]*\}\s*item\$\{/);
      expect(source).not.toMatch(/order\$\{[^}]*\?\s*""/);
      expect(source).not.toMatch(/supplier\$\{[^}]*\?\s*""/);
    }
    expect(englishTranslations["orders.toast.newOrder"]).not.toBe(englishTranslations["orders.toast.newOrders"]);
  });
});

describe("both screens are off the untranslated-debt list", () => {
  it("no longer appears in the i18n allowlist", () => {
    // The allowlist test only proves a listed file still offends. This is the
    // other direction: these two were translated in full, so a later change
    // that re-adds them should be a deliberate, visible decision.
    expect(I18N_HARDCODED_ALLOWLIST).not.toContain("features/core/suppliers/pages/SuppliersPage.tsx");
    expect(I18N_HARDCODED_ALLOWLIST).not.toContain("features/core/orders/pages/OrdersReceivedPage.tsx");
  });

  it("carries a Hindi string for every key both screens added", async () => {
    const hindi = await loadHindiDictionary();
    const keys = Object.keys(englishTranslations).filter((key) => key.startsWith("orders.") || key.startsWith("suppliers."));
    expect(keys.length).toBeGreaterThan(150);
    for (const key of keys) {
      expect(hindi?.[key as keyof typeof englishTranslations], key).toBeTruthy();
    }
  });
});
