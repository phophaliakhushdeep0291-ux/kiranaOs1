import type { Bill } from "@/types/api";
import { buildReceiptHtml, openReceiptWindow, type ReceiptPaymentLine, type ReceiptSnapshot } from "@/features/receipts/receipt-print";

export interface PrintableBillRow {
  name: string;
  quantity: number;
  unit?: string | null;
  rate: number;
  total: number;
}

export interface PrintableBillSnapshot {
  billNo: string;
  createdAt?: string;
  customerName?: string | null;
  customerMobile?: string | null;
  rows: PrintableBillRow[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  credit: number;
  payments?: ReceiptPaymentLine[];
  status?: string;
  billType?: string | null;
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
  return {
    billNo: snapshot.billNo,
    createdAt: snapshot.createdAt,
    billTypeLabel: billTypeLabel(snapshot.billType),
    copyLabel: "Duplicate copy",
    customerName: snapshot.customerName ?? "Walk-in",
    customerMobile: snapshot.customerMobile,
    rows: snapshot.rows,
    subtotal: snapshot.subtotal,
    discount: snapshot.discount,
    total: snapshot.total,
    paid: snapshot.paid,
    credit: snapshot.credit,
    payments: snapshot.payments,
    status: snapshot.status,
    footerNote: snapshot.credit > 0 ? "Please keep this receipt for udhar records." : "Thank you for shopping with us.",
  };
}

export function buildPrintableBillSnapshot(bill: Bill, itemRows: unknown[] = [], paymentRows: unknown[] = []): PrintableBillSnapshot {
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
    };
  });

  const embeddedPayments = Array.isArray(bill.payments) ? bill.payments : [];
  const payments = paymentRows.length > 0 ? paymentRows : embeddedPayments;
  const paidFromRows = payments.reduce<number>((sum, raw) => {
    const payment = asRecord(raw);
    return String(payment.mode ?? "").toLowerCase() === "credit" ? sum : sum + readNumber(payment.amount, 0);
  }, 0);
  const paid = Math.max(readNumber(bill.paidAmount ?? bill.buyerPaidAmount, 0), paidFromRows);
  const total = readNumber(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount, 0);
  const credit = readNumber(bill.creditAmount, Math.max(0, total - paid));
  const paymentLines: ReceiptPaymentLine[] = payments
    .map((raw) => {
      const payment = asRecord(raw);
      return { mode: paymentMode(payment.mode), amount: readNumber(payment.amount, 0) };
    })
    .filter((payment) => payment.amount > 0);

  if (paymentLines.length === 0 && paid > 0) paymentLines.push({ mode: "paid", label: "Paid", amount: paid });
  if (credit > 0 && !paymentLines.some((payment) => payment.mode.toLowerCase() === "credit")) paymentLines.push({ mode: "credit", label: "Udhar", amount: credit });

  return {
    billNo: bill.billNumber ?? bill.billNo ?? bill.id,
    createdAt: bill.createdAt,
    customerName: bill.customerName ?? "Walk-in",
    customerMobile: bill.customerMobile ?? null,
    rows,
    subtotal: readNumber(bill.subtotal, total + readNumber(bill.discount, 0)),
    discount: readNumber(bill.discount, 0),
    total,
    paid,
    credit,
    payments: paymentLines,
    status: bill.status,
    billType: bill.billType,
  };
}

export function buildBillPrintHtml(snapshot: PrintableBillSnapshot) {
  return buildReceiptHtml(toReceiptSnapshot(snapshot));
}

export function openPrintableBill(snapshot: PrintableBillSnapshot) {
  return openReceiptWindow(toReceiptSnapshot(snapshot), { autoPrint: true, printDelayMs: 300 });
}
