import type { Product } from "@/lib/api/client";
import type { EncodedCartItem } from "@/lib/qr/cart-codec";
import { productSellingPrice } from "./billing-calculations";
import type { BillingDraft, CartItem, HeldBill } from "./billing-types";

// Pure helpers for the "multiple open bills" switcher — kept out of the page component so they
// can be unit-tested. An "open bill" is a parked cart (HeldBill); the one in the workspace is
// tracked by its id and saved back into the set when switching / starting a new bill.

export const MAX_OPEN_BILLS = 10;

/** A parked bill older than this is shown with a "stale" marker in the switcher. */
export const HELD_BILL_STALE_MS = 12 * 60 * 60 * 1000; // 12 hours
/** A parked bill older than this is auto-archived on load — a week-old cart is abandoned. */
export const HELD_BILL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const BILLING_DRAFT_KEY = "kirana-os:billing-draft:v1";

/** offlineDB settings key holding the open-bills set. Shared by BillingPage and the QR importer. */
export const HELD_BILLS_KEY = "kirana-os:held-bills:v1";

export function newBillId(): string {
  return `bill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Insert or replace an open bill by id — in place (to keep the bar's order stable), else prepend. */
export function upsertOpenBill(list: HeldBill[], bill: HeldBill): HeldBill[] {
  const index = list.findIndex((entry) => entry.id === bill.id || (bill.sourceOrderId != null && entry.sourceOrderId === bill.sourceOrderId));
  if (index >= 0) {
    const next = [...list];
    next[index] = { ...bill, id: next[index].id };
    return next;
  }
  return [bill, ...list].slice(0, MAX_OPEN_BILLS);
}

/** Milliseconds since a held bill was parked (0 if its timestamp is unreadable). */
export function heldBillAgeMs(bill: HeldBill, now = Date.now()): number {
  const parked = new Date(bill.createdAt).getTime();
  if (!Number.isFinite(parked)) return 0;
  return Math.max(0, now - parked);
}

/** A parked bill old enough to warn the cashier it may be forgotten. */
export function isHeldBillStale(bill: HeldBill, now = Date.now()): boolean {
  return heldBillAgeMs(bill, now) >= HELD_BILL_STALE_MS;
}

/** Short human age for the switcher tooltip: "5m", "3h", "2d". */
export function formatHeldBillAge(bill: HeldBill, now = Date.now()): string {
  const ms = heldBillAgeMs(bill, now);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Drop parked bills older than the max age on load. A week-old cart is
 * abandoned, not "open" — keeping it wastes a switcher slot (the set is capped
 * at MAX_OPEN_BILLS) and risks re-billing stale prices. Returns the survivors
 * plus how many were archived, so the caller can persist and inform the user.
 */
export function pruneExpiredHeldBills(
  bills: HeldBill[],
  now = Date.now(),
): { kept: HeldBill[]; archived: number } {
  const kept = bills.filter((bill) => heldBillAgeMs(bill, now) < HELD_BILL_MAX_AGE_MS);
  return { kept, archived: bills.length - kept.length };
}

export function billingDraftFromHeldBill(bill: HeldBill): BillingDraft {
  const { id, label: _label, createdAt: _createdAt, ...draft } = bill;
  return { ...draft, activeBillId: id };
}

export function heldBillFromBillingDraft(draft: BillingDraft | null | undefined): HeldBill | null {
  if (!draft?.activeBillId || !draft.cart?.length) return null;
  const customer = draft.customerName?.trim() || "Walk-in";
  return {
    ...draft,
    id: draft.activeBillId,
    label: `${customer} • ${draft.cart.length} item${draft.cart.length === 1 ? "" : "s"}`,
    createdAt: new Date().toISOString(),
  };
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
