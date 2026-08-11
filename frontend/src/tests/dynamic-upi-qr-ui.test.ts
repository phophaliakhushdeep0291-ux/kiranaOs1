import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("provider-confirmed dynamic UPI QR checkout", () => {
  const api = fs.readFileSync("src/features/core/billing/retail-payment.ts", "utf8");
  const page = fs.readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
  const panel = fs.readFileSync("src/features/core/billing/pages/components/BillingPaymentPanel.tsx", "utf8");
  const dialog = fs.readFileSync("src/features/core/billing/pages/components/RetailDynamicQrDialog.tsx", "utf8");

  it("creates, polls and cancels the provider QR through tenant-authenticated APIs", () => {
    expect(api).toContain('mode: "dynamic_qr"');
    expect(api).toContain("/status");
    expect(api).toContain("/cancel");
    expect(dialog).toContain("getRetailPaymentQrStatus");
    expect(dialog).toContain("cancelRetailPaymentQr");
  });

  it("does not show the operator-only static QR when provider dynamic QR is enabled", () => {
    expect(panel).toContain("showUpiQr && !retailPaymentDynamicQr");
    expect(page).toContain("retailPaymentReadiness.data?.dynamicQrEnabled");
    expect(page).toContain("setRetailQrCheckout(await createRetailPaymentQr(upiTenderPaise))");
  });

  it("keeps the bill locked until a provider-confirmed status is returned", () => {
    expect(dialog).toContain('next.status === "confirmed"');
    expect(dialog).toContain("onConfirmed");
    expect(dialog).toContain('t("billing.pay.dynamicQr.waitingHelp")');
    expect(page).toContain("setVerifiedRetailPayment({ intentId: checkout.intentId");
  });
});
