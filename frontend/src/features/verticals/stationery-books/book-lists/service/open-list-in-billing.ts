import { offlineDB } from "@/lib/offline/db";
import {
  BILLING_DRAFT_KEY,
  HELD_BILLS_KEY,
  billingDraftFromHeldBill,
  heldBillFromBillingDraft,
  newBillId,
  upsertOpenBill,
  wouldEvictOpenBill,
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

  if (cart.length === 0) throw new Error("None of this list's products are available. Check the catalogue before billing this set.");

  const bill: HeldBill = {
    id: newBillId(),
    label: list.label,
    createdAt: new Date().toISOString(),
    cart,
    selectedCustomerId: "walk_in",
  };
  await offlineDB.transaction(["settings"], async (tx) => {
    const [heldRaw, draft] = await Promise.all([
      offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY),
      offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY),
    ]);
    let held = Array.isArray(heldRaw) ? heldRaw : [];
    // Preserve both the current sale and every parked sale. The normal upsert
    // caps the list, so refuse this transition before it could evict a cart.
    const parked = heldBillFromBillingDraft(draft);
    for (const next of [parked, bill]) {
      if (!next) continue;
      if (wouldEvictOpenBill(held, next)) throw new Error("Finish or close an open bill before starting another book set.");
      held = upsertOpenBill(held, next);
    }
    await tx.setSetting(HELD_BILLS_KEY, held);
    await tx.setSetting(BILLING_DRAFT_KEY, billingDraftFromHeldBill(bill));
  });

  return { bill, added: cart.length, skipped };
}
