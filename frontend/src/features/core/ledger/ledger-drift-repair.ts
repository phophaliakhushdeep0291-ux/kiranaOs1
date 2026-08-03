import { resyncUdharLedgerFromServer } from "@/features/core/sync/cloud-hydration";
import { refreshBusinessCaches } from "@/features/core/sync/sync-reconcile";
import { roundMoney } from "@/features/core/ledger/accounting";
import { toPaise } from "@/lib/money";
import type { UdharSummary } from "@/types/api";

/**
 * The device's udhar ledger is a replica of the server's. When the two disagree
 * for a customer with no unsynced local work, the replica is simply wrong — a
 * dropped pull, a dedupe that swallowed a real row, or (as reported live) an old
 * bug that left every balance at zero. Overlaying the server number at render
 * time hides it on the udhar page but leaves the bad rows on the device, so
 * every other reader — the offline view, payment guards, reports — stays wrong.
 *
 * This repairs the cause: re-pull the server's ledger snapshot, which replaces
 * the synced rows and keeps pending local work.
 */

/** A repair is a full ledger re-download, so never hammer it. */
const REPAIR_COOLDOWN_MS = 10 * 60 * 1000;

let lastRepairAt = 0;

export interface LedgerDriftCandidate {
  /** Every id the customer is known by locally (local id, server id, …). */
  ids: string[];
  /** Balance derived from this device's ledger rows. */
  localBalance: number;
  /** Whether unsynced local writes make the local value legitimately ahead. */
  hasPendingLocalWork: boolean;
}

export interface LedgerDrift {
  customerId: string;
  localBalance: number;
  serverBalance: number;
}

/** Reset between tests; also used when the active shop changes. */
export function resetLedgerDriftRepairThrottle(): void {
  lastRepairAt = 0;
}

/**
 * Customers whose local balance contradicts the server's. Customers with
 * unsynced local work are skipped: their local value is *supposed* to lead the
 * server until the outbox drains.
 */
export function detectLedgerDrift(
  candidates: LedgerDriftCandidate[],
  summary: UdharSummary,
): LedgerDrift[] {
  const serverBalances = new Map(
    summary.customers.map((customer) => [customer.customerId, Math.max(0, Number(customer.outstanding ?? 0))]),
  );
  const drifts: LedgerDrift[] = [];

  for (const candidate of candidates) {
    if (candidate.hasPendingLocalWork) continue;
    const matchedId = candidate.ids.find((id) => serverBalances.has(id));
    // Unmatched customers are settled server-side (the summary only lists
    // balances), so a non-zero local balance is still drift.
    const serverBalance = matchedId ? serverBalances.get(matchedId) ?? 0 : 0;
    const localBalance = roundMoney(candidate.localBalance);
    if (toPaise(localBalance) === toPaise(serverBalance)) continue;
    drifts.push({
      customerId: matchedId ?? candidate.ids[0] ?? "",
      localBalance,
      serverBalance,
    });
  }

  return drifts;
}

/**
 * Re-download the server's udhar ledger when drift is detected. Returns true if
 * the local ledger was actually rewritten, so the caller can reload its data.
 * Throttled — a caller that runs on every list render stays cheap.
 */
export async function repairLedgerDriftFromServer(
  candidates: LedgerDriftCandidate[],
  summary: UdharSummary,
): Promise<boolean> {
  const drifts = detectLedgerDrift(candidates, summary);
  if (drifts.length === 0) return false;
  if (Date.now() - lastRepairAt < REPAIR_COOLDOWN_MS) return false;
  lastRepairAt = Date.now();

  try {
    await resyncUdharLedgerFromServer();
    // Recomputes each customer's cached udharAmount from the repaired ledger and
    // rewrites the instant caches every other screen reads.
    await refreshBusinessCaches().catch(() => undefined);
    return true;
  } catch {
    // A failed repair must not break the page; the authoritative overlay still
    // shows the right number and the next cycle retries after the cooldown.
    lastRepairAt = 0;
    return false;
  }
}
