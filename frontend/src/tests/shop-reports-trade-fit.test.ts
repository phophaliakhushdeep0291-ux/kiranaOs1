import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { englishTranslations } from "@/features/core/settings/translations/english";
import { SHOP_REPORTS, getShopReportsProfile } from "@/features/core/settings/shop-reports";
import { capabilitiesForBusinessType, packForBusinessType, verticalForPath } from "@/features/verticals/registry";

const reportsPage = readFileSync(join(process.cwd(), "src/features/core/reports/pages/ReportsPage.tsx"), "utf8");

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];
const BATCH_CAPABILITIES = ["BATCH_TRACKING", "EXPIRY_TRACKING"] as const;

/**
 * One report, eleven trades.
 *
 * An owner reads the label before the number, so a word from someone else's
 * trade makes them stop and re-read. These cases pin that every trade is named,
 * that the naming is real rather than twelve copies of one string, and that no
 * trade is sent to a screen it cannot open.
 */
describe("reports page trade fit", () => {
  it("names the report in every registered trade's own words", () => {
    expect(Object.keys(SHOP_REPORTS).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopReportsProfile(businessType);
      for (const key of [profile.headingKey, profile.salesLabelKey, profile.creditWordKey, profile.topItemsKey, profile.watchKey]) {
        expect(englishTranslations[key]?.trim().length, `${businessType}: ${key}`).toBeGreaterThan(2);
      }
      // The watch line is a sentence of advice, not a label — a two-word entry
      // would mean the trade was filled in to satisfy the type and nothing more.
      expect(englishTranslations[profile.watchKey].length, businessType).toBeGreaterThan(40);
    }
  });

  it("actually renames the numbers that mean something different per trade", () => {
    const distinct = (pick: (businessType: BusinessType) => string) =>
      new Set(BUSINESS_TYPES.map((businessType) => englishTranslations[pick(businessType) as keyof typeof englishTranslations]));

    expect(distinct((bt) => getShopReportsProfile(bt).headingKey).size).toBeGreaterThanOrEqual(9);
    expect(distinct((bt) => getShopReportsProfile(bt).topItemsKey).size).toBeGreaterThanOrEqual(7);
    expect(distinct((bt) => getShopReportsProfile(bt).creditWordKey).size).toBeGreaterThanOrEqual(6);

    expect(englishTranslations[getShopReportsProfile("restaurant").salesLabelKey]).toBe("Total Revenue");
    expect(englishTranslations[getShopReportsProfile("manufacturing").salesLabelKey]).toBe("Dispatch Value");
    expect(englishTranslations[getShopReportsProfile("pharmacy").creditWordKey]).toBe("Patient Accounts");
    expect(englishTranslations[getShopReportsProfile("restaurant").topItemsKey]).toBe("Top Dishes");
  });

  it("keeps the credit word interpolable everywhere it is reused", () => {
    // One phrase per language instead of one per trade only works while the slot
    // survives; a dropped {credit} would render "Outstanding" with no noun.
    for (const key of ["reports.kpi.outstandingCredit", "reports.table.topCustomers", "reports.mobile.creditDue"] as const) {
      expect(englishTranslations[key], key).toContain("{credit}");
    }
  });

  it("never links a shop into another trade's screens", () => {
    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopReportsProfile(businessType);
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

  it("offers dated-stock tooling to exactly the trades that hold the capability", () => {
    for (const businessType of BUSINESS_TYPES) {
      const capabilities = capabilitiesForBusinessType(businessType);
      const dated = BATCH_CAPABILITIES.some((capability) => capabilities.includes(capability));
      const link = getShopReportsProfile(businessType).links.find((entry) => entry.href === "/inventory/batches");

      expect(Boolean(link), businessType).toBe(dated);
      if (link) expect(link.capabilities).toEqual([...BATCH_CAPABILITIES]);
    }
  });

  it("wires the map into the page instead of hardcoding one trade's words", () => {
    expect(reportsPage).toContain("getShopReportsProfile(businessType)");
    expect(reportsPage).toContain("<TradeFocusStrip");
    expect(reportsPage).toContain("t(tradeProfile.headingKey)");
    expect(reportsPage).toContain("t(tradeProfile.topItemsKey)");
    expect(reportsPage).toContain('t("reports.table.topCustomers", { credit: creditWord })');
    expect(reportsPage).toContain('t("reports.kpi.outstandingCredit", { credit: creditWord })');

    // The generic words these replaced must be gone, or one card would disagree
    // with the card beside it.
    expect(reportsPage).not.toContain('label: "Total Sales"');
    expect(reportsPage).not.toContain('label: "Outstanding Udhar"');
    expect(reportsPage).not.toContain('title="Top Products"');
    expect(reportsPage).not.toContain('title="Top Customers (Udhar)"');
    expect(reportsPage).not.toContain('name: "Udhar"');
  });

  it("keys the KPI sparkline gradient on an id, not on the translated label", () => {
    // Two <linearGradient> elements sharing an id paint one card with the
    // other's fill, and a Devanagari label slugs down to nothing — so every
    // card's gradient would have collided the moment the labels were translated.
    expect(reportsPage).toContain("const gradientId = `report-kpi-${id}`");
    expect(reportsPage).not.toContain("label.toLowerCase().replace");
    // Same reason the loading flag cannot ask whether the English word
    // "Expense" appears in the label.
    expect(reportsPage).toContain('kpi.id === "expense"');
  });
});
