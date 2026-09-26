import { offlineDB } from "@/lib/offline/db";
import type { Product } from "@/lib/api/client";
import type { BillingDraft, CartItem } from "./pages/billing-types";

/**
 * Parts another screen has asked the till to ring up.
 *
 * The counter conversation in a parts shop never starts with a part number. It
 * starts with "Mahindra 575 DI, 2018 — clutch plate", and the fitment book is
 * the only thing that can answer it. But the book and the bill were separate
 * screens with nothing between them: a counter hand found the right box, then
 * left, opened billing, and searched the catalogue again from memory for a name
 * they had been looking at a second earlier. On a shop with four thousand parts
 * that is where the wrong box gets sold.
 *
 * This is the hand-off. A screen queues what it found; billing rings it up.
 *
 * Three things about the shape, each of which was the alternative:
 *
 *   Ids, not cart lines. Billing owns pricing — adaptive rules, wholesale tiers,
 *   pack units, batch ceilings — and a second place building a line would be a
 *   second set of pricing rules to keep right forever. Same argument the starter
 *   catalogue makes for going through the ordinary import pipeline.
 *
 *   Its own key, not a field on the billing draft. The draft is rebuilt field by
 *   field on every save, which is exactly how a table's id used to be dropped; a
 *   queue that vanishes on the next keystroke is worse than no queue at all.
 *
 *   Committed with the draft. A part must survive interrupted navigation and
 *   must never be added twice after a reload.
 */
export const PENDING_CART_KEY = "kirana-os:billing-pending-adds:v1";

export interface PendingCartAddition {
  productId: string;
  /** Carried so billing can name what it could not find, rather than doing nothing. */
  name: string;
}

function isAddition(value: unknown): value is PendingCartAddition {
  const row = value as PendingCartAddition | null;
  return Boolean(row && typeof row.productId === "string" && row.productId);
}

/**
 * Ask billing to ring these up next time it opens.
 *
 * Appends rather than replaces: a counter may send two parts over before walking
 * to the till, and the second must not silently drop the first.
 */
export async function queueProductsForBilling(additions: PendingCartAddition[]): Promise<void> {
  const wanted = additions.filter(isAddition);
  if (wanted.length === 0) return;
  // Serialize concurrent handoffs. Read/write failures must reach the source
  // screen, which must not navigate to an empty bill or overwrite an old queue.
  await offlineDB.transaction(["settings"], async (tx) => {
    const existing = await offlineDB.getSetting<PendingCartAddition[]>(PENDING_CART_KEY);
    const queue = (Array.isArray(existing) ? existing.filter(isAddition) : []).concat(wanted);
    await tx.setSetting(PENDING_CART_KEY, queue);
  });
}

export type QueuedProductMerger = (cart: CartItem[], product: Product, draft: BillingDraft) => CartItem[] | null;

/** Save the receiving cart and consume its queue in one transaction.
 * Billing supplies its ordinary line merge/pricing function. A lost UI
 * acknowledgement recovers the committed draft; a failed write retains both
 * the original cart and queue for the hydration retry screen.
 */
export async function recoverQueuedBillingDraft(
  draftKey: string,
  products: Map<string, Product>,
  mergeProduct: QueuedProductMerger,
  shouldRecover: () => boolean = () => true,
) {
  return offlineDB.transaction(["settings"], async (tx) => {
    const draft = await offlineDB.getSetting<BillingDraft>(draftKey) ?? {};
    const stored = await offlineDB.getSetting<PendingCartAddition[]>(PENDING_CART_KEY);
    const queue = Array.isArray(stored) ? stored.filter(isAddition) : [];
    if (!shouldRecover()) return null;
    // An unavailable/empty catalogue cannot establish that a queued part was
    // removed. Retain the request for the next successful billing load.
    if (products.size === 0) return { draft, added: 0, missing: [], remaining: queue.length };
    let cart = draft.cart ?? [];
    let added = 0;
    const missing: string[] = [];
    const remaining: PendingCartAddition[] = [];
    for (const entry of queue) {
      const product = products.get(entry.productId);
      if (product) {
        const merged = mergeProduct(cart, product, draft);
        if (merged) { cart = merged; added += 1; }
        else remaining.push(entry);
      } else missing.push(entry.name || entry.productId);
    }
    const next = added ? { ...draft, cart } : draft;
    if (added || missing.length) {
      await tx.setSetting(draftKey, next);
      await tx.setSetting(PENDING_CART_KEY, remaining);
      if (!shouldRecover()) throw new Error("Billing recovery cancelled");
    }
    return { draft: next, added, missing, remaining: remaining.length };
  });
}
