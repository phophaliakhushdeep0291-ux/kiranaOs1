import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");
const mobileChrome = readFileSync("src/components/layout/MobileAppChrome.tsx", "utf8");
const paymentPanel = readFileSync("src/features/core/billing/pages/components/BillingPaymentPanel.tsx", "utf8");
const billingSummary = readFileSync("src/features/core/billing/pages/components/BillingSummary.tsx", "utf8");
const subscriptionBanner = readFileSync("src/features/core/subscription/components/SubscriptionStatusBanner.tsx", "utf8");
const billingTranslations = readFileSync("src/features/core/settings/translations/billing.ts", "utf8");
const shellTranslations = readFileSync("src/features/core/settings/translations/shell.ts", "utf8");

describe("cashier-first product simplification", () => {
  it("limits staff desktop and mobile navigation to counter work", () => {
    expect(layout).toContain('user?.role !== "staff"');
    expect(layout).toContain("CASHIER_NAV_PATHS");
    expect(mobileChrome).toContain("CASHIER_MORE_PATHS");
    expect(mobileChrome).toContain('userRole === "staff"');
  });

  it("keeps the three common tenders primary and discloses uncommon payment methods", () => {
    expect(paymentPanel).toContain('t("billing.pay.moreOptions")');
    expect(paymentPanel).toContain('t("billing.pay.moreOptionsHint")');
    expect(billingTranslations).toContain('"billing.pay.moreOptions": "More payment options"');
    expect(billingTranslations).toContain('"billing.pay.moreOptionsHint": "Bank, split, gift card"');
    expect(paymentPanel).toContain("showMorePaymentMethods");
  });

  it("moves promotional tools out of the default checkout path", () => {
    expect(billingSummary).toContain('t("billing.summary.moreOptions")');
    expect(billingSummary).toContain('t("billing.summary.billSavedSafely")');
    expect(billingTranslations).toContain('"billing.summary.moreOptions": "More sale options"');
    expect(billingTranslations).toContain('"billing.summary.billSavedSafely": "Bill saved safely"');
  });

  it("uses one plain-language recovery message and an owner-only detail link", () => {
    // The grace sentence now comes from the dictionary, and no longer ends by
    // promising backup "will resume after renewal" — the server keeps accepting
    // pushes until grace runs out, so it never paused. The plain words live here.
    expect(subscriptionBanner).toContain('t("chrome.subscription.graceLong")');
    expect(shellTranslations).toContain('"chrome.subscription.graceLong": "Your plan has ended. Billing keeps working');
    expect(subscriptionBanner).toContain("Owner details");
    expect(subscriptionBanner).toContain('className="inline-flex min-h-11 shrink-0');
    expect(subscriptionBanner).not.toContain("Local-only mode: old data remains viewable.");
  });
});
