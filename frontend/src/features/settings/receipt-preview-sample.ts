import type { ReceiptShopInfo, ReceiptSnapshot } from "@/features/receipts/receipt-print";
import type { PrinterConfig } from "./printer-config";

/**
 * The sample bill behind Settings → Printer → "Bill Template Preview".
 *
 * Every receipt toggle must have a VISIBLE effect here, otherwise the preview
 * quietly lies about what will print. The sample lines therefore carry HSN
 * codes, a per-line discount, and a line note so those features render.
 *
 * Kept out of the page component so the toggle behaviour can be unit-tested
 * without pulling in the whole settings screen.
 */
export function sampleReceiptSnapshot(
  shop: Partial<ReceiptShopInfo> | null | undefined,
  cfg: PrinterConfig,
): ReceiptSnapshot {
  return {
    billNo: "PREVIEW-001",
    createdAt: new Date().toISOString(),
    billTypeLabel: "Sample receipt",
    copyLabel: cfg.customerCopy ? "Customer copy" : "Shop copy",
    customerName: "Walk-in customer",
    customerMobile: cfg.showCustomerPhone ? "9876543210" : "",
    rows: [
      { name: "Tata Salt 1kg", quantity: 2, unit: "pkt", rate: 28, total: 56, hsn: "2501" },
      { name: "Aashirvaad Atta 5kg", quantity: 1, unit: "bag", rate: 245, total: 235, lineDiscount: 10, hsn: "1101" },
      { name: "Amul Butter 100g", quantity: 3, unit: "pcs", rate: 62, total: 186, note: "no bag", hsn: "0405" },
    ],
    subtotal: 477,
    discount: cfg.showDiscount ? 7 : 0,
    total: 470,
    paid: 470,
    credit: 0,
    payments: [{ mode: "cash", amount: 470 }],
    showHsn: cfg.showHsn,
    // Sample "You saved" figure so the toggle visibly changes the preview.
    savings: cfg.showSavings ? 63 : undefined,
    gst: cfg.showGstBreakup
      ? {
          mode: "inclusive" as const,
          gst: 23.02,
          cgst: 11.51,
          sgst: 11.51,
          byRate: [
            { rate: 5, taxable: 277.14, cgst: 6.93, sgst: 6.93 },
            { rate: 12, taxable: 166.07, cgst: 9.96, sgst: 9.96 },
          ],
        }
      : null,
    shop: {
      name: shop?.name ?? "My Store",
      address: shop?.address ?? null,
      city: shop?.city ?? null,
      phone: shop?.phone ?? null,
      gstNumber: cfg.showGst ? (shop?.gstNumber ?? null) : null,
      cashierName: cfg.showCashier ? "Counter 1" : null,
    },
    footerNote: [
      cfg.footerText || "Thank you for shopping with us.",
      cfg.showReturnPolicy ? "Returns accepted as per shop policy with original bill." : "",
    ].filter(Boolean).join(" "),
  };
}
