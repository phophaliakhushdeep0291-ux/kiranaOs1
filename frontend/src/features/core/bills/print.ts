import type { Bill } from "@/types/api";
import { buildReceiptHtml, openConfiguredReceiptWindow, type ReceiptPaymentLine, type ReceiptShopInfo, type ReceiptSnapshot } from "@/features/core/receipts/receipt-print";
import { dedupePaymentsForDisplay } from "@/features/core/sync/bill-reconciliation";
import { getPrinterConfigSync } from "@/features/core/settings/printer-config";
import { computeGstBreakdown, type GstMode } from "@/lib/gst";
import { gstStateCode } from "@/lib/gstin";
import { roundMoney } from "@/lib/money";
import { billItemAddonSummary } from "@/features/core/bills/bill-item-options";

export interface PrintableBillRow {
  name: string;
  quantity: number;
  unit?: string | null;
  rate: number;
  total: number;
  lineDiscount?: number;
  gstRate?: number;
  hsn?: string | null;
  note?: string | null;
}

export interface PrintableBillSnapshot {
  billNo: string;
  createdAt?: string;
  customerName?: string | null;
  customerMobile?: string | null;
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
  buyerAddress?: string | null;
  rows: PrintableBillRow[];
  subtotal: number;
  discount: number;
  /** Signed nearest-rupee round-off derived from the stored totals; 0 when none. */
  roundOff?: number;
  total: number;
  paid: number;
  credit: number;
  payments?: ReceiptPaymentLine[];
  status?: string;
  billType?: string | null;
  gstMode?: GstMode;
  shop?: ReceiptShopInfo | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readNumber(value: unknown, fallback = 0) {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function billTypeLabel(value: unknown) {
  const type = String(value ?? "").toLowerCase();
  if (type === "estimate") return "Estimate";
  if (type === "udhar_entry") return "Udhar receipt";
  if (type === "gst_invoice") return "GST invoice";
  return "Sale receipt";
}

function paymentMode(value: unknown) {
  const mode = String(value ?? "").trim();
  return mode.length > 0 ? mode : "payment";
}

function toReceiptSnapshot(snapshot: PrintableBillSnapshot): ReceiptSnapshot {
  // Mirror the live-billing receipt: show the shop header and honour the Printer/Receipt
  // settings (show-GSTIN toggle + configured footer) so a reprint matches the original.
  const printer = getPrinterConfigSync();
  const shop = snapshot.shop && !printer.showGst ? { ...snapshot.shop, gstNumber: null } : snapshot.shop;
  const breakdown = computeGstBreakdown(
    snapshot.rows.map((row) => ({ price: row.rate, quantity: row.quantity, gstRate: row.gstRate ?? 0, lineDiscount: row.lineDiscount ?? 0 })),
    snapshot.gstMode ?? "inclusive",
    { sellerStateCode: gstStateCode(snapshot.shop?.gstNumber), buyerStateCode: snapshot.buyerStateCode },
  );
  return {
    billNo: snapshot.billNo,
    createdAt: snapshot.createdAt,
    billTypeLabel: billTypeLabel(snapshot.billType),
    copyLabel: "Duplicate copy",
    customerName: snapshot.customerName ?? "Walk-in",
    customerMobile: snapshot.customerMobile,
    buyerGstin: snapshot.buyerGstin,
    buyerStateCode: snapshot.buyerStateCode,
    buyerAddress: snapshot.buyerAddress,
    rows: snapshot.rows,
    subtotal: snapshot.subtotal,
    discount: snapshot.discount,
    total: snapshot.total,
    paid: snapshot.paid,
    credit: snapshot.credit,
    payments: snapshot.payments,
    status: snapshot.status,
    shop,
    gst: printer.showGstBreakup && breakdown.gst > 0
      ? { mode: breakdown.mode, gst: breakdown.gst, cgst: breakdown.cgst, sgst: breakdown.sgst, igst: breakdown.igst, supplyType: breakdown.supplyType, byRate: breakdown.byRate.map(({ rate, taxable, cgst, sgst, igst }) => ({ rate, taxable, cgst, sgst, igst })) }
      : null,
    showHsn: printer.showHsn,
    footerNote: snapshot.credit > 0
      ? "Please keep this receipt for udhar records."
      : (printer.footerText || "Thank you for shopping with us."),
  };
}

export function buildPrintableBillSnapshot(bill: Bill, itemRows: unknown[] = [], paymentRows: unknown[] = [], shop?: ReceiptShopInfo | null): PrintableBillSnapshot {
  const embeddedItems = Array.isArray(bill.items) ? bill.items : [];
  const sourceItems = itemRows.length > 0 ? itemRows : embeddedItems;
  const rows = sourceItems.map((raw) => {
    const item = asRecord(raw);
    const quantity = readNumber(item.quantity, 0);
    const rate = readNumber(item.ratePerRateUnit ?? item.rate_per_rate_unit ?? item.rate, 0);
    const total = readNumber(item.line_total ?? item.lineTotal, quantity * rate);
    return {
      name: String(item.name ?? item.productName ?? "Item"),
      quantity,
      unit: typeof item.enteredUnit === "string" ? item.enteredUnit : typeof item.entered_unit === "string" ? item.entered_unit : "pcs",
      rate,
      total,
      lineDiscount: readNumber(item.lineDiscount ?? item.line_discount, Math.max(0, rate * quantity - total)),
      gstRate: readNumber(item.gstRate ?? item.gst_rate, 0),
      hsn: typeof item.hsn === "string" ? item.hsn : null,
      note: [
        billItemAddonSummary(item),
        typeof item.note === "string" ? item.note : "",
      ].filter(Boolean).join(" · ") || null,
    };
  });

  const embeddedPayments = Array.isArray(bill.payments) ? bill.payments : [];
  const payments = dedupePaymentsForDisplay((paymentRows.length > 0 ? paymentRows : embeddedPayments).map((raw) => asRecord(raw)));
  const paidFromRows = payments.reduce<number>((sum, raw) => {
    const payment = asRecord(raw);
    return String(payment.mode ?? "").toLowerCase() === "credit" ? sum : sum + readNumber(payment.amount, 0);
  }, 0);
  const total = readNumber(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount, 0);
  const explicitCredit = readNumber(bill.creditAmount, Number.NaN);
  const billLevelPaid = Number.isFinite(explicitCredit)
    ? Math.max(0, total - explicitCredit)
    : readNumber(bill.paidAmount ?? bill.buyerPaidAmount, 0);
  const paid = payments.length > 0 ? paidFromRows : billLevelPaid;
  const credit = readNumber(bill.creditAmount, Math.max(0, total - paid));
  const paymentLines: ReceiptPaymentLine[] = payments
    .map((raw) => {
      const payment = asRecord(raw);
      return { mode: paymentMode(payment.mode), amount: readNumber(payment.amount, 0) };
    })
    .filter((payment) => payment.amount > 0);

  if (paymentLines.length === 0 && paid > 0) paymentLines.push({ mode: "paid", label: "Paid", amount: paid });
  if (credit > 0 && !paymentLines.some((payment) => payment.mode.toLowerCase() === "credit")) paymentLines.push({ mode: "credit", label: "Udhar", amount: credit });

  // Recover the nearest-rupee round-off from the stored figures so a reprint shows the
  // same "Round off" line the point-of-sale receipt did. The subtotal fallback above makes
  // this exactly 0 when subtotal is missing; a value ≥ ₹1 would be a data artifact, not a
  // rounding, so it is suppressed.
  const subtotal = readNumber(bill.subtotal, total + readNumber(bill.discount, 0));
  const gstMode = bill.gstMode ?? "inclusive";
  const rawExpected = gstMode === "exclusive"
    ? subtotal - readNumber(bill.discount, 0) + readNumber(bill.gst, 0)
    : subtotal - readNumber(bill.discount, 0);
  const derivedRoundOff = roundMoney(total - rawExpected);
  const roundOff = Math.abs(derivedRoundOff) > 0 && Math.abs(derivedRoundOff) < 1 ? derivedRoundOff : 0;

  return {
    billNo: bill.billNumber ?? bill.billNo ?? bill.id,
    createdAt: bill.businessDate ?? bill.business_date ?? bill.createdAt,
    customerName: bill.customerName ?? "Walk-in",
    customerMobile: bill.customerMobile ?? null,
    buyerGstin: bill.buyerGstin ?? null,
    buyerStateCode: bill.buyerStateCode ?? null,
    buyerAddress: bill.buyerAddress ?? null,
    rows,
    subtotal,
    discount: readNumber(bill.discount, 0),
    roundOff,
    total,
    paid,
    credit,
    payments: paymentLines,
    status: bill.status,
    billType: bill.billType,
    gstMode: bill.gstMode ?? "inclusive",
    shop: shop ?? null,
  };
}

export function buildBillPrintHtml(snapshot: PrintableBillSnapshot) {
  return buildReceiptHtml(toReceiptSnapshot(snapshot));
}

export function openPrintableBill(snapshot: PrintableBillSnapshot) {
  return openConfiguredReceiptWindow(toReceiptSnapshot(snapshot), { autoPrint: true, printDelayMs: 300 });
}
