import type { Product } from "@/lib/api/client";
import type { EncodedCartItem } from "@/lib/qr/cart-codec";
import { productSellingPrice } from "./billing-calculations";
import type { CartItem, HeldBill } from "./billing-types";

// Pure helpers for the "multiple open bills" switcher — kept out of the page component so they
// can be unit-tested. An "open bill" is a parked cart (HeldBill); the one in the workspace is
// tracked by its id and saved back into the set when switching / starting a new bill.

export const MAX_OPEN_BILLS = 10;

/** offlineDB settings key holding the open-bills set. Shared by BillingPage and the QR importer. */
export const HELD_BILLS_KEY = "kirana-os:held-bills:v1";

export function newBillId(): string {
  return `bill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Insert or replace an open bill by id — in place (to keep the bar's order stable), else prepend. */
export function upsertOpenBill(list: HeldBill[], bill: HeldBill): HeldBill[] {
  const index = list.findIndex((entry) => entry.id === bill.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = bill;
    return next;
  }
  return [bill, ...list].slice(0, MAX_OPEN_BILLS);
}

export interface ImportedCartResult {
  bill: HeldBill;
  /** Number of scanned lines matched to a current product. */
  matched: number;
  /** Product ids in the scan that don't exist in the owner's catalog (skipped). */
  skipped: string[];
}

/**
 * Build a new open bill from a QR-scanned customer cart. Each scanned {productId, qty} is matched
 * to one of the owner's live products; unknown ids are skipped (a different shop's code, or a
 * deleted product). Line rate/unit are taken from the LIVE product (the same way addToCart does),
 * so the imported cart always reflects current prices — the customer's snapshot is only a request.
 */
export function billFromImportedCart(
  products: Product[],
  items: EncodedCartItem[],
  opts: { now?: () => number; label?: string; sourceOrderId?: string } = {},
): ImportedCartResult {
  const byId = new Map(products.map((p) => [p.id, p]));
  const cart: CartItem[] = [];
  const skipped: string[] = [];
  for (const { productId, qty } of items) {
    const product = byId.get(productId);
    if (!product) {
      skipped.push(productId);
      continue;
    }
    const quantity = qty > 0 ? qty : 1;
    cart.push({
      product,
      quantity,
      rate: productSellingPrice(product, quantity),
      unit: product.rateUnit ?? product.displayUnit ?? "piece",
    });
  }
  const id = newBillId();
  const bill: HeldBill = {
    id,
    label: opts.label ?? "QR order",
    createdAt: new Date(opts.now?.() ?? Date.now()).toISOString(),
    cart,
    selectedCustomerId: "walk_in",
    sourceOrderId: opts.sourceOrderId,
  };
  return { bill, matched: cart.length, skipped };
}
