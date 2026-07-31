import { getPrinterConfigSync } from "@/features/settings/printer-config";
import { printHtmlViaHardwareBridge } from "@/features/hardware/local-hardware-bridge";

export interface ReceiptShopInfo {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  gstNumber?: string | null;
  cashierName?: string | null;
}

export interface ReceiptLine {
  name: string;
  quantity: number;
  unit?: string | null;
  rate: number;
  /** Net amount after the line's own discount. */
  total: number;
  /** Flat rupee discount applied to this line (shown under the item name). */
  lineDiscount?: number;
  /** Free-text line note ("no bag") — shown under the item name. */
  note?: string | null;
  /** Product MRP — shown struck-through under the item when Show MRP is on and it beats the rate. */
  mrp?: number | null;
  hsn?: string | null;
}

export interface ReceiptGstInfo {
  mode: "inclusive" | "exclusive" | "none";
  gst: number;
  cgst: number;
  sgst: number;
  igst?: number;
  supplyType?: "intrastate" | "interstate";
  byRate: { rate: number; taxable: number; cgst: number; sgst: number; igst?: number }[];
}

export interface ReceiptPaymentLine {
  mode: string;
  amount: number;
  label?: string | null;
}

export interface ReceiptSnapshot {
  billNo: string;
  createdAt?: string | null;
  billTypeLabel?: string | null;
  copyLabel?: string | null;
  customerName?: string | null;
  customerMobile?: string | null;
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
  buyerAddress?: string | null;
  rows: ReceiptLine[];
  subtotal: number;
  discount: number;
  /** Signed nearest-rupee round-off folded into the total; omitted/0 when off. */
  roundOff?: number;
  total: number;
  paid: number;
  credit: number;
  payments?: ReceiptPaymentLine[];
  status?: string | null;
  shop?: ReceiptShopInfo | null;
  footerNote?: string | null;
  /** When present, the receipt prints the CGST/SGST breakup. */
  gst?: ReceiptGstInfo | null;
  /** Show the HSN code under item names (GST invoices). */
  showHsn?: boolean;
  /** Show each item's MRP (struck through) under its name. */
  showMrp?: boolean;
  /** Total the customer saved (MRP gap + discounts). Prints a "You saved" line when > 0. */
  savings?: number;
}

export type ReceiptPaperSize = "58mm" | "80mm" | "A4";

export interface ReceiptRenderOptions {
  /** Thermal/page width. Defaults to 80mm (the most common thermal roll). */
  paperSize?: ReceiptPaperSize;
  /** How many copies to stack in one print job (merchant + customer). 1–4. */
  copies?: number;
}

function receiptPageRule(paperSize: ReceiptPaperSize) {
  if (paperSize === "58mm") return "@page { size: 58mm auto; margin: 3mm; }";
  if (paperSize === "A4") return "@page { size: A4; margin: 12mm; }";
  return "@page { size: 80mm auto; margin: 4mm; }";
}

function receiptShellWidth(paperSize: ReceiptPaperSize) {
  if (paperSize === "58mm") return "64mm";
  if (paperSize === "A4") return "150mm";
  return "88mm";
}

export function formatReceiptMoney(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `Rs ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char] ?? char));
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function safeText(value: unknown, fallback = "") {
  const text = cleanText(value);
  return text.length > 0 ? text : fallback;
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function formatQuantity(value: number) {
  const quantity = Number.isFinite(value) ? value : 0;
  return quantity.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(quantity) ? 0 : 2,
    maximumFractionDigits: 3,
  });
}

function paymentLabel(mode: string, fallback?: string | null) {
  const cleanFallback = safeText(fallback);
  if (cleanFallback) return cleanFallback;
  const normalized = mode.trim().toLowerCase();
  if (normalized === "cash") return "Cash";
  if (normalized === "upi") return "UPI";
  if (normalized === "credit") return "Udhar";
  if (normalized === "card") return "Card";
  if (normalized === "bank") return "Bank";
  return safeText(mode, "Payment");
}

function receiptRows(rows: ReceiptLine[], showHsn = false, showMrp = false) {
  if (rows.length === 0) {
    return `<tr><td class="empty" colspan="4">No items recorded</td></tr>`;
  }
  return rows.map((item, index) => `
        <tr>
          <td class="item">
            <span class="serial">${index + 1}.</span>
            <span>${escapeHtml(safeText(item.name, "Item"))}</span>
            ${showHsn && item.hsn ? `<div class="hsn">HSN: ${escapeHtml(safeText(item.hsn))}</div>` : ""}
            ${showMrp && Number(item.mrp) > Number(item.rate) ? `<div class="hsn">MRP <s>${formatReceiptMoney(Number(item.mrp))}</s></div>` : ""}
            ${Number(item.lineDiscount) > 0 ? `<div class="hsn">Less discount ${formatReceiptMoney(Number(item.lineDiscount))}</div>` : ""}
            ${cleanText(item.note) ? `<div class="hsn">${escapeHtml(cleanText(item.note))}</div>` : ""}
          </td>
          <td class="right nowrap">${formatQuantity(item.quantity)} ${escapeHtml(safeText(item.unit))}</td>
          <td class="right nowrap">${formatReceiptMoney(item.rate)}</td>
          <td class="right nowrap">${formatReceiptMoney(item.total)}</td>
        </tr>`).join("");
}

function paymentRows(snapshot: ReceiptSnapshot) {
  const explicit = (snapshot.payments ?? []).filter((payment) => Number(payment.amount) > 0);
  const fallback: ReceiptPaymentLine[] = explicit.length > 0 ? explicit : [
    ...(snapshot.paid > 0 ? [{ mode: "paid", label: "Paid", amount: snapshot.paid }] : []),
    ...(snapshot.credit > 0 ? [{ mode: "credit", label: "Udhar", amount: snapshot.credit }] : []),
  ];

  if (fallback.length === 0) return "";
  return `
      <div class="section-title">Payment</div>
      <div class="payment-box">
        ${fallback.map((payment) => `
          <div class="line">
            <span>${escapeHtml(paymentLabel(payment.mode, payment.label))}</span>
            <strong>${formatReceiptMoney(Number(payment.amount) || 0)}</strong>
          </div>`).join("")}
      </div>`;
}

function gstSection(snapshot: ReceiptSnapshot) {
  const info = snapshot.gst;
  if (!info || info.gst <= 0) return "";
  const interstate = info.supplyType === "interstate" || Number(info.igst ?? 0) > 0;
  const rateRows = info.byRate.map((row) => `
          <div class="line">
            <span>@${row.rate}% on ${formatReceiptMoney(row.taxable)}</span>
            <strong>${interstate ? `IGST ${formatReceiptMoney(Number(row.igst ?? 0))}` : `CGST ${formatReceiptMoney(row.cgst)} · SGST ${formatReceiptMoney(row.sgst)}`}</strong>
          </div>`).join("");
  const note = info.mode === "inclusive"
    ? `<div class="gst-note">Prices are GST-inclusive — total includes GST of ${formatReceiptMoney(info.gst)}.</div>`
    : "";
  return `
      <div class="section-title">GST Breakup (${interstate ? "IGST" : "CGST + SGST"})</div>
      <div class="payment-box">
        ${rateRows}
        <div class="line"><span>Total GST</span><strong>${formatReceiptMoney(info.gst)}</strong></div>
      </div>
      ${note}`;
}

function shopLines(shop?: ReceiptShopInfo | null) {
  const lines = [
    safeText(shop?.address),
    safeText(shop?.city),
    shop?.phone ? `Phone: ${safeText(shop.phone)}` : "",
    shop?.gstNumber ? `GSTIN: ${safeText(shop.gstNumber)}` : "",
  ].filter(Boolean);
  return lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

export function buildReceiptHtml(snapshot: ReceiptSnapshot, options: ReceiptRenderOptions = {}) {
  const paperSize = options.paperSize ?? "80mm";
  const copies = Math.max(1, Math.min(4, Math.floor(options.copies ?? 1)));
  const shopName = safeText(snapshot.shop?.name, "Artha");
  const dateTime = formatDateTime(snapshot.createdAt);
  const customerName = safeText(snapshot.customerName, "Walk-in");
  const customerMobile = safeText(snapshot.customerMobile);
  const buyerGstin = safeText(snapshot.buyerGstin);
  const buyerStateCode = safeText(snapshot.buyerStateCode);
  const buyerAddress = safeText(snapshot.buyerAddress);
  const copyLabel = safeText(snapshot.copyLabel, "Customer copy");
  const billTypeLabel = safeText(snapshot.billTypeLabel, "Sale receipt");
  const cashierName = safeText(snapshot.shop?.cashierName);
  const footerNote = safeText(snapshot.footerNote, "Thank you for shopping with us.");
  const cancelled = safeText(snapshot.status).toLowerCase() === "cancelled";
  const isEstimate = safeText(snapshot.billTypeLabel).trim().toLowerCase() === "estimate";

  const innerHtml = `<header class="shop">
          <div class="shop-name">${escapeHtml(shopName)}</div>
          <div class="shop-meta">${shopLines(snapshot.shop)}</div>
        </header>
        <div class="receipt-type">
          <span>${escapeHtml(billTypeLabel)}</span>
          <span class="badge">${escapeHtml(copyLabel)}</span>
        </div>
        ${cancelled ? `<div class="cancelled">Cancelled bill</div>` : ""}
        ${isEstimate ? `<div class="estimate-banner">Estimate &mdash; not a final bill</div>` : ""}
        <section class="meta-grid">
          <div><span>Bill no</span><strong>${escapeHtml(safeText(snapshot.billNo, "Pending"))}</strong></div>
          <div><span>Date</span><strong>${escapeHtml(dateTime || "-")}</strong></div>
          <div><span>Customer</span><strong>${escapeHtml(customerName)}</strong></div>
          <div><span>Mobile</span><strong>${escapeHtml(customerMobile || "-")}</strong></div>
          ${buyerGstin ? `<div><span>Buyer GSTIN</span><strong>${escapeHtml(buyerGstin)}</strong></div>` : ""}
          ${buyerStateCode ? `<div><span>Place of supply</span><strong>${escapeHtml(buyerStateCode)}</strong></div>` : ""}
          ${buyerAddress ? `<div class="meta-wide"><span>Billing address</span><strong>${escapeHtml(buyerAddress)}</strong></div>` : ""}
          ${cashierName ? `<div><span>Cashier</span><strong>${escapeHtml(cashierName)}</strong></div>` : ""}
        </section>
        <table>
          <thead>
            <tr><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amt</th></tr>
          </thead>
          <tbody>${receiptRows(snapshot.rows, Boolean(snapshot.showHsn), Boolean(snapshot.showMrp))}</tbody>
        </table>
        <section class="summary">
          <div class="line"><span>Subtotal</span><strong>${formatReceiptMoney(snapshot.subtotal)}</strong></div>
          ${snapshot.gst && snapshot.gst.gst > 0 && snapshot.gst.mode === "exclusive" ? `<div class="line"><span>GST (${snapshot.gst.supplyType === "interstate" ? "IGST" : "CGST + SGST"})</span><strong>+${formatReceiptMoney(snapshot.gst.gst)}</strong></div>` : ""}
          ${snapshot.discount > 0 ? `<div class="line"><span>Discount</span><strong>-${formatReceiptMoney(snapshot.discount)}</strong></div>` : ""}
          ${snapshot.roundOff ? `<div class="line"><span>Round off</span><strong>${snapshot.roundOff > 0 ? "+" : "-"}${formatReceiptMoney(Math.abs(snapshot.roundOff))}</strong></div>` : ""}
          <div class="line grand"><span>Total</span><strong>${formatReceiptMoney(snapshot.total)}</strong></div>
          <div class="line"><span>Paid</span><strong>${formatReceiptMoney(snapshot.paid)}</strong></div>
          <div class="line due"><span>Due / Udhar</span><strong>${formatReceiptMoney(snapshot.credit)}</strong></div>
          ${Number(snapshot.savings) > 0 ? `<div class="line savings"><span>You saved</span><strong>${formatReceiptMoney(Number(snapshot.savings))}</strong></div>` : ""}
        </section>
        ${gstSection(snapshot)}
        ${paymentRows(snapshot)}
        <footer class="footer">
          <strong>${escapeHtml(footerNote)}</strong>
          <div class="system-note">Powered by Artha - local-first counter billing.</div>
        </footer>`;

  const actionsHtml = `<div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>`;
  // Stack `copies` receipts in one print job (merchant + customer). The first copy
  // carries the on-screen print button; extra copies page-break onto fresh paper.
  const cards = Array.from({ length: copies }, (_, index) => `<div class="receipt"${index > 0 ? ` style="page-break-before: always;"` : ""}>
      <div class="inner">
        ${innerHtml}
      </div>
      ${index === 0 ? actionsHtml : ""}
    </div>`).join("\n    ");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(snapshot.billNo)}</title>
  <style>
    ${receiptPageRule(paperSize)}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f4f6;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
    }
    .receipt-shell {
      width: min(100%, ${receiptShellWidth(paperSize)});
      margin: 0 auto;
      padding: 12px;
    }
    .receipt {
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
      overflow: hidden;
    }
    .inner { padding: 14px; }
    .shop {
      text-align: center;
      border-bottom: 2px solid #111827;
      padding-bottom: 10px;
    }
    .shop-name {
      font-size: 21px;
      font-weight: 900;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }
    .shop-meta { margin-top: 4px; color: #4b5563; font-size: 11px; }
    .receipt-type {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px dashed #9ca3af;
      padding: 10px 0;
      text-transform: uppercase;
      font-size: 10px;
      font-weight: 800;
      color: #374151;
    }
    .badge {
      border: 1px solid #111827;
      border-radius: 999px;
      padding: 2px 7px;
      color: #111827;
      white-space: nowrap;
    }
    .cancelled {
      margin-top: 10px;
      border: 1px solid #991b1b;
      background: #fef2f2;
      color: #991b1b;
      padding: 7px;
      text-align: center;
      font-weight: 900;
      text-transform: uppercase;
    }
    .estimate-banner {
      margin-top: 10px;
      border: 1px solid #6d3df0;
      background: #f5f0ff;
      color: #5b21b6;
      padding: 7px;
      text-align: center;
      font-weight: 900;
      text-transform: uppercase;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 10px;
      border-bottom: 1px dashed #9ca3af;
      padding: 10px 0;
    }
    .meta-grid span {
      display: block;
      color: #6b7280;
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 800;
    }
    .meta-grid strong {
      display: block;
      margin-top: 1px;
      font-size: 12px;
      word-break: break-word;
    }
    .meta-wide { grid-column: 1 / -1; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th {
      border-bottom: 1px solid #111827;
      padding: 6px 2px;
      color: #374151;
      font-size: 10px;
      text-transform: uppercase;
    }
    td {
      border-bottom: 1px solid #e5e7eb;
      padding: 7px 2px;
      vertical-align: top;
    }
    .item {
      width: 37%;
      font-weight: 700;
      word-break: break-word;
    }
    .serial {
      color: #6b7280;
      font-weight: 700;
      margin-right: 3px;
    }
    .hsn {
      color: #6b7280;
      font-size: 9px;
      margin-top: 1px;
    }
    .gst-note {
      margin-top: 5px;
      color: #4b5563;
      font-size: 10px;
      text-align: center;
    }
    .right { text-align: right; }
    .nowrap { white-space: nowrap; }
    .empty {
      padding: 16px 0;
      text-align: center;
      color: #6b7280;
    }
    .summary {
      border-top: 1px dashed #9ca3af;
      margin-top: 10px;
      padding-top: 8px;
    }
    .line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 5px 0;
    }
    .line span { color: #4b5563; }
    .grand {
      background: #111827;
      color: #ffffff;
      border-radius: 6px;
      margin-top: 8px;
      padding: 8px;
      font-size: 15px;
      font-weight: 900;
    }
    .grand span { color: #ffffff; }
    .due strong { color: #991b1b; }
    .savings { margin-top: 6px; }
    .savings span, .savings strong { color: #047857; font-weight: 800; }
    .section-title {
      margin-top: 10px;
      color: #6b7280;
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 900;
    }
    .payment-box {
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      margin-top: 5px;
      padding: 6px 8px;
    }
    .footer {
      border-top: 1px dashed #9ca3af;
      margin-top: 12px;
      padding-top: 10px;
      text-align: center;
      color: #4b5563;
      font-size: 11px;
    }
    .system-note {
      margin-top: 6px;
      color: #6b7280;
      font-size: 10px;
    }
    .actions {
      padding: 0 14px 14px;
      text-align: center;
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 8px;
      background: #16a34a;
      color: white;
      cursor: pointer;
      font-weight: 800;
      padding: 10px 12px;
    }
    @media print {
      body { background: #ffffff; }
      .receipt-shell { width: auto; padding: 0; }
      .receipt { border: 0; border-radius: 0; box-shadow: none; }
      .inner { padding: 0; }
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="receipt-shell">
    ${cards}
  </div>
</body>
</html>`;
}

export function buildReceiptPendingHtml(snapshot?: Pick<ReceiptSnapshot, "billNo" | "shop"> | null) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Saving bill</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, Helvetica, sans-serif; background: #f3f4f6; color: #111827; }
    .box { width: min(92vw, 360px); border: 1px solid #d1d5db; border-radius: 14px; background: white; padding: 22px; box-shadow: 0 16px 36px rgba(15,23,42,0.12); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #4b5563; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Saving bill...</h1>
    <p>${escapeHtml(safeText(snapshot?.shop?.name, "Artha"))} is saving this bill. Printing will start after the bill number is ready.</p>
  </div>
</body>
</html>`;
}

export function buildReceiptErrorHtml(message: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Bill print failed</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, Helvetica, sans-serif; background: #fef2f2; color: #111827; }
    .box { width: min(92vw, 360px); border: 1px solid #fecaca; border-radius: 14px; background: white; padding: 22px; box-shadow: 0 16px 36px rgba(127,29,29,0.12); }
    h1 { margin: 0 0 8px; color: #991b1b; font-size: 20px; }
    p { margin: 0; color: #4b5563; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Bill was not saved</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

export interface ReceiptWindowOptions extends ReceiptRenderOptions {
  autoPrint?: boolean;
  printDelayMs?: number;
  onDirectPrintSettled?: (result: { status: "sent" | "fallback"; message?: string }) => void;
}

export function writeReceiptWindow(popup: Window, snapshot: ReceiptSnapshot, options: ReceiptWindowOptions = {}) {
  popup.document.open();
  popup.document.write(buildReceiptHtml(snapshot, { paperSize: options.paperSize, copies: options.copies }));
  popup.document.close();
  popup.focus();
  if (options.autoPrint ?? true) {
    setTimeout(() => popup.print(), options.printDelayMs ?? 300);
  }
}

export function writeReceiptPendingWindow(popup: Window, snapshot?: Pick<ReceiptSnapshot, "billNo" | "shop"> | null) {
  popup.document.open();
  popup.document.write(buildReceiptPendingHtml(snapshot));
  popup.document.close();
  popup.focus();
}

export function writeReceiptErrorWindow(popup: Window, message: string) {
  popup.document.open();
  popup.document.write(buildReceiptErrorHtml(message));
  popup.document.close();
  popup.focus();
}

export function openReceiptWindow(snapshot: ReceiptSnapshot, options: ReceiptWindowOptions = {}) {
  const popup = window.open("", "_blank", "width=460,height=760");
  if (!popup) return false;
  writeReceiptWindow(popup, snapshot, options);
  return true;
}

function writeUncertainDirectPrintFallback(
  popup: Window,
  snapshot: ReceiptSnapshot,
  options: ReceiptWindowOptions,
  retrySameJob: () => Promise<void>,
) {
  // A local bridge error can happen after the printer accepted bytes but before the
  // browser received its acknowledgement. Never auto-print through a second path:
  // that could silently duplicate a receipt or open the drawer twice.
  writeReceiptWindow(popup, snapshot, { ...options, autoPrint: false });
  const warning = popup.document.createElement("div");
  warning.setAttribute("role", "alert");
  warning.style.cssText = "max-width:88mm;margin:12px auto 0;padding:10px 12px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;color:#92400e;font:700 12px/1.4 Arial,sans-serif";
  warning.textContent = "Direct printer confirmation was lost. Inspect the printer first to avoid a duplicate receipt. Retry same job safely resumes the journaled print without submitting completed copies again.";
  const retry = popup.document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry same print job";
  retry.style.cssText = "display:block;margin-top:8px;padding:7px 10px;border:0;border-radius:6px;background:#92400e;color:white;font:700 12px Arial,sans-serif;cursor:pointer";
  retry.addEventListener("click", () => {
    retry.disabled = true;
    retry.textContent = "Checking print journal…";
    void retrySameJob().catch((error) => {
      retry.disabled = false;
      retry.textContent = "Retry same print job";
      const message = error instanceof Error ? error.message : "Printer confirmation failed again.";
      warning.firstChild!.textContent = `Still not confirmed: ${message} Inspect the printer before retrying or using Print / Save PDF.`;
    });
  });
  warning.appendChild(retry);
  popup.document.body.insertBefore(warning, popup.document.body.firstChild);
}

export function writeConfiguredReceiptWindow(popup: Window, snapshot: ReceiptSnapshot, options: ReceiptWindowOptions = {}) {
  const printer = getPrinterConfigSync();
  if (printer.connection !== "bridge") {
    writeReceiptWindow(popup, snapshot, options);
    return;
  }

  writeReceiptPendingWindow(popup, snapshot);
  const renderOptions = { paperSize: options.paperSize ?? printer.paperSize, copies: options.copies ?? printer.copies };
  const jobId = `receipt:${snapshot.billNo}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const directPrintInput = {
    // The bridge owns copy iteration and journals each physical submission. Sending
    // HTML that already contains N copies would produce N x N receipts.
    html: buildReceiptHtml(snapshot, { ...renderOptions, copies: 1 }),
    jobId,
    copies: renderOptions.copies ?? 1,
    paperSize: renderOptions.paperSize ?? "80mm",
    autoCut: printer.autoCut,
    cashDrawer: printer.cashDrawer,
  };
  const submitSameJob = () => printHtmlViaHardwareBridge(printer.bridgeUrl, directPrintInput).then(() => {
    options.onDirectPrintSettled?.({ status: "sent" });
    if (!popup.closed) popup.close();
  });
  void submitSameJob().catch((error) => {
    const message = error instanceof Error ? error.message : "Direct printer confirmation failed.";
    options.onDirectPrintSettled?.({ status: "fallback", message });
    if (!popup.closed) writeUncertainDirectPrintFallback(popup, snapshot, options, submitSameJob);
  });
}

export function openConfiguredReceiptWindow(snapshot: ReceiptSnapshot, options: ReceiptWindowOptions = {}) {
  const popup = window.open("", "_blank", "width=460,height=760");
  if (!popup) return false;
  writeConfiguredReceiptWindow(popup, snapshot, options);
  return true;
}
