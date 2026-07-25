import { roundMoney } from "@/lib/money";
import type { Product } from "@/lib/api/client";
import type { CartItem } from "./billing-types";

export function clampAmount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export { roundMoney };

/** Quantities support millesimal precision (for example 0.005 kg = 5 g). */
export function roundQuantity(value: number): number {
  const n = Number(value) || 0;
  return Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
}

/** Cash the shop must hand back when the customer tenders more than the bill. */
export function computeChangeDue(cashTendered: number, grandTotal: number): number {
  const change = roundMoney((Number(cashTendered) || 0) - (Number(grandTotal) || 0));
  return change > 0 ? change : 0;
}

/**
 * Quick-tender suggestions for a cash sale: the exact amount, then the next
 * common Indian notes above it (₹50/100/200/500/2000) plus the round-up to the
 * next ₹100. Deduped, sorted, capped — so the cashier taps instead of typing.
 */
export function suggestCashTenders(grandTotal: number, limit = 4): number[] {
  const total = roundMoney(Number(grandTotal) || 0);
  if (total <= 0) return [];
  const notes = [50, 100, 200, 500, 2000];
  const candidates = new Set<number>([total]);
  // Next round ₹100 above the total (e.g. 457 → 500).
  const roundUp = Math.ceil(total / 100) * 100;
  if (roundUp > total) candidates.add(roundUp);
  // Single notes larger than the total (customer pays with one note).
  for (const note of notes) {
    if (note > total) candidates.add(note);
  }
  return [...candidates].sort((a, b) => a - b).slice(0, limit);
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[०-९]/g, (digit) => String("०१२३४५६७८९".indexOf(digit)))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function productSearchText(product: Product): string {
  return normalizeSearchText([
    product.name,
    product.category ?? "",
    product.displayUnit ?? "",
    product.rateUnit ?? "",
    ...(product.aliases ?? []),
  ].join(" "));
}

/**
 * Resolve a scanner/keyboard "enter" in the billing search to the one product
 * to add to the cart, or null if it's ambiguous.
 *
 * A USB barcode scanner types the code and presses Enter, so the fast path is
 * an exact barcode (or SKU) match — that wins even when several products are
 * on screen. Failing that, if the current filter narrows to exactly one
 * product, Enter adds it (type-a-few-letters-and-hit-enter). Anything else is
 * ambiguous and returns null so nothing is added by accident.
 */
export function resolveScanMatch(rawSearch: string, filtered: Product[]): Product | null {
  const term = rawSearch.trim();
  if (!term) return null;
  const lower = term.toLowerCase();
  const exact = filtered.find(
    (product) =>
      (product.barcode && String(product.barcode).trim().toLowerCase() === lower) ||
      (product.sku && String(product.sku).trim().toLowerCase() === lower),
  );
  if (exact) return exact;
  return filtered.length === 1 ? filtered[0] : null;
}

export function productCostPrice(product: Product): number {
  return roundMoney(Number(product.averageCostPrice ?? product.costPrice ?? product.costPerRateUnit ?? 0));
}

export function productSellingPrice(product: Product, quantity = 1): number {
  const base = Number(product.sellingPrice ?? product.defaultPricePerRateUnit ?? 0);
  const retail = Number(product.retailPrice ?? product.retailPricePerRateUnit ?? base);
  const wholesale = Number(product.wholesalePrice ?? product.wholesalePricePerRateUnit ?? base);
  const retailFrom = Number(product.retailFromQuantity ?? 1);
  const wholesaleFrom = Number(product.wholesaleFromQuantity ?? 0);
  if (wholesaleFrom > 0 && quantity >= wholesaleFrom && wholesale > 0) return roundMoney(wholesale);
  if (retailFrom > 0 && quantity >= retailFrom && retail > 0) return roundMoney(retail);
  return roundMoney(base);
}

export function productMinSellingPrice(product: Product): number {
  return roundMoney(Number(product.minimumSellingPrice ?? product.minPricePerRateUnit ?? 0));
}

/**
 * Does this line need owner PIN before the bill can be saved? Two ways a line
 * dips under margin:
 *  1. A rate typed below the product floor (covers custom + manual overrides).
 *  2. Smart Pricing flagged it — a rule resolved below the margin floor (the
 *     engine floors the rate UP to the minimum, so case 1 can't see it) or an
 *     owner-approval rule applied. The flag is trusted only for auto-priced
 *     lines; a manual override is judged by its typed rate in case 1.
 * This is the single source of truth for the confirm-time approval gate.
 */
export function lineNeedsOwnerApproval(item: CartItem): boolean {
  if (item.isCustom) return false;
  if (item.rate < productMinSellingPrice(item.product)) return true;
  if (!item.manualRate && item.pricing?.requiresApproval === true) return true;
  return false;
}

/** Gross line amount before any per-line discount. */
export function cartItemGross(item: CartItem): number {
  return roundMoney(Number(item.quantity) * Number(item.rate));
}

/** Effective per-line discount, clamped to the line's own gross amount. */
export function cartItemLineDiscount(item: CartItem): number {
  return roundMoney(Math.min(Math.max(Number(item.lineDiscount) || 0, 0), cartItemGross(item)));
}

/** What the customer pays for this line: gross minus its line discount. */
export function cartItemNet(item: CartItem): number {
  return roundMoney(cartItemGross(item) - cartItemLineDiscount(item));
}

/**
 * Total rupees the customer saved on this bill — the "You saved ₹X" line on
 * the receipt. Counts, per line, the gap below MRP (only when the product has
 * an MRP above the sold rate) plus that line's own discount, then adds the
 * bill-level discount. Never negative.
 */
export function computeBillSavings(cart: CartItem[], billDiscount: number): number {
  const lineSavings = cart.reduce((sum, item) => {
    const mrp = Number(item.product?.mrp) || 0;
    const rate = Number(item.rate) || 0;
    const qty = Number(item.quantity) || 0;
    const mrpGap = mrp > rate ? roundMoney((mrp - rate) * qty) : 0;
    return sum + mrpGap + cartItemLineDiscount(item);
  }, 0);
  return roundMoney(Math.max(0, lineSavings + (Number(billDiscount) || 0)));
}

export function cartItemProfit(item: CartItem): number {
  if (item.isCustom) return 0;
  return roundMoney((Number(item.rate) - productCostPrice(item.product)) * Number(item.quantity) - cartItemLineDiscount(item));
}

export function profitClass(value: number): string {
  if (value < 0) return "text-destructive";
  if (value > 0) return "text-emerald-600";
  return "text-muted-foreground";
}

/** Sum of line nets — per-line discounts are already inside the subtotal. */
export function calculateCartSubtotal(cart: CartItem[]): number {
  return roundMoney(cart.reduce((sum, item) => sum + cartItemNet(item), 0));
}

/** Total rupees given away through per-line discounts (for the summary row). */
export function calculateLineDiscountTotal(cart: CartItem[]): number {
  return roundMoney(cart.reduce((sum, item) => sum + cartItemLineDiscount(item), 0));
}

export function calculateDiscount(subtotal: number, discount: number): number {
  return Math.min(Math.max(Number(discount) || 0, 0), subtotal);
}

export function calculateGrandTotal(subtotal: number, discount: number): number {
  return roundMoney(Math.max(0, subtotal - calculateDiscount(subtotal, discount)));
}

/**
 * Whether a bill must have a customer attached (udhar/credit needs a khata owner).
 *
 * The split-udhar remainder only counts in Split mode — outside Split that value is
 * `grandTotal - 0 - 0 = grandTotal`, which would wrongly force a customer on every plain
 * walk-in cash/UPI sale. Non-split udhar is already captured by `creditAmount`.
 */
export function billNeedsCustomer(params: {
  isUdharEntry: boolean;
  creditAmount: number;
  isCreditMode: boolean;
  isSplitMode: boolean;
  splitUdharAmount: number;
}): boolean {
  return (
    params.isUdharEntry ||
    params.creditAmount > 0 ||
    params.isCreditMode ||
    (params.isSplitMode && params.splitUdharAmount > 0)
  );
}
