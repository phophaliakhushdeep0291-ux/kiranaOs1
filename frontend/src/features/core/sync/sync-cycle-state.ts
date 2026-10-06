/**
 * Whether a sync cycle is running in this tab, and when the last one finished.
 *
 * Written by the sync engine, read by the scheduler in useOfflineStatus, which
 * must not import the engine (it is loaded lazily). A sale used to cost the
 * selling counter four full cycles — the push, then three more that found
 * nothing — because each trigger of the same write ran its own: the multi-device
 * hook's 250ms local-write run, the scheduler's 450ms one chained behind it, and
 * the fast rungs of the cadence reset. Kept free of imports, like
 * live-stream-state.ts.
 */

let inFlight = 0;
let lastFinishedAt = Number.NEGATIVE_INFINITY;

export function markSyncCycleStarted(): void {
  inFlight += 1;
}

export function markSyncCycleFinished(): void {
  inFlight = Math.max(0, inFlight - 1);
  lastFinishedAt = Date.now();
}

export function isSyncCycleInFlight(): boolean {
  return inFlight > 0;
}

export function msSinceLastSyncCycle(): number {
  return Date.now() - lastFinishedAt;
}
