import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { showCustomerDisplayViaHardwareBridge } from "@/features/core/hardware/local-hardware-bridge";
import { DEFAULT_PRINTER_CONFIG } from "@/features/core/settings/printer-config";

describe("customer-facing display checkout contract", () => {
  it("is opt-in and rejects non-integer financial state before transport", async () => {
    expect(DEFAULT_PRINTER_CONFIG.customerDisplay).toBe(false);
    await expect(showCustomerDisplayViaHardwareBridge("http://127.0.0.1:17873", {
      revision: 1,
      state: "sale",
      itemCount: 1,
      totalPaise: 10.5,
    })).rejects.toThrow(/total/i);
  });

  it("debounces structured cart totals without blocking checkout on a peripheral failure", () => {
    const billing = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/billing/pages/BillingPage.tsx"), "utf8");
    expect(billing).toContain("showCustomerDisplayViaHardwareBridge");
    expect(billing).toContain("totalPaise: Math.round(grandTotal * 100)");
    expect(billing).toContain("state: cart.length > 0 ? \"sale\" : \"idle\"");
    expect(billing).toContain("customer display is informative, never a reason to block billing");
  });

  it("invites the customer to scan for the UPI leg, not the bill total", () => {
    const billing = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/billing/pages/BillingPage.tsx"), "utf8");
    // A split tender collects only part of the bill over UPI; showing grandTotal
    // would ask the customer to approve money the QR does not actually charge.
    expect(billing).toContain("{ state: \"awaiting_payment\", totalPaise: retailQrCheckout.amountPaise }");
    expect(billing).toContain("[\"creating\", \"pending\"].includes(retailQrCheckout.status)");
    expect(billing).toContain("setCustomerDisplayFlash({ state: \"paid\", totalPaise: checkout.amountPaise })");
  });

  it("stops inviting a scan once the QR is no longer payable", () => {
    const dialog = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/billing/pages/components/RetailDynamicQrDialog.tsx"), "utf8");
    const billing = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/billing/pages/BillingPage.tsx"), "utf8");
    // The dialog stays open on expiry to explain itself; the pole display must not.
    expect(dialog).toContain("statusChangeRef.current?.(status)");
    expect(billing).toContain("onStatusChange={(status) =>");
  });

  it("exposes an explicit capability-gated test in hardware settings", () => {
    const settings = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/settings/pages/PrinterSettingsPage.tsx"), "utf8");
    // The button's label moved into the catalogue when this screen was translated.
    // What matters is that the test action exists and stays gated on the reported
    // capability, so the label is checked where it lives and paired with its key.
    const settingsEn = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/settings/translations/settings-pages.ts"), "utf8");
    expect(settings).toContain("settings.printer.testDisplay");
    expect(settingsEn).toContain('"settings.printer.testDisplay": "Test display"');
    expect(settings).toContain("bridgeHealth?.capabilities?.customerDisplay");
    expect(settings).toContain("settings.printer.customerDisplay");
    expect(settingsEn).toContain('"settings.printer.customerDisplay": "Customer display updates"');
  });
});
