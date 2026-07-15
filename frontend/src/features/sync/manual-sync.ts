import { hydrateFromBackendSnapshot, type CloudHydrationResult } from "@/features/sync/cloud-hydration";
import { runSyncCycle } from "@/features/sync/sync-engine";
import type { SyncRunResult } from "@/features/sync/sync-types";

export interface ManualSyncResult extends SyncRunResult {
  snapshot: CloudHydrationResult;
}

/**
 * Runs a user-requested recovery sync.
 *
 * Incremental sync alone cannot repair a device whose cursor is current but
 * whose local IndexedDB snapshot is incomplete. Push local work first, then
 * replace server-backed caches from authoritative API snapshots.
 */
export async function runManualSyncCycle(): Promise<ManualSyncResult> {
  const sync = await runSyncCycle();
  const snapshot = await hydrateFromBackendSnapshot();
  return { ...sync, snapshot };
}
