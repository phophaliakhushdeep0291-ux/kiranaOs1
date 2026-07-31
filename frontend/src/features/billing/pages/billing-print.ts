import { BillInputBillType, BillPaymentMode } from "@/lib/api/client";
import {
  buildReceiptHtml,
  writeReceiptErrorWindow,
  writeReceiptPendingWindow,
  writeConfiguredReceiptWindow,
  type ReceiptPaymentLine,
  type ReceiptSnapshot,
  type ReceiptWindowOptions,
} from "@/features/receipts/receipt-print";
import { getPrinterConfigSync } from "@/features/settings/printer-config";
import { getTaxConfigSync } from "@/features/settings/tax-config";
import { computeGstBreakdown } from "@/lib/gst";
import { gstStateCode } from "@/lib/gstin";
import { cartItemLineDiscount, cartItemNet, computeBillSavings } from "./billing-calculations";
import type { PrintableBill } from "./billing-types";

function billTypeLabel(type: PrintableBill["billType"]) {
  if (type === BillInputBillType.estimate) return "Estimate";
  if (type === BillInputBillType.udhar_entry) return "Udhar receipt";
  if (type === BillInputBillType.gst_invoice) return "GST invoice";
  return "Sale receipt";
}

function paymentModeLabel(mode: string) {
  if (mode === BillPaymentMode.cash) return "Cash";
  if (mode === BillPaymentMode.upi) return "UPI";
  if (mode === BillPaymentMode.credit) return "Udhar";
  return mode;
}

function fallbackPaymentLines(bill: PrintableBill): ReceiptPaymentLine[] {
  return [
    ...(bill.paid > 0 ? [{ mode: String(bill.paymentMode), label: paymentModeLabel(String(bill.paymentMode)), amount: bill.paid }] : []),
    ...(bill.credit > 0 ? [{ mode: BillPaymentMode.credit, label: "Udhar", amount: bill.credit }] : []),
  ];
}

export function buildBillingReceiptSnapshot(bill: PrintableBill): ReceiptSnapshot {
  const printer = getPrinterConfigSync();
  // Respect the "Show GSTIN on receipt" toggle by stripping the number when off.
  const shop = bill.shop && !printer.showGst ? { ...bill.shop, gstNumber: null } : bill.shop;
  // CGST/SGST breakup for the receipt — same engine as the billing totals.
  const breakdown = computeGstBreakdown(
    bill.items.map((item) => ({ price: item.rate, quantity: item.quantity, gstRate: item.product.gstRate ?? 0, lineDiscount: cartItemLineDiscount(item) })),
    getTaxConfigSync().mode,
    { sellerStateCode: gstStateCode(bill.shop?.gstNumber), buyerStateCode: bill.buyerStateCode },
  );
  return {
    billNo: bill.billNo,
    createdAt: bill.createdAt,
    billTypeLabel: billTypeLabel(bill.billType),
    copyLabel: bill.copyLabel ?? "Original customer copy",
    customerName: bill.customerName,
    customerMobile: bill.customerMobile,
    buyerGstin: bill.buyerGstin,
    buyerStateCode: bill.buyerStateCode,
    buyerAddress: bill.buyerAddress,
    rows: bill.items.map((item) => ({
      name: item.product.name,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.rate,
      total: cartItemNet(item),
      lineDiscount: cartItemLineDiscount(item),
      note: item.note ?? null,
      mrp: item.product.mrp ?? null,
      hsn: item.product.hsn ?? null,
    })),
    subtotal: bill.subtotal,
    discount: printer.showDiscount ? bill.discount : 0,
    roundOff: bill.roundOff ?? 0,
    total: bill.total,
    paid: bill.paid,
    credit: bill.credit,
    payments: bill.payments?.length ? bill.payments : fallbackPaymentLines(bill),
    shop,
    gst: printer.showGstBreakup && breakdown.gst > 0
      ? { mode: breakdown.mode, gst: breakdown.gst, cgst: breakdown.cgst, sgst: breakdown.sgst, igst: breakdown.igst, supplyType: breakdown.supplyType, byRate: breakdown.byRate.map(({ rate, taxable, cgst, sgst, igst }) => ({ rate, taxable, cgst, sgst, igst })) }
      : null,
    showHsn: printer.showHsn,
    showMrp: printer.showMrp,
    // "You saved ₹X" — MRP gaps + line/bill discounts, when the toggle is on.
    savings: printer.showSavings ? computeBillSavings(bill.items, bill.discount) : undefined,
    // Udhar bills keep their record-keeping note; everything else uses the
    // shop's configured receipt footer (falling back to the friendly default).
    footerNote: [
      bill.credit > 0 ? "Please keep this receipt for udhar records." : (printer.footerText || "Thank you for shopping with us."),
      printer.showReturnPolicy ? "Returns accepted as per shop policy with original bill." : "",
    ].filter(Boolean).join(" "),
  };
}

export function buildBillingReceiptHtml(bill: PrintableBill) {
  return buildReceiptHtml(buildBillingReceiptSnapshot(bill));
}

export function writeBillingReceiptWindow(popup: Window, bill: PrintableBill, options: ReceiptWindowOptions = {}) {
  const printer = getPrinterConfigSync();
  // Saved printer config drives paper size + copies; the caller still decides
  // auto-print (the after-save flow already gates on the auto-print toggle).
  writeConfiguredReceiptWindow(popup, buildBillingReceiptSnapshot(bill), {
    paperSize: printer.paperSize,
    copies: printer.copies,
    ...options,
  });
}

export function writeBillingReceiptPendingWindow(popup: Window, bill: PrintableBill) {
  writeReceiptPendingWindow(popup, buildBillingReceiptSnapshot(bill));
}

export function writeBillingReceiptErrorWindow(popup: Window, message: string) {
  writeReceiptErrorWindow(popup, message);
}
