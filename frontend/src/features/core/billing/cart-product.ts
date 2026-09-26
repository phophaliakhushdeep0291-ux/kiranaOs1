import type { Product, ProductSellingUnit } from "@/lib/api/client";
import { cartItemKey, type CartItem, type LinePricingMeta } from "./pages/billing-types";
import { roundQuantity } from "./pages/billing-calculations";

export function activeSellingUnits(product: Product): ProductSellingUnit[] {
  return (product.sellingUnits ?? []).filter((unit) => unit.isActive !== false);
}

export function defaultSellingUnit(product: Product): ProductSellingUnit | undefined {
  const units = activeSellingUnits(product);
  return units.find((unit) => unit.isDefault) ?? units[0];
}

export type CartProductOptions = { custom?: boolean; addons?: CartItem["addons"]; sellingUnit?: ProductSellingUnit; quantity?: number };
export type CartLinePricer = (product: Product, quantity: number, unit?: ProductSellingUnit) => { rate: number; pricing: LinePricingMeta };

/** Shared by counter clicks and durable handoffs, including pack identity and manual prices. */
export function mergeCartProduct(previous: CartItem[], product: Product, resolveLine: CartLinePricer, options?: CartProductOptions): CartItem[] {
  const addedQuantity = options?.quantity && options.quantity > 0 ? options.quantity : 1;
  const sellingUnit = options?.sellingUnit ?? defaultSellingUnit(product);
  const candidate: CartItem = {
    product,
    quantity: addedQuantity,
    rate: product.defaultPricePerRateUnit,
    unit: sellingUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "piece",
    sellingUnit,
    isCustom: options?.custom,
    addons: options?.addons,
  };
  const candidateKey = cartItemKey(candidate);
  const existing = previous.find((item) => cartItemKey(item) === candidateKey);
  if (existing && !options?.custom) {
    // Adding the same item twice accumulates, so `3*rice` on a line that
    // already holds two makes five rather than three. A cashier correcting
    // themselves types the difference; one who scanned the packet again
    // expects it to count.
    const quantity = roundQuantity(existing.quantity + addedQuantity);
    const priced = resolveLine(product, quantity, existing.sellingUnit);
    return previous.map((item) => cartItemKey(item) === candidateKey ? { ...item, quantity, rate: item.manualRate ? item.rate : priced.rate, pricing: item.manualRate ? item.pricing : priced.pricing } : item);
  }
  const quantity = roundQuantity(addedQuantity);
  const priced = resolveLine(product, quantity, sellingUnit);
  return [...previous, { product, quantity, rate: options?.custom ? product.defaultPricePerRateUnit : priced.rate, unit: sellingUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "piece", sellingUnit, isCustom: options?.custom, manualRate: options?.custom, pricing: options?.custom ? undefined : priced.pricing, addons: options?.addons }];
}
