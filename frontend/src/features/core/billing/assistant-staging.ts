import { offlineDB } from "@/lib/offline/db";

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
  const existing = await readStagedBatch();
  const batch: StagedBatch = {
    lines: [...(existing?.lines ?? []), ...usable],
    stagedAt: Date.now(),
  };
  await offlineDB.setSetting(STAGED_LINES_KEY, batch).catch(() => undefined);
  return usable.length;
}

async function readStagedBatch(): Promise<StagedBatch | null> {
  const batch = await offlineDB.getSetting<StagedBatch>(STAGED_LINES_KEY).catch(() => null);
  if (!batch || !Array.isArray(batch.lines) || batch.lines.length === 0) return null;
  if (Date.now() - Number(batch.stagedAt ?? 0) > STAGED_MAX_AGE_MS) {
    await clearStagedBillLines();
    return null;
  }
  return batch;
}

/**
 * Take the staged lines, clearing them in the same breath.
 *
 * Read-and-clear rather than read-then-clear: a till that mounts twice, or a
 * refresh mid-merge, must not add the same items to the bill again.
 */
export async function takeStagedBillLines(): Promise<StagedBillLine[]> {
  const batch = await readStagedBatch();
  if (!batch) return [];
  await clearStagedBillLines();
  return batch.lines;
}

export async function clearStagedBillLines(): Promise<void> {
  await offlineDB.setSetting(STAGED_LINES_KEY, { lines: [], stagedAt: 0 }).catch(() => undefined);
}
