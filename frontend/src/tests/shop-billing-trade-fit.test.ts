import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { englishTranslations, loadHindiDictionary } from "@/features/core/settings/i18n";
import { SHOP_BILLING, getShopBillingProfile } from "@/features/core/settings/shop-billing";
import { SHOP_CREDIT_WORD, SHOP_TENDER_WORD } from "@/features/core/settings/shop-credit";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const summary = read("src/features/core/billing/pages/components/BillingSummary.tsx");
const paymentPanel = read("src/features/core/billing/pages/components/BillingPaymentPanel.tsx");
const cart = read("src/features/core/billing/pages/components/BillingCart.tsx");
const openBills = read("src/features/core/billing/pages/components/OpenBillsBar.tsx");
const billingPrint = read("src/features/core/billing/pages/billing-print.ts");
const billingPage = read("src/features/core/billing/pages/BillingPage.tsx");

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];

/** Every string on the till that used to spell out one trade's word for credit. */
const CREDIT_SLOT_KEYS = [
  "billing.pay.udhar",
  "billing.pay.udharLine",
  "billing.pay.fullToUdhar",
  "billing.pay.fullWillGoToUdhar",
  "billing.pay.udharRemaining",
  "billing.summary.udhar",
  "billing.summary.namePlaceholder",
  "billing.summary.udharNeedsIdentity",
] as const;

/**
 * One till, eleven trades.
 *
 * Billing deliberately gets no guidance strip and no shortcut chips — it is a
 * counter tool whose vertical space is cart space. What it does get is the
 * trade's own word for the credit tender, because eight strings here named a
 * kirana store's at the moment of committing the sale, and both the report and
 * the customer screen had already stopped doing that.
 */
describe("billing trade fit", () => {
  it("describes the till for every registered trade", () => {
    expect(Object.keys(SHOP_BILLING).sort()).toEqual([...BUSINESS_TYPES].sort());

    for (const businessType of BUSINESS_TYPES) {
      const profile = getShopBillingProfile(businessType);
      for (const key of [profile.tenderWordKey, profile.billNounKey, profile.itemsNounKey]) {
        expect(englishTranslations[key]?.trim().length, `${businessType}: ${key}`).toBeGreaterThan(2);
      }
    }
  });

  it("takes the tender word from the same map the report and customer screen read", () => {
    // Two maps, one concept. They are allowed to differ — a report says
    // "Outstanding Patient Accounts" and a tender button says "Patient Account"
    // — but only in number, never in noun, or a shop would read two unrelated
    // words for one balance.
    for (const businessType of BUSINESS_TYPES) {
      expect(getShopBillingProfile(businessType).tenderWordKey, businessType).toBe(SHOP_TENDER_WORD[businessType]);
    }

    // Where the collective word already works in the singular, the two maps
    // point at exactly the same string rather than a near-copy of it.
    for (const businessType of ["kirana", "clothing", "electronics", "stationery", "cosmetics", "other"] as const) {
      expect(SHOP_TENDER_WORD[businessType], businessType).toBe(SHOP_CREDIT_WORD[businessType]);
    }

    expect(englishTranslations[SHOP_TENDER_WORD.restaurant]).toBe("Tab");
    expect(englishTranslations[SHOP_TENDER_WORD.pharmacy]).toBe("Patient Account");
    expect(englishTranslations[SHOP_TENDER_WORD.manufacturing]).toBe("Receivable");
    expect(englishTranslations[SHOP_TENDER_WORD.auto_parts]).toBe("Khata");
  });

  it("leaves no trade's word hardcoded in the strings the till renders", () => {
    for (const key of CREDIT_SLOT_KEYS) {
      const english = englishTranslations[key];
      expect(english, key).toContain("{credit}");
      // The word it replaced must be gone, or a café would read both.
      expect(english.toLowerCase(), key).not.toContain("udhar");
    }

    expect(englishTranslations["billing.openBills.new"]).toContain("{bill}");
    expect(englishTranslations["billing.openBills.startNew"]).toContain("{bill}");
    expect(englishTranslations["billing.cart.emptyHint"]).toContain("{items}");
  });

  it("keeps the slots on the Hindi side too", async () => {
    // A dropped slot renders the sentence with no noun at all, and Hindi is the
    // default language here — so this is the side that fails first in the shop.
    const hindi = await loadHindiDictionary();
    for (const key of CREDIT_SLOT_KEYS) {
      expect(hindi?.[key], key).toContain("{credit}");
      expect(String(hindi?.[key]).toLowerCase(), key).not.toContain("उधार");
    }
  });

  it("passes the word in at every call site", () => {
    // A slot that is never filled prints the literal "{credit}" on the counter.
    expect(paymentPanel).toContain("useShopBillingWords()");
    expect(summary).toContain("useShopBillingWords()");
    expect(cart).toContain("useShopBillingWords()");
    expect(openBills).toContain("useShopBillingWords()");

    for (const source of [summary, paymentPanel]) {
      for (const call of source.match(/t\("billing\.(?:pay|summary)\.(?:udhar\w*|namePlaceholder)"[^)]*\)/g) ?? []) {
        expect(call, call).toContain("credit: words.credit");
      }
    }
    expect(cart).toContain("items: words.items");
    expect(openBills).toContain("bill: words.bill");
  });

  it("prints the trade's word on the receipt the customer carries out", () => {
    // The receipt has no React and no t(); it is English throughout. This is the
    // copy that leaves the building, so it is the worst place to say "Udhar" to
    // a café's customer.
    expect(billingPrint).toContain("receiptCreditWordEnglish()");
    expect(billingPrint).not.toContain('return "Udhar"');
    expect(billingPrint).not.toContain('label: "Udhar"');
    expect(billingPrint).not.toContain("for udhar records");
  });

  it("keeps billing free of the strip the other shared screens carry", () => {
    // Not an oversight. The till is full-height and sets lg:overflow-hidden; a
    // guidance paragraph and a row of chips at the top would push the cart down
    // on the tablet the shop actually bills from, to save a tap the sidebar
    // already offers.
    expect(billingPage).not.toContain("TradeFocusStrip");
  });
});
