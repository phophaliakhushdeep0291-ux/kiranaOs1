import { hydrateFromBackendSnapshot, type CloudHydrationResult } from "@/features/sync/cloud-hydration";
import { runSyncCycle } from "@/features/sync/sync-engine";
import type { SyncRunResult } from "@/features/sync/sync-types";

export interface ManualSyncResult extends SyncRunResult {
  snapshot: CloudHydrationResult;
  syncError?: string;
}

/**
 * Runs a user-requested recovery sync.
 *
 * Incremental sync alone cannot repair a device whose cursor is current but
 * whose local IndexedDB snapshot is incomplete. Push local work first, then
 * replace server-backed caches from authoritative API snapshots.
 */
export async function runManualSyncCycle(): Promise<ManualSyncResult> {
  let sync: SyncRunResult = {
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
  };
  let syncError: string | undefined;
  try {
    sync = await runSyncCycle();
  } catch (error) {
    // A malformed legacy queue row must not prevent recovery of authoritative
    // server data on an otherwise healthy signed-in device.
    syncError = error instanceof Error ? error.message : String(error);
  }
  const snapshot = await hydrateFromBackendSnapshot();
  if (snapshot.errors.length > 0) {
    console.error("[KiranaOS] Snapshot recovery incomplete", snapshot.errors);
  }
  return { ...sync, snapshot, ...(syncError ? { syncError } : {}) };
}
