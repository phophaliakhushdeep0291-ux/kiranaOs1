import type { CloudHydrationResult } from "@/features/core/sync/cloud-hydration";
import type { ManualSyncResult } from "@/features/core/sync/manual-sync";
import type { SyncRunResult } from "@/features/core/sync/sync-types";

/**
 * Loads the heavy reconciliation runtime only when network work actually starts.
 *
 * The shell still opens IndexedDB, reads queue counts and reports connectivity
 * immediately. Push/pull reconciliation is not needed to paint the first route,
 * and eagerly importing it pulled bill reconciliation, cloud hydration and
 * remote-support execution into every cold start—including a fully offline one.
 */
export async function runSyncCycle(): Promise<SyncRunResult> {
  const runtime = await import("@/features/core/sync/sync-engine");
  return runtime.runSyncCycle();
}

export async function runManualSyncCycle(): Promise<ManualSyncResult> {
  const runtime = await import("@/features/core/sync/manual-sync");
  return runtime.runManualSyncCycle();
}

export async function hydrateFromBackendSnapshot(): Promise<CloudHydrationResult> {
  const runtime = await import("@/features/core/sync/cloud-hydration");
  return runtime.hydrateFromBackendSnapshot();
}
