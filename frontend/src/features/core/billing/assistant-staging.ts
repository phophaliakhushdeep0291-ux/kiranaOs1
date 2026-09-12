import { offlineDB } from "@/lib/offline/db";
import type { Product } from "@/lib/api/client";
import type { BillingDraft } from "./pages/billing-types";
import { mergeAssistantCart } from "./assistant-cart";

/**
 * Lines the assistant has resolved, waiting for the till to pick them up.
 *
 * The assistant is a global panel; the cart is React state inside BillingPage,
 * and the panel is hidden on the billing screen precisely so a floating button
 * never lands on the keypad mid-sale. So the two never coexist, and the handover
 * cannot be a function call.
 *
 * It is a queue rather than a write into the billing draft on purpose. Writing
 * the draft would mean re-implementing the cart merge — selling units, duplicate
 * lines, rounding — in a second place, and getting it subtly different would
 * mis-price a real bill. Instead the till drains this on mount and merges it
 * through the code it already uses for voice, which is proven and is the only
 * copy of that logic.
 *
 * Stored in IndexedDB, not memory, because the trip from the assistant to the
 * bill is a route change, and on a shop tablet it may be a reload.
 */
const STAGED_LINES_KEY = "kirana-os:assistant-bill-lines:v1";

/** A line the server resolved against the catalogue and priced. */
export interface StagedBillLine {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  rate: number;
}

interface StagedBatch {
  lines: StagedBillLine[];
  stagedAt: number;
}

// A staged batch the shopkeeper never went and billed is stale by the next
// visit, and silently adding yesterday's items to today's first sale would be
// worse than losing them.
const STAGED_MAX_AGE_MS = 30 * 60 * 1000;

export async function stageBillLines(lines: StagedBillLine[]): Promise<number> {
  const usable = (lines ?? []).filter((line) => line?.productId && Number(line.quantity) > 0);
  if (usable.length === 0) return 0;
  await offlineDB.transaction(["settings"], async (tx) => {
    const existing = await readStagedBatch();
    await tx.setSetting(STAGED_LINES_KEY, {
      lines: [...(existing?.lines ?? []), ...usable],
      stagedAt: Date.now(),
    } satisfies StagedBatch);
  });
  return usable.length;
}

async function readStagedBatch(): Promise<StagedBatch | null> {
  const batch = await offlineDB.getSetting<StagedBatch>(STAGED_LINES_KEY);
  if (!batch || !Array.isArray(batch.lines) || batch.lines.length === 0) return null;
  const age = Date.now() - Number(batch.stagedAt ?? 0);
  if (!Number.isFinite(age) || age > STAGED_MAX_AGE_MS) return null;
  return batch;
}

/**
 * Serialize queue reads and writes across counters in this browser. A failed
 * clear rolls back, so the caller cannot receive lines that remain queued.
 * This transaction does not cover the later cart/draft save.
 */
export async function takeStagedBillLines(shouldTake: () => boolean = () => true): Promise<StagedBillLine[]> {
  return offlineDB.transaction(["settings"], async (tx) => {
    const batch = await readStagedBatch();
    if (!shouldTake()) return [];
    await tx.setSetting(STAGED_LINES_KEY, { lines: [], stagedAt: 0 });
    return batch?.lines ?? [];
  });
}

export async function clearStagedBillLines(): Promise<void> {
  await offlineDB.setSetting(STAGED_LINES_KEY, { lines: [], stagedAt: 0 });
}

/** A route change or lost acknowledgement can recover the committed draft.
 * The queue is never cleared independently of the cart that receives it.
 */
export async function recoverAssistantBillingDraft(draftKey: string, products: Map<string, Product>, shouldRecover: () => boolean = () => true) {
  return offlineDB.transaction(["settings"], async tx => {
    const draft = await offlineDB.getSetting<BillingDraft>(draftKey) ?? {};
    const batch = await readStagedBatch();
    if (!shouldRecover()) return null;
    const merged = mergeAssistantCart(draft.cart ?? [], batch?.lines ?? [], products);
    const next = merged.applied.length ? { ...draft, cart: merged.cart } : draft;
    if (merged.applied.length) {
      await tx.setSetting(draftKey, next);
      await tx.setSetting(STAGED_LINES_KEY, { lines: merged.remaining, stagedAt: batch?.stagedAt ?? 0 });
      if (!shouldRecover()) throw new Error("Billing recovery cancelled");
    }
    return { draft: next, added: merged.applied.length, remaining: merged.remaining.length };
  });
}
