import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { billingEn } from "@/features/core/settings/translations/billing";
import type { RetailQrCheckout } from "@/features/core/billing/retail-payment";

vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: keyof typeof billingEn) => billingEn[key] }) }));
// Render the real payment content without the portal (SSR does not mount portals).
vi.mock("@/components/ui/dialog", () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement("div", null, children);
  return { Dialog: wrapper, DialogContent: wrapper, DialogHeader: wrapper,
    DialogFooter: wrapper, DialogTitle: wrapper, DialogDescription: wrapper };
});
vi.mock("@/features/core/billing/retail-payment", () => ({
  cancelRetailPaymentQr: vi.fn(), getRetailPaymentQrBitmap: vi.fn(), getRetailPaymentQrStatus: vi.fn(),
}));
vi.mock("@/features/core/hardware/local-hardware-bridge", () => ({ checkHardwareBridge: vi.fn(), printQrSlipViaHardwareBridge: vi.fn() }));
vi.mock("@/features/core/settings/printer-config", () => ({ getPrinterConfigSync: vi.fn() }));
import { RetailDynamicQrDialog } from "@/features/core/billing/pages/components/RetailDynamicQrDialog";

const now = new Date("2026-09-09T12:00:00.000Z");
function render(status: RetailQrCheckout["status"], expiresAt = "2026-09-09T12:05:00.000Z", imageUrl = "https://rzp.io/i/test-qr") {
  vi.spyOn(Date, "now").mockReturnValue(now.getTime());
  const checkout: RetailQrCheckout = { intentId: "qr-test", mode: "dynamic_qr", provider: "razorpay", status,
    amountPaise: 12345, currency: "INR", expiresAt, imageUrl, location: { id: "main", name: "Main store" } };
  return renderToStaticMarkup(createElement(RetailDynamicQrDialog, { checkout, onClose: () => {}, onConfirmed: () => {} }));
}
afterEach(() => vi.restoreAllMocks());

describe("dynamic QR payment state presentation", () => {
  it("shows a live QR only while pending inside its scan window", () => {
    const html = render("pending");
    expect(html).toContain('src="https://rzp.io/i/test-qr"');
    expect(html).toContain("Waiting for bank confirmation");
    expect(html).toContain("5:00");
  });
  it("never invites scanning or cancellation after provider confirmation", () => {
    const html = render("confirmed");
    expect(html).toContain("Payment confirmed by provider");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Waiting for bank confirmation");
    expect(html).not.toContain("Cancel payment QR");
  });
  it.each(["failed", "expired", "cancelled"] as const)("does not ask for a second payment after %s", (status) => {
    const html = render(status);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Waiting for bank confirmation");
    expect(html).toContain("before collecting again");
  });
  it.each(["2026-09-09T11:59:59.000Z", "not-a-date"])("hides an elapsed or invalid scan window without inventing failed settlement: %s", (expiry) => {
    const html = render("pending", expiry);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("NaN");
    expect(html).toContain("Payment confirmation is still being checked");
    expect(html).not.toContain("Payment confirmed by provider");
  });
  it("never renders an untrusted QR image URL", () => {
    expect(render("pending", undefined, "https://example.invalid/qr")).not.toContain("<img");
  });
});
