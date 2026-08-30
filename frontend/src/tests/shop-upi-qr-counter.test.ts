import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { englishTranslations } from "@/features/core/settings/translations/english";

/**
 * The shop's own UPI QR, for a counter with no payment gateway.
 *
 * Money moves between the guest's bank and the shop's; this software builds a
 * link and is never told the payment happened. Two decisions follow from that,
 * and both are easy to undo by accident later.
 */

const dialog = readFileSync("src/features/core/billing/pages/components/ShopUpiQrDialog.tsx", "utf8");
const panel = readFileSync("src/features/core/billing/pages/components/BillingPaymentPanel.tsx", "utf8");
const billing = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

describe("collecting on the shop's own UPI QR", () => {
  it("tells the cashier to check their own bank, not the guest's screen", () => {
    // The oldest scam at an Indian counter is a screenshot of a payment from
    // another day. This warning is the feature; losing it makes the dialog a
    // worse version of the gateway one rather than an honest different one.
    expect(dialog).toContain('t("billing.upiQr.verifyYourself")');
    expect(englishTranslations["billing.upiQr.verifyYourself"]).toMatch(/your own bank/i);
    expect(englishTranslations["billing.upiQr.verifyYourself"]).toMatch(/another day/i);
  });

  it("never polls for a confirmation that cannot arrive", () => {
    // The gateway dialog polls because a provider answers. Nothing answers here,
    // so a spinner waiting on one would be a lie told in the UI.
    // Asserted against code, not prose — the comment above this component says
    // "nothing to poll", and a word-match would catch that instead.
    expect(dialog).not.toMatch(/setInterval\s*\(/);
    expect(dialog).not.toContain("getRetailPaymentQrStatus");
  });

  it("offers its button only where there is no gateway", () => {
    // Two buttons that both say UPI is how a cashier picks the wrong one — and
    // only one of them can actually confirm anything.
    expect(panel).toContain("{!retailPaymentConfigured ? <button");
    expect(panel).toContain('onClick={onShowShopUpiQr}');
  });

  it("sends the UTR only when no gateway payment was verified", () => {
    // A verified intent and a typed reference must never both ride on one
    // payment: the server would then have a provider reference it did not get
    // from the provider.
    expect(billing).toContain("!retailPaymentVerified && shopUpiReference ? { upiReference: shopUpiReference }");
  });

  it("says in the confirmation that a person confirmed it", () => {
    expect(englishTranslations["billing.upiQr.recordedDetail"]).toMatch(/you confirmed yourself/i);
  });
});
