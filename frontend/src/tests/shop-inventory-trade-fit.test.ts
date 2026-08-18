import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { englishTranslations } from "@/features/core/settings/translations/english";
import { SHOP_INVENTORY, getShopInventoryProfile, tradeFirstUnits } from "@/features/core/settings/shop-inventory";
import { capabilitiesForBusinessType, packForBusinessType, verticalForPath } from "@/features/verticals/registry";

const inventoryPage = readFileSync(join(process.cwd(), "src/features/core/inventory/pages/InventoryPage.tsx"), "utf8");
const tradeLinks = readFileSync(join(process.cwd(), "src/features/core/settings/shop-trade-links.ts"), "utf8");

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];
const BATCH_CAPABILITIES = ["BATCH_TRACKING", "EXPIRY_TRACKING"] as const;

/**
 * One stock screen, eleven trades.
 *
 * The page is shared, so what makes it belong to a shop is its vocabulary and
 * the screens it points at next. These cases pin both: that every trade is
 * described, that no trade is offered a screen it cannot open, and that the page
 * still reads the map rather than a hardcoded word.
 */
describe("inventory page trade fit", () => {
  it("describes stock in every registered trade's own words", () => {
    expect(Object.keys(SHOP_INVENTORY).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopInventoryProfile(businessType);
      for (const key of [profile.stockTitleKey, profile.itemsLabelKey, profile.receiveLabelKey, profile.wastageLabelKey, profile.focusKey]) {
        // The key type already guarantees the string exists; what it cannot see is
        // an empty or placeholder entry, which renders as a blank label.
        expect(englishTranslations[key]?.trim().length, `${businessType}: ${key}`).toBeGreaterThan(2);
      }
      // The guidance line is a sentence, not a label — a two-word "focus" would
      // mean the trade was filled in to satisfy the type and nothing more.
      expect(englishTranslations[profile.focusKey].length, businessType).toBeGreaterThan(40);
    }
  });

  it("actually renames the page for the trades that count something else", () => {
    // The point of the map is that a restaurant does not read "Total SKUs". If
    // most trades collapsed onto the generic strings, this file would be
    // ceremony — so the spread is asserted rather than assumed.
    const itemLabels = new Set(BUSINESS_TYPES.map((businessType) => englishTranslations[getShopInventoryProfile(businessType).itemsLabelKey]));
    const stockTitles = new Set(BUSINESS_TYPES.map((businessType) => englishTranslations[getShopInventoryProfile(businessType).stockTitleKey]));
    expect(itemLabels.size).toBeGreaterThanOrEqual(8);
    expect(stockTitles.size).toBeGreaterThanOrEqual(8);

    expect(englishTranslations[getShopInventoryProfile("restaurant").wastageLabelKey]).toBe("Wastage Entry");
    expect(englishTranslations[getShopInventoryProfile("pharmacy").itemsLabelKey]).toBe("Total medicines");
    expect(englishTranslations[getShopInventoryProfile("footwear").receiveLabelKey]).toBe("Add Pairs");
  });

  it("never links a shop into another trade's screens", () => {
    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopInventoryProfile(businessType);
      const hrefs = profile.links.map((link) => link.href);
      expect(new Set(hrefs).size, businessType).toBe(hrefs.length);

      for (const link of profile.links) {
        expect(link.href.startsWith("/"), `${businessType}: ${link.href}`).toBe(true);
        // A path belonging to a vertical must belong to THIS shop's vertical.
        // Core paths (owner null) are every shop's and stay allowed.
        const owner = verticalForPath(link.href);
        expect(owner ?? packForBusinessType(businessType).id, `${businessType}: ${link.href}`).toBe(
          packForBusinessType(businessType).id,
        );
      }
    }
  });

  it("offers dated-stock tooling to exactly the trades that hold the capability", () => {
    for (const businessType of BUSINESS_TYPES) {
      const capabilities = capabilitiesForBusinessType(businessType);
      const dated = BATCH_CAPABILITIES.some((capability) => capabilities.includes(capability));
      const link = getShopInventoryProfile(businessType).links.find((entry) => entry.href === "/inventory/batches");

      // A shop without the capability cannot open /inventory/batches — the route
      // is gated on it. Offering the link anyway is the dead end this replaced.
      expect(Boolean(link), businessType).toBe(dated);
      if (link) expect(link.capabilities).toEqual([...BATCH_CAPABILITIES]);
    }
  });

  it("puts the trade's own units first without losing the others", () => {
    const units = ["piece", "kg", "strip", "plate", "yard"];
    expect(tradeFirstUnits(["strip", "bottle"], units)).toEqual(["strip", "piece", "kg", "plate", "yard"]);
    // A unit the trade does not list must stay reachable: products created before
    // the shop changed its business type are still held in it.
    expect(tradeFirstUnits(["plate"], units)).toHaveLength(units.length);
    expect(tradeFirstUnits(["piece", "piece"], units)).toEqual(units);
  });

  it("wires the map into the page instead of hardcoding one trade's words", () => {
    expect(inventoryPage).toContain("getShopInventoryProfile(businessType)");
    expect(inventoryPage).toContain("<TradeFocusStrip");
    expect(inventoryPage).toContain("t(tradeProfile.itemsLabelKey)");
    expect(inventoryPage).toContain("t(tradeProfile.receiveLabelKey)");
    expect(inventoryPage).toContain("t(tradeProfile.wastageLabelKey)");
    expect(inventoryPage).toContain("t(tradeProfile.stockTitleKey)");
    expect(inventoryPage).toContain("tradeFirstUnits(businessTypeDef.primaryUnits, UNITS)");

    // The generic labels these replaced must be gone, or a trade would read one
    // word in the tile and another in the metric beside it.
    expect(inventoryPage).not.toContain('t("inventory.page.totalSkus")');
    expect(inventoryPage).not.toContain('t("inventory.page.addStock")');
    expect(inventoryPage).not.toContain('t("inventory.page.damageTile")');

    // Batch & Expiry is reached through the capability-gated link, never again as
    // a tab every trade can see.
    expect(inventoryPage).not.toContain('setActiveTab("batch")');
    expect(inventoryPage).not.toContain('value="batch"');
  });

  it("filters trade links through the same gate the sidebar uses", () => {
    // The strip is a second door onto routes the sidebar already decides about.
    // If it asked a smaller question, it would become the one place in the app
    // that hands a shop a link the sidebar knows it does not have.
    //
    // Asserted on the shared filter rather than on this page: every screen that
    // offers a trade shortcut now routes through the one function, so a gate
    // dropped here would be dropped for all of them at once.
    expect(tradeLinks).toContain("useIsShopPathVisible");
    expect(tradeLinks).toContain("isShopPathVisible(link.href)");
    expect(tradeLinks).toContain("link.capabilities.some(hasCapability)");
    expect(inventoryPage).not.toContain("isShopPathVisible(link.href)");
  });
});
