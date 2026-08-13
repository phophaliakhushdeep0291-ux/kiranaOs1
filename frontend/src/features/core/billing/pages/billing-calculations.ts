import { applyRoundOff, roundMoney, roundToRupee } from "@/lib/money";
import type { Product } from "@/lib/api/client";
import { addonUnitPrice, type CartItem } from "./billing-types";

export function clampAmount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export { applyRoundOff, roundMoney, roundToRupee };

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

/**
 * Does this look like a scanned code rather than someone typing a product name?
 *
 * This decides whether an unmatched Enter opens the bind sheet or does nothing, so it is
 * deliberately narrow: a scanner emits an unbroken run of digits (EAN-8/13, UPC-A/E) or an
 * alphanumeric Code-128/39 payload, never spaces. "sug" pressed by an impatient cashier
 * must NOT be treated as a new barcode — the shortest real symbology is 8 digits, so the
 * length floor sits there for digits and higher for mixed codes.
 */
export function looksLikeScannedBarcode(rawSearch: string): boolean {
  const term = rawSearch.trim();
  if (!term || /\s/.test(term) || term.length > 48) return false;
  if (/^\d{8,}$/.test(term)) return true;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{9,}$/.test(term) && /\d/.test(term);
}

export type ScanOutcome =
  | { kind: "match"; product: Product }
  | { kind: "unknown-code"; code: string }
  | { kind: "none" };

/**
 * What should Enter (or a camera read) do with the current search box?
 *
 * The exact-code lookup runs over the WHOLE catalogue, not the filtered grid, because
 * `filtered` is narrowed by the category chips and capped at 30 rows. Resolving only
 * against it would report a code the shop already owns as unknown, and the cashier would
 * be offered a bind that the service is then obliged to reject.
 */
export function resolveScanOutcome(
  rawSearch: string,
  filtered: Product[],
  all: Product[],
): ScanOutcome {
  const term = rawSearch.trim();
  if (!term) return { kind: "none" };

  // Only an exact code match counts at catalogue scope. resolveScanMatch's other rule —
  // "the sole row on screen" — is about a narrowed grid and would be nonsense here.
  const lower = term.toLowerCase();
  const exact = all.find(
    (product) =>
      (product.barcode && String(product.barcode).trim().toLowerCase() === lower) ||
      (product.sku && String(product.sku).trim().toLowerCase() === lower),
  );
  if (exact) return { kind: "match", product: exact };

  const onScreen = resolveScanMatch(term, filtered);
  if (onScreen) return { kind: "match", product: onScreen };

  return looksLikeScannedBarcode(term) ? { kind: "unknown-code", code: term } : { kind: "none" };
}

export interface BindSheetPickInput {
  product: Product;
  code: string;
  /** True once the cashier pressed Skip: the queue matters more than the catalogue. */
  skip: boolean;
  bind: (product: Product, code: string) => Promise<void>;
  add: (product: Product) => void;
}

export interface BindSheetPickResult {
  bound: boolean;
  added: boolean;
  error?: string;
}

/**
 * What happens when the cashier picks an item in the capture-on-first-scan sheet.
 *
 * Binding and adding are ONE action — the cashier said "this code is that item", and the
 * item they just identified is the item they are selling. The add happens only after the
 * bind resolves, so a code that turned out to belong to something else leaves the cart
 * honest and the sheet open with the reason.
 *
 * Skip binds nothing and still adds: a cashier with a queue is never made to teach the
 * catalogue before they can sell.
 */
export async function applyBindSheetPick(input: BindSheetPickInput): Promise<BindSheetPickResult> {
  if (input.skip) {
    input.add(input.product);
    return { bound: false, added: true };
  }

  try {
    await input.bind(input.product, input.code);
  } catch (error) {
    return { bound: false, added: false, error: error instanceof Error ? error.message : String(error) };
  }

  input.add(input.product);
  return { bound: true, added: true };
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
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const effectiveRate = quantity > 0
    ? roundMoney(Number(item.rate) - cartItemLineDiscount(item) / quantity)
    : Number(item.rate);
  const minimumRate = Number(item.sellingUnit?.minimumPrice ?? productMinSellingPrice(item.product));
  if (effectiveRate < minimumRate) return true;
  if (!item.manualRate && item.pricing?.requiresApproval === true) return true;
  return false;
}

export const LARGE_DISCOUNT_MIN_AMOUNT = 100;
export const LARGE_DISCOUNT_MIN_PERCENT = 10;

export interface BillingDiscountApprovalSummary {
  referenceSubtotal: number;
  approvalDiscount: number;
  threshold: number;
  requiresApproval: boolean;
}

/**
 * Owner-approval discount total. It includes bill and line discounts plus a
 * manual markdown from the configured/default product price. A recognised
 * pricing rule is owner-configured, so its normal price is not counted again;
 * rules that explicitly require approval are handled by lineNeedsOwnerApproval.
 */
export function billingDiscountApprovalSummary(cart: CartItem[], billDiscount: number): BillingDiscountApprovalSummary {
  let referenceSubtotal = 0;
  let approvalDiscount = Math.max(0, Number(billDiscount) || 0);
  for (const item of cart) {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const addonRate = addonUnitPrice(item.addons);
    const referenceBaseRate = item.isCustom
      ? Number(item.rate) || 0
      : Number(item.sellingUnit?.defaultPrice ?? item.pricing?.originalUnitPrice ?? productSellingPrice(item.product, quantity)) || 0;
    referenceSubtotal += roundMoney((referenceBaseRate + addonRate) * quantity);
    approvalDiscount += cartItemLineDiscount(item);
    if (!item.isCustom && !item.pricing?.appliedRuleId && referenceBaseRate > item.rate) {
      approvalDiscount += roundMoney((referenceBaseRate - item.rate) * quantity);
    }
  }
  referenceSubtotal = roundMoney(referenceSubtotal);
  approvalDiscount = roundMoney(approvalDiscount);
  const threshold = roundMoney(Math.max(LARGE_DISCOUNT_MIN_AMOUNT, referenceSubtotal * LARGE_DISCOUNT_MIN_PERCENT / 100));
  return {
    referenceSubtotal,
    approvalDiscount,
    threshold,
    requiresApproval: referenceSubtotal > 0 && approvalDiscount >= threshold - 0.005,
  };
}

/** Exact commercial state an owner approved; any later edit must prompt again. */
export function billingSensitiveApprovalFingerprint(cart: CartItem[], billDiscount: number, loyaltyPoints: number): string {
  return JSON.stringify({
    discount: roundMoney(billDiscount),
    loyaltyPoints: Math.max(0, Math.floor(Number(loyaltyPoints) || 0)),
    lines: cart.map((item) => ({
      productId: item.product.id,
      unitId: item.sellingUnit?.id ?? item.sellingUnit?.unitCode ?? item.unit,
      quantity: roundQuantity(item.quantity),
      rate: roundMoney(item.rate),
      lineDiscount: cartItemLineDiscount(item),
      pricingRuleId: item.pricing?.appliedRuleId ?? null,
      addons: (item.addons ?? []).map((addon) => ({ id: addon.optionId, quantity: addon.quantity ?? 1, price: roundMoney(addon.price) })),
    })),
  });
}

/** Gross line amount before any per-line discount. */
export function cartItemGross(item: CartItem): number {
  return roundMoney(Number(item.quantity) * cartItemUnitRate(item));
}

/** Dish/pack price plus its configured options, per sold unit. */
export function cartItemUnitRate(item: CartItem): number {
  return roundMoney(Number(item.rate) + addonUnitPrice(item.addons));
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
  return roundMoney((cartItemUnitRate(item) - productCostPrice(item.product)) * Number(item.quantity) - cartItemLineDiscount(item));
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
