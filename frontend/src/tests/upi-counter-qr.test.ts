import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildUpiPaymentUri, setPaymentConfigCache, getPaymentConfigSync } from "@/features/core/settings/payment-config";
import { englishTranslations } from "@/features/core/settings/translations/english";

/**
 * The shop's own UPI QR at the counter.
 *
 * There is no gateway in this flow: the guest's app moves the money bank-to-bank
 * and this software is never told that it did. So the link has to be right first
 * time — there is no retry, no webhook, and no way to notice it was wrong except
 * a guest at the counter who cannot pay.
 */

const params = (uri: string) => new URLSearchParams(uri.slice(uri.indexOf("?") + 1));

describe("the counter's UPI link", () => {
  it("leaves the @ in a VPA raw", () => {
    // %40 is textbook-correct URL encoding and was what shipped. Every UPI QR in
    // circulation carries the @ raw, and an app that does not decode it
    // addresses a payee who does not exist — the guest is told "invalid UPI ID".
    const uri = buildUpiPaymentUri({ upiId: "flowcafe@okhdfcbank", payeeName: "Flow Cafe", amount: 40 })!;
    expect(uri).toContain("pa=flowcafe@okhdfcbank");
    expect(uri).not.toContain("%40");
  });

  it("never sends a + where a space belongs", () => {
    // URLSearchParams writes a space as "+", and several UPI apps render that
    // literally. The payee line is the one moment a guest decides whether this
    // is really the restaurant, and "Flow+Cafe" is not reassuring.
    const uri = buildUpiPaymentUri({ upiId: "ab@ybl", payeeName: "Flow Cafe", amount: 40 })!;
    expect(uri).not.toContain("+");
    expect(params(uri).get("pn")).toBe("Flow Cafe");
  });

  it("still round-trips every parameter after the corrections", () => {
    const uri = buildUpiPaymentUri({ upiId: "flowcafe@okhdfcbank", payeeName: "Flow Cafe & Co", amount: 748.5, note: "Table 4" })!;
    const q = params(uri);
    expect(q.get("pa")).toBe("flowcafe@okhdfcbank");
    expect(q.get("pn")).toBe("Flow Cafe & Co");
    expect(q.get("am")).toBe("748.50");
    expect(q.get("cu")).toBe("INR");
    expect(q.get("tn")).toBe("Table 4");
    // An ampersand in the name must stay encoded, or it ends the parameter early
    // and hands the rest of the link to whatever followed.
    expect(uri).toContain("%26");
  });

  it("refuses an amount or an ID it cannot honour", () => {
    expect(buildUpiPaymentUri({ upiId: "not-a-vpa", payeeName: "X", amount: 40 })).toBeNull();
    expect(buildUpiPaymentUri({ upiId: "ab@ybl", payeeName: "X", amount: 0 })).toBeNull();
    expect(buildUpiPaymentUri({ upiId: "ab@ybl", payeeName: "X", amount: -5 })).toBeNull();
  });

  it("names the shop as payee when no account holder is set", () => {
    // A UPI app showing a blank or vendor-branded payee is one a guest should
    // hesitate over.
    setPaymentConfigCache({ upi: "flowcafe@okhdfcbank" }, "Flow Cafe");
    expect(getPaymentConfigSync().payeeName).toBe("Flow Cafe");
    setPaymentConfigCache({ upi: "flowcafe@okhdfcbank", holder: "Flow Cafe Pvt Ltd" }, "Flow Cafe");
    expect(getPaymentConfigSync().payeeName).toBe("Flow Cafe Pvt Ltd");
  });
});

describe("what the counter records", () => {
  const panel = readFileSync("src/features/core/billing/pages/components/BillingPaymentPanel.tsx", "utf8");
  const page = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
  const profile = readFileSync("src/features/core/settings/pages/StoreProfilePage.tsx", "utf8");

  it("asks for the UTR beside the QR it belongs to", () => {
    expect(panel).toContain('t("billing.pay.upi.utrLabel")');
    expect(englishTranslations["billing.pay.upi.utrHelp"]).toMatch(/bank statement/i);
  });

  it("sends the UTR only when no gateway confirmed the payment", () => {
    // A verified intent and a typed reference must never ride on one payment, or
    // the server holds a provider reference it did not get from a provider.
    expect(page).toContain("!retailPaymentVerified && manualUpiReference ? { upiReference: manualUpiReference }");
  });

  it("preserves the UTR through crash recovery and held-bill switching, then clears it for the next sale", () => {
    expect(page).toContain("upiReference, allowAdvancePayment");
    expect(page).toContain("setUpiReference(normalizeUpiReference(draft.upiReference))");
    expect(page).toContain("setUpiReference(normalizeUpiReference(bill.upiReference))");
    expect(page).toMatch(/function resetCurrentBill\(\)[\s\S]*?setUpiReference\(""\)/);
  });

  it("blocks a malformed partial UTR instead of failing after the bill is submitted", () => {
    expect(page).toContain("manualUpiReference.length > 0 && manualUpiReference.length < 6");
    expect(englishTranslations["billing.pay.upi.utrInvalid"]).toMatch(/at least 6/i);
  });

  it("tells the owner about a bad UPI ID in Settings, not at the counter", () => {
    expect(profile).toContain("UPI_ID_PATTERN");
    expect(englishTranslations["settings.store.upiIdInvalid"]).toMatch(/name@bank/i);
  });
});
