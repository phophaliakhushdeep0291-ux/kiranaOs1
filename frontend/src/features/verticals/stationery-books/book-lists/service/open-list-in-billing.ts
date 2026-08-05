import { offlineDB } from "@/lib/offline/db";
import {
  BILLING_DRAFT_KEY,
  HELD_BILLS_KEY,
  billingDraftFromHeldBill,
  heldBillFromBillingDraft,
  newBillId,
  upsertOpenBill,
} from "@/features/core/billing/pages/open-bills";
import type { BillingDraft, CartItem, HeldBill } from "@/features/core/billing/pages/billing-types";
import type { BookList, Product } from "@/types/api";

/**
 * Put a whole class list on a bill.
 *
 * This is the entire point of keeping lists in the app. A parent says "Class 6,
 * DPS" and the counter rings up eleven books, four notebooks and a geometry box
 * — today by reading them off a sheet one at a time, which is where both the
 * time and the mistakes come from.
 *
 * The list becomes an ordinary parked bill, the same object the open-bills
 * switcher and the restaurant tables already use, so it settles through exactly
 * the same pricing, tax, tender and sync path as any other sale. Nothing about
 * a book list reaches the till as a special case.
 */

export interface OpenListResult {
  bill: HeldBill;
  /** Lines put on the bill. */
  added: number;
  /**
   * Lines that could not be: a book the shop does not stock, or one whose
   * product has since been deleted. Named so the counter can tell the parent
   * rather than silently handing over a short set.
   */
  skipped: string[];
}

/**
 * Quantity is what the list asks for, not what is on the shelf.
 *
 * Billing already refuses or warns on overselling depending on the shop's own
 * settings, and that decision belongs there. Silently trimming a line to
 * available stock here would hand the parent a short set with no one having said
 * so — the failure this feature exists to prevent.
 */
export async function openBookListInBilling(list: BookList, products: Product[]): Promise<OpenListResult> {
  const byId = new Map(products.map((product) => [product.id, product]));

  const cart: CartItem[] = [];
  const skipped: string[] = [];

  for (const item of [...list.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const product = item.productId ? byId.get(item.productId) : undefined;
    if (!product) {
      skipped.push(item.name);
      continue;
    }
    cart.push({
      product,
      quantity: Number(item.qty) || 1,
      rate: Number(product.defaultPricePerRateUnit) || 0,
      unit: product.displayUnit || product.rateUnit || item.unit || "piece",
    });
  }

  const [heldRaw, draft] = await Promise.all([
    offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
    offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY).catch(() => null),
  ]);
  let held = Array.isArray(heldRaw) ? heldRaw : [];

  // Park whatever is already in the workspace, exactly as switching tables does,
  // so loading a list never drops a half-rung sale at the counter.
  const parked = heldBillFromBillingDraft(draft);
  if (parked) held = upsertOpenBill(held, parked);

  const bill: HeldBill = {
    id: newBillId(),
    label: list.label,
    createdAt: new Date().toISOString(),
    cart,
    selectedCustomerId: "walk_in",
  };
  held = upsertOpenBill(held, bill);

  await Promise.all([
    offlineDB.setSetting(HELD_BILLS_KEY, held).catch(() => undefined),
    offlineDB.setSetting(BILLING_DRAFT_KEY, billingDraftFromHeldBill(bill)).catch(() => undefined),
  ]);

  return { bill, added: cart.length, skipped };
}
