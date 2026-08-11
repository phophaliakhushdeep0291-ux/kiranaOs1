import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { printQrSlipViaHardwareBridge } from "@/features/core/hardware/local-hardware-bridge";

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

  it("prints the provider's own QR through the paired bridge, never a locally built one", () => {
    // A QR we generated ourselves would collect into a VPA with no intent
    // binding, so the printable grid must come from the provider image.
    expect(dialog).toContain("getRetailPaymentQrBitmap(checkout.intentId)");
    expect(dialog).toContain("printQrSlipViaHardwareBridge");
    expect(api).toContain("/qr-bitmap");
    // Only a paired local bridge can reach the counter printer.
    expect(dialog).toContain('getPrinterConfigSync().connection === "bridge"');
    expect(dialog).toContain("canPrintSlip ?");
  });

  it("refuses a malformed payment QR before it can reach the printer", async () => {
    const modules = Buffer.alloc(3 * 21).toString("base64");
    await expect(printQrSlipViaHardwareBridge("http://127.0.0.1:17873", { moduleCount: 24, modules, amountPaise: 100, paperSize: "80mm" }))
      .rejects.toThrow(/size/i);
    await expect(printQrSlipViaHardwareBridge("http://127.0.0.1:17873", { moduleCount: 21, modules, amountPaise: 0, paperSize: "80mm" }))
      .rejects.toThrow(/amount/i);
    await expect(printQrSlipViaHardwareBridge("http://127.0.0.1:17873", { moduleCount: 21, modules, amountPaise: 12.5, paperSize: "80mm" }))
      .rejects.toThrow(/amount/i);
  });
});
