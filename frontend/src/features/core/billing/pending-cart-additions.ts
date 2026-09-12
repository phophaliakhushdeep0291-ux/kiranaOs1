import { offlineDB } from "@/lib/offline/db";

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
 *   Read once and cleared. A part must land on the bill the counter walked over
 *   to, not on every bill after it.
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
  const existing = await offlineDB.getSetting<PendingCartAddition[]>(PENDING_CART_KEY).catch(() => null);
  const queue = (Array.isArray(existing) ? existing.filter(isAddition) : []).concat(wanted);
  await offlineDB.setSetting(PENDING_CART_KEY, queue).catch(() => undefined);
}

/**
 * Everything queued, cleared as it is handed over.
 *
 * Cleared even when billing cannot find one of the products: leaving it would
 * mean an unfindable part re-announcing itself on every bill for the rest of the
 * day. Billing says so once instead.
 */
export async function takeQueuedProducts(): Promise<PendingCartAddition[]> {
  const stored = await offlineDB.getSetting<PendingCartAddition[]>(PENDING_CART_KEY).catch(() => null);
  const queue = Array.isArray(stored) ? stored.filter(isAddition) : [];
  if (queue.length > 0) await offlineDB.delete("settings", PENDING_CART_KEY).catch(() => undefined);
  return queue;
}
