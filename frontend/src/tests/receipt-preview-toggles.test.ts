import { describe, expect, it } from "vitest";
import { sampleReceiptSnapshot } from "@/features/settings/receipt-preview-sample";
import { buildReceiptHtml } from "@/features/receipts/receipt-print";
import { DEFAULT_PRINTER_CONFIG, type PrinterConfig } from "@/features/settings/printer-config";

const SHOP = { name: "Test Kirana", address: "1 Main Rd", city: "Indore", phone: "9876500000", gstNumber: "22AAAAA0000A1Z5" };

function html(overrides: Partial<PrinterConfig> = {}) {
  const cfg: PrinterConfig = { ...DEFAULT_PRINTER_CONFIG, ...overrides };
  return buildReceiptHtml(sampleReceiptSnapshot(SHOP, cfg), { paperSize: cfg.paperSize, copies: 1 });
}

/**
 * Each printer toggle must visibly change the preview — otherwise the preview
 * silently misrepresents what will actually print.
 */
describe("receipt preview honours every toggle", () => {
  it("HSN codes appear only when showHsn is on", () => {
    expect(html({ showHsn: true })).toContain("HSN: 2501");
    expect(html({ showHsn: false })).not.toContain("HSN: 2501");
  });

  it("GST breakup section appears only when showGstBreakup is on", () => {
    expect(html({ showGstBreakup: true })).toContain("GST Breakup");
    expect(html({ showGstBreakup: false })).not.toContain("GST Breakup");
  });

  it("return policy line appears only when showReturnPolicy is on", () => {
    expect(html({ showReturnPolicy: true })).toContain("Returns accepted as per shop policy");
    expect(html({ showReturnPolicy: false })).not.toContain("Returns accepted as per shop policy");
  });

  it('"You saved" line appears only when showSavings is on', () => {
    expect(html({ showSavings: true })).toContain("You saved");
    expect(html({ showSavings: false })).not.toContain("You saved");
  });

  it("struck-through MRP appears only when showMrp is on", () => {
    expect(html({ showMrp: true })).toContain("MRP <s>");
    expect(html({ showMrp: false })).not.toContain("MRP <s>");
  });

  it("previous and resulting udhar appear only when showPreviousUdhar is on", () => {
    expect(html({ showPreviousUdhar: true })).toContain("Previous udhar");
    expect(html({ showPreviousUdhar: true })).toContain("Total udhar after bill");
    expect(html({ showPreviousUdhar: false })).not.toContain("Previous udhar");
  });

  it("GSTIN is hidden when showGst is off", () => {
    expect(html({ showGst: true })).toContain("22AAAAA0000A1Z5");
    expect(html({ showGst: false })).not.toContain("22AAAAA0000A1Z5");
  });

  it("customer phone is hidden when showCustomerPhone is off", () => {
    expect(html({ showCustomerPhone: true })).toContain("9876543210");
    expect(html({ showCustomerPhone: false })).not.toContain("9876543210");
  });

  it("cashier name is hidden when showCashier is off", () => {
    expect(html({ showCashier: true })).toContain("Counter 1");
    expect(html({ showCashier: false })).not.toContain("Counter 1");
  });

  it("bill discount is zeroed when showDiscount is off", () => {
    expect(sampleReceiptSnapshot(SHOP, { ...DEFAULT_PRINTER_CONFIG, showDiscount: true }).discount).toBe(7);
    expect(sampleReceiptSnapshot(SHOP, { ...DEFAULT_PRINTER_CONFIG, showDiscount: false }).discount).toBe(0);
  });

  it("copy label follows the customer-copy toggle", () => {
    expect(html({ customerCopy: true })).toContain("Customer copy");
    expect(html({ customerCopy: false })).toContain("Shop copy");
  });

  it("custom footer text is rendered", () => {
    expect(html({ footerText: "Visit again ji" })).toContain("Visit again ji");
  });

  it("shows the line discount and line note so those features are previewable", () => {
    const out = html();
    expect(out).toContain("Less discount");
    expect(out).toContain("no bag");
  });
});
