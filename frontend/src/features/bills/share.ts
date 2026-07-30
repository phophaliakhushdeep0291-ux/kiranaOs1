// Free WhatsApp bill-sharing via the public wa.me deep link — no paid WhatsApp Business API,
// no feature gate. Builds a clean text receipt and opens WhatsApp (to the customer's number
// when known, otherwise the chat picker). The paid "automated reminders" path is separate.

type AnyRow = Record<string, unknown>;

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : v == null ? d : String(v);
}
function money(n: number): string {
  const v = Math.abs(n);
  return "₹" + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}

/** Normalize an Indian mobile to wa.me's country-code-prefixed digits. Empty string if unusable. */
export function normalizeWhatsappNumber(raw: string | undefined | null): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "91" + digits; // bare Indian mobile
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  return digits; // already has some country code, or non-standard — pass through
}

export interface BillShareItem { name: string; quantity: number; rate: number; lineTotal: number }
export interface BillShareInput {
  shopName: string;
  shopLocation?: string;
  billNo: string;
  dateIso?: string;
  items: BillShareItem[];
  total: number;
  paid: number;
  credit: number;
  paymentMode?: string;
  customerName?: string;
  customerMobile?: string;
  isReturn?: boolean;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Friendly label for a refund tender recorded on a sales-return bill. */
function refundModeLabel(raw: unknown): string | undefined {
  const mode = str(raw).toLowerCase();
  if (!mode) return undefined;
  if (mode === "upi") return "UPI";
  if (mode === "udhar") return "Udhar";
  if (mode === "gift_card") return "Store credit";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/** Friendly payment-mode label from the payment rows + credit split. */
export function derivePaymentModeLabel(payments: AnyRow[] | undefined, credit: number, total: number): string | undefined {
  const modes = new Set((payments ?? []).map((p) => str(p.mode).toLowerCase()).filter(Boolean));
  const tender = [...modes].filter((m) => m !== "credit");
  if (credit > 0 && total > 0 && credit >= total - 0.005) return "Udhar";
  if (credit > 0 && tender.length > 0) return "Split";
  if (tender.length > 1) return "Split";
  if (tender.includes("upi")) return "UPI";
  if (tender.includes("cash")) return "Cash";
  if (credit > 0) return "Udhar";
  return undefined;
}

/** WhatsApp-friendly plain-text receipt (proportional font — no monospace column alignment). */
export function buildBillReceiptText(input: BillShareInput): string {
  const lines: string[] = [];
  lines.push(`🧾 *${input.shopName || "My Shop"}*`);
  if (input.shopLocation) lines.push(input.shopLocation);
  const head = [`Bill ${input.billNo}`, formatDate(input.dateIso)].filter(Boolean).join(" · ");
  if (head) lines.push(head);
  if (input.isReturn) lines.push("_Return / Refund_");
  lines.push("");
  for (const it of input.items) {
    lines.push(`• ${it.name} — ${Math.abs(it.quantity)} × ${money(it.rate)} = ${money(it.lineTotal)}`);
  }
  if (input.items.length) lines.push("");
  const modeLabel = input.paymentMode ? ` (${input.paymentMode})` : "";
  if (input.isReturn) {
    // money() prints absolute values, and a refund carries negative paid/total. Without
    // explicit refund wording the customer reads "Total: ₹28" as a charge, and the Paid
    // line vanishes entirely because -28 fails the > 0 guard below.
    lines.push(`*Refund total: ${money(input.total)}*`);
    if (Math.abs(input.paid) > 0.005) lines.push(`Refunded to you: ${money(input.paid)}${modeLabel}`);
    if (input.credit < -0.005) lines.push(`Udhar reduced by: ${money(input.credit)}`);
  } else {
    lines.push(`*Total: ${money(input.total)}*`);
    if (input.paid > 0.005) lines.push(`Paid: ${money(input.paid)}${modeLabel}`);
    if (input.credit > 0.005) lines.push(`Udhar baki: ${money(input.credit)}`);
  }
  lines.push("");
  lines.push("Thank you! 🙏");
  return lines.join("\n");
}

export function buildWhatsappShareUrl(input: BillShareInput): string {
  const number = normalizeWhatsappNumber(input.customerMobile);
  const text = encodeURIComponent(buildBillReceiptText(input));
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}

/** Map a loosely-typed bill record (+ optional richer items/payments + shop) to share input. */
export function billRecordToShareInput(
  bill: AnyRow,
  opts: {
    items?: AnyRow[];
    payments?: AnyRow[];
    shopName?: string;
    shopLocation?: string;
    total?: number;
    paid?: number;
    credit?: number;
    paymentMode?: string;
    customerMobile?: string;
  } = {},
): BillShareInput {
  const rawItems = opts.items ?? (Array.isArray(bill.items) ? (bill.items as AnyRow[]) : []);
  const items: BillShareItem[] = rawItems.map((it) => {
    const quantity = num(it.quantity ?? it.qty, 0);
    const rate = num(it.ratePerRateUnit ?? it.rate_per_rate_unit ?? it.rate, 0);
    const lineTotal = num(it.line_total ?? it.lineTotal, quantity * rate);
    return { name: str(it.name ?? it.productName ?? it.product_name, "Item"), quantity, rate, lineTotal };
  });
  const billType = str(bill.billType ?? bill.bill_type, "normal_sale");
  const total = opts.total ?? num(bill.grandTotal ?? bill.totalAmount ?? bill.total, 0);
  const credit = opts.credit ?? num(bill.creditAmount ?? bill.credit_amount, 0);
  const paid = opts.paid ?? num(bill.paidAmount ?? bill.buyerPaidAmount, Math.max(0, total - credit));
  return {
    shopName: opts.shopName || "My Shop",
    shopLocation: opts.shopLocation,
    billNo: str(bill.billNo ?? bill.billNumber ?? bill.bill_no ?? bill.id, "—"),
    dateIso: str(bill.businessDate ?? bill.business_date ?? bill.createdAt ?? bill.created_at) || undefined,
    items,
    total,
    paid,
    credit,
    // A return usually has no payment rows to derive a tender from, but the bill records
    // how the money went back. Without this the refund line reads "Refunded to you: ₹28"
    // with no indication of whether that was cash, UPI, or a khata reduction.
    paymentMode: opts.paymentMode
      ?? derivePaymentModeLabel(opts.payments, credit, total)
      ?? refundModeLabel(bill.refundMode ?? bill.refund_mode),
    customerName: str(bill.customerName ?? bill.customer_name) || undefined,
    customerMobile: opts.customerMobile || str(bill.customerMobile ?? bill.customer_mobile) || undefined,
    isReturn: billType === "sales_return",
  };
}

/**
 * Best-effort customer mobile for a bill. Synced server bills don't denormalize the mobile, so
 * fall back to the customer record (looked up by id) from local storage. Uses a lazy import so
 * this module stays dependency-light for unit tests.
 */
export async function resolveBillCustomerMobile(bill: AnyRow): Promise<string | undefined> {
  const direct = str(bill.customerMobile ?? bill.customer_mobile);
  if (direct) return direct;
  const customerId = str(bill.customerId ?? bill.customer_id);
  if (!customerId) return undefined;
  try {
    const { offlineDB } = await import("@/lib/offline/db");
    const customers = await offlineDB.getAll<AnyRow>("customers");
    const match = customers.find((c) =>
      [c.id, c.local_id, c.server_id].some((key) => typeof key === "string" && key === customerId),
    );
    return str(match?.mobile ?? match?.customerMobile ?? match?.customer_mobile) || undefined;
  } catch {
    return undefined;
  }
}

/** Opens WhatsApp with the prefilled receipt. Returns whether a customer number was targeted. */
export function shareBillOnWhatsapp(input: BillShareInput): { targetedCustomer: boolean } {
  const url = buildWhatsappShareUrl(input);
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  return { targetedCustomer: Boolean(normalizeWhatsappNumber(input.customerMobile)) };
}
