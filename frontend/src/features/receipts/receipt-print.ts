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
  total: number;
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
  rows: ReceiptLine[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  credit: number;
  payments?: ReceiptPaymentLine[];
  status?: string | null;
  shop?: ReceiptShopInfo | null;
  footerNote?: string | null;
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

function receiptRows(rows: ReceiptLine[]) {
  if (rows.length === 0) {
    return `<tr><td class="empty" colspan="4">No items recorded</td></tr>`;
  }
  return rows.map((item, index) => `
        <tr>
          <td class="item">
            <span class="serial">${index + 1}.</span>
            <span>${escapeHtml(safeText(item.name, "Item"))}</span>
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

function shopLines(shop?: ReceiptShopInfo | null) {
  const lines = [
    safeText(shop?.address),
    safeText(shop?.city),
    shop?.phone ? `Phone: ${safeText(shop.phone)}` : "",
    shop?.gstNumber ? `GSTIN: ${safeText(shop.gstNumber)}` : "",
  ].filter(Boolean);
  return lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
}

export function buildReceiptHtml(snapshot: ReceiptSnapshot) {
  const shopName = safeText(snapshot.shop?.name, "KiranaOS");
  const dateTime = formatDateTime(snapshot.createdAt);
  const customerName = safeText(snapshot.customerName, "Walk-in");
  const customerMobile = safeText(snapshot.customerMobile);
  const copyLabel = safeText(snapshot.copyLabel, "Customer copy");
  const billTypeLabel = safeText(snapshot.billTypeLabel, "Sale receipt");
  const cashierName = safeText(snapshot.shop?.cashierName);
  const footerNote = safeText(snapshot.footerNote, "Thank you for shopping with us.");
  const cancelled = safeText(snapshot.status).toLowerCase() === "cancelled";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(snapshot.billNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
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
      width: min(100%, 88mm);
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
    <div class="receipt">
      <div class="inner">
        <header class="shop">
          <div class="shop-name">${escapeHtml(shopName)}</div>
          <div class="shop-meta">${shopLines(snapshot.shop)}</div>
        </header>
        <div class="receipt-type">
          <span>${escapeHtml(billTypeLabel)}</span>
          <span class="badge">${escapeHtml(copyLabel)}</span>
        </div>
        ${cancelled ? `<div class="cancelled">Cancelled bill</div>` : ""}
        <section class="meta-grid">
          <div><span>Bill no</span><strong>${escapeHtml(safeText(snapshot.billNo, "Pending"))}</strong></div>
          <div><span>Date</span><strong>${escapeHtml(dateTime || "-")}</strong></div>
          <div><span>Customer</span><strong>${escapeHtml(customerName)}</strong></div>
          <div><span>Mobile</span><strong>${escapeHtml(customerMobile || "-")}</strong></div>
          ${cashierName ? `<div><span>Cashier</span><strong>${escapeHtml(cashierName)}</strong></div>` : ""}
        </section>
        <table>
          <thead>
            <tr><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amt</th></tr>
          </thead>
          <tbody>${receiptRows(snapshot.rows)}</tbody>
        </table>
        <section class="summary">
          <div class="line"><span>Subtotal</span><strong>${formatReceiptMoney(snapshot.subtotal)}</strong></div>
          ${snapshot.discount > 0 ? `<div class="line"><span>Discount</span><strong>-${formatReceiptMoney(snapshot.discount)}</strong></div>` : ""}
          <div class="line grand"><span>Total</span><strong>${formatReceiptMoney(snapshot.total)}</strong></div>
          <div class="line"><span>Paid</span><strong>${formatReceiptMoney(snapshot.paid)}</strong></div>
          <div class="line due"><span>Due / Udhar</span><strong>${formatReceiptMoney(snapshot.credit)}</strong></div>
        </section>
        ${paymentRows(snapshot)}
        <footer class="footer">
          <strong>${escapeHtml(footerNote)}</strong>
          <div class="system-note">Powered by KiranaOS - local-first counter billing.</div>
        </footer>
      </div>
      <div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>
    </div>
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
    <p>${escapeHtml(safeText(snapshot?.shop?.name, "KiranaOS"))} is saving this bill. Printing will start after the bill number is ready.</p>
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

export function writeReceiptWindow(popup: Window, snapshot: ReceiptSnapshot, options: { autoPrint?: boolean; printDelayMs?: number } = {}) {
  popup.document.open();
  popup.document.write(buildReceiptHtml(snapshot));
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

export function openReceiptWindow(snapshot: ReceiptSnapshot, options: { autoPrint?: boolean; printDelayMs?: number } = {}) {
  const popup = window.open("", "_blank", "width=460,height=760");
  if (!popup) return false;
  writeReceiptWindow(popup, snapshot, options);
  return true;
}
