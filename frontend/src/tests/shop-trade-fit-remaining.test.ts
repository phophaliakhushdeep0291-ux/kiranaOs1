import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { englishTranslations } from "@/features/core/settings/i18n";
import { SHOP_CREDIT_WORD } from "@/features/core/settings/shop-credit";
import { SHOP_CUSTOMERS, getShopCustomersProfile } from "@/features/core/settings/shop-customers";
import { SHOP_PURCHASES, getShopPurchasesProfile } from "@/features/core/settings/shop-purchases";
import { getShopReportsProfile } from "@/features/core/settings/shop-reports";
import { expenseCategoriesFor, expenseCategoryOptions } from "@/features/core/settings/shop-expenses";
import { packForBusinessType, verticalForPath } from "@/features/verticals/registry";

const customersPage = readFileSync(join(process.cwd(), "src/features/core/customers/pages/CustomersPage.tsx"), "utf8");
const purchasesPage = readFileSync(join(process.cwd(), "src/features/core/purchases/pages/PurchaseBillsPage.tsx"), "utf8");
const expensesPage = readFileSync(join(process.cwd(), "src/features/core/expenses/pages/ExpensesPage.tsx"), "utf8");

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];

describe("customers page trade fit", () => {
  it("describes the account in every registered trade's own words", () => {
    expect(Object.keys(SHOP_CUSTOMERS).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopCustomersProfile(businessType);
      for (const key of [profile.headingKey, profile.subtitleKey, profile.creditWordKey, profile.focusKey]) {
        expect(englishTranslations[key]?.trim().length, `${businessType}: ${key}`).toBeGreaterThan(2);
      }
      expect(englishTranslations[profile.focusKey].length, businessType).toBeGreaterThan(40);
    }
  });

  it("calls money owed the same thing here as it does on the report", () => {
    // An owner who follows "Patient Accounts" off a report must not land on a
    // screen that calls the same number udhar. One map, read by both.
    for (const businessType of BUSINESS_TYPES) {
      expect(getShopCustomersProfile(businessType).creditWordKey, businessType).toBe(
        getShopReportsProfile(businessType).creditWordKey,
      );
      expect(getShopCustomersProfile(businessType).creditWordKey, businessType).toBe(SHOP_CREDIT_WORD[businessType]);
    }
  });

  it("keeps the credit word interpolable in the phrase the page builds", () => {
    expect(englishTranslations["customers.trade.outstanding"]).toContain("{credit}");
    expect(customersPage).toContain('t("customers.trade.outstanding", { credit: creditWord })');
    expect(customersPage).toContain("t(tradeProfile.headingKey)");
    expect(customersPage).toContain("<TradeFocusStrip");
    expect(customersPage).not.toContain('t("customers.totalOutstanding")');
  });
});

describe("purchases page trade fit", () => {
  it("says what every trade still has to record after receiving", () => {
    expect(Object.keys(SHOP_PURCHASES).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopPurchasesProfile(businessType);
      expect(englishTranslations[profile.focusKey]?.length, businessType).toBeGreaterThan(40);
      // Receiving without a next step is the gap this closes; a trade with no
      // link at all would leave the screen exactly as it was.
      expect(profile.links.length, businessType).toBeGreaterThan(0);
    }
  });

  it("sends the trades that receive dated goods to batch and expiry", () => {
    // The lot number is printed on the strip in the receiver's hand and nowhere
    // else afterwards. These are the trades for which that is the whole job.
    for (const businessType of ["pharmacy", "cosmetics", "kirana"] as const) {
      expect(
        getShopPurchasesProfile(businessType).links.some((link) => link.href === "/inventory/batches"),
        businessType,
      ).toBe(true);
    }
    expect(getShopPurchasesProfile("electronics").links.some((link) => link.href === "/serial-units")).toBe(true);
    expect(getShopPurchasesProfile("footwear").links.some((link) => link.href === "/size-runs")).toBe(true);
  });

  it("never links a shop into another trade's screens", () => {
    for (const businessType of BUSINESS_TYPES) {
      for (const link of getShopPurchasesProfile(businessType).links) {
        const owner = verticalForPath(link.href);
        expect(owner ?? packForBusinessType(businessType).id, `${businessType}: ${link.href}`).toBe(
          packForBusinessType(businessType).id,
        );
      }
    }
  });

  it("wires the map into the page", () => {
    expect(purchasesPage).toContain("getShopPurchasesProfile(useBusinessTypeKey())");
    expect(purchasesPage).toContain("<TradeFocusStrip");
  });
});

describe("expense categories trade fit", () => {
  it("gives every trade somewhere to file its own spending", () => {
    for (const businessType of BUSINESS_TYPES) {
      const categories = expenseCategoriesFor(businessType);
      expect(new Set(categories).size, businessType).toBe(categories.length);
      // "Misc" is the row you pick when nothing above fits, so it stays last.
      expect(categories[categories.length - 1], businessType).toBe("Misc");
    }

    // The rows that were impossible to file before: each went in as "Misc",
    // which is the same as recording no category at all.
    expect(expenseCategoriesFor("restaurant")).toContain("Kitchen Gas & LPG");
    expect(expenseCategoriesFor("manufacturing")).toContain("Power & Fuel");
    expect(expenseCategoriesFor("manufacturing")).toContain("Labour Wages");
    expect(expenseCategoriesFor("pharmacy")).toContain("Drug Licence & Fees");

    // ...and not offered to trades they mean nothing to.
    expect(expenseCategoriesFor("kirana")).not.toContain("Kitchen Gas & LPG");
    expect(expenseCategoriesFor("clothing")).not.toContain("Power & Fuel");
  });

  it("keeps a category filed under a business type the shop has left", () => {
    // Dropping it would hide the expense from the filter and blank the field
    // when the row is edited — the money was still spent.
    const options = expenseCategoryOptions("kirana", ["Kitchen Gas & LPG", "Rent", ""]);
    expect(options).toContain("Kitchen Gas & LPG");
    expect(options.filter((category) => category === "Rent")).toHaveLength(1);
    expect(options).not.toContain("");
    expect(options[options.length - 1]).toBe("Misc");
  });

  it("wires the list into the page instead of one hardcoded array", () => {
    expect(expensesPage).toContain("expenseCategoryOptions(businessType");
    expect(expensesPage).toContain("categories[0]");
    expect(expensesPage).not.toContain('const CATEGORIES = ["Rent"');
    expect(expensesPage).not.toContain('editing?.category ?? "Rent"');
  });
});
