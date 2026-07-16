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

export function cartItemProfit(item: CartItem): number {
  if (item.isCustom) return 0;
  return roundMoney((Number(item.rate) - productCostPrice(item.product)) * Number(item.quantity));
}

export function profitClass(value: number): string {
  if (value < 0) return "text-destructive";
  if (value > 0) return "text-emerald-600";
  return "text-muted-foreground";
}

export function calculateCartSubtotal(cart: CartItem[]): number {
  return roundMoney(cart.reduce((sum, item) => sum + item.quantity * item.rate, 0));
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
