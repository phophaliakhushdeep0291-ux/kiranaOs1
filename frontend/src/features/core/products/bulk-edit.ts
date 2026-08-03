import type { Product, ProductInput } from "@/types/api";

/**
 * Bulk price/stock edit math — pure so the risky parts (percentage moves, the
 * minimum-price floor, rounding, stock adjust vs set) are unit-tested away
 * from the Products screen. The page maps selected rows through
 * `computeBulkPatch` and sends each result to patchProductLocalFirst.
 */

export type BulkPriceMode = "none" | "increase_pct" | "decrease_pct" | "increase_flat" | "decrease_flat" | "set";
export type BulkStockMode = "none" | "set" | "increase" | "decrease";

export interface BulkEditIntent {
  priceMode: BulkPriceMode;
  /** Percent (for _pct modes) or rupees (for _flat / set). */
  priceValue: number;
  stockMode: BulkStockMode;
  stockValue: number;
}

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round3(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function currentSellingPrice(product: Product & Record<string, unknown>): number {
  return Number(product.defaultPricePerRateUnit ?? product.sellingPrice ?? 0) || 0;
}

function currentStock(product: Product & Record<string, unknown>): number {
  return Number(product.stockBaseQty ?? product.stockQuantity ?? 0) || 0;
}

function minPrice(product: Product & Record<string, unknown>): number {
  return Number(product.minPricePerRateUnit ?? product.minimumSellingPrice ?? 0) || 0;
}

/** New selling price for one product under the intent (before the min-price floor). */
export function nextSellingPrice(product: Product & Record<string, unknown>, intent: BulkEditIntent): number {
  const base = currentSellingPrice(product);
  const value = Math.max(0, Number(intent.priceValue) || 0);
  switch (intent.priceMode) {
    case "increase_pct": return round2(base * (1 + value / 100));
    case "decrease_pct": return round2(base * (1 - value / 100));
    case "increase_flat": return round2(base + value);
    case "decrease_flat": return round2(Math.max(0, base - value));
    case "set": return round2(value);
    default: return base;
  }
}

/** New base-unit stock for one product under the intent. */
export function nextStock(product: Product & Record<string, unknown>, intent: BulkEditIntent): number {
  const base = currentStock(product);
  const value = Number(intent.stockValue) || 0;
  switch (intent.stockMode) {
    case "set": return round3(Math.max(0, value));
    case "increase": return round3(base + Math.abs(value));
    case "decrease": return round3(Math.max(0, base - Math.abs(value)));
    default: return base;
  }
}

export interface BulkPatchResult {
  patch: Partial<ProductInput>;
  /** Selling price was clamped up to the product's minimum. */
  flooredToMinimum: boolean;
  /** Nothing about this product would change. */
  noop: boolean;
}

/**
 * Build the patch for one product. A price that would fall below the product's
 * configured minimum is clamped UP to that minimum (never sold below cost
 * floor via a blanket percentage), and the caller is told so it can warn.
 */
export function computeBulkPatch(product: Product & Record<string, unknown>, intent: BulkEditIntent): BulkPatchResult {
  const patch: Partial<ProductInput> = {};
  let flooredToMinimum = false;

  if (intent.priceMode !== "none") {
    const floor = minPrice(product);
    let price = nextSellingPrice(product, intent);
    if (floor > 0 && price < floor) {
      price = round2(floor);
      flooredToMinimum = true;
    }
    if (price !== currentSellingPrice(product)) {
      // Keep the paired display/canonical price fields in step, mirroring the form.
      patch.defaultPricePerRateUnit = price;
      patch.sellingPrice = price;
    }
  }

  if (intent.stockMode !== "none") {
    const stock = nextStock(product, intent);
    if (stock !== currentStock(product)) {
      patch.stockBaseQty = stock;
      patch.stockQuantity = stock;
      patch.stockTrackingEnabled = true;
    }
  }

  return { patch, flooredToMinimum, noop: Object.keys(patch).length === 0 };
}

/** Does the intent actually ask for any change? (Guards the Apply button.) */
export function intentHasEffect(intent: BulkEditIntent): boolean {
  const priceActive = intent.priceMode !== "none" && (intent.priceMode === "set" || Number(intent.priceValue) > 0);
  const stockActive = intent.stockMode !== "none" && (intent.stockMode === "set" || Number(intent.stockValue) > 0);
  return priceActive || stockActive;
}
