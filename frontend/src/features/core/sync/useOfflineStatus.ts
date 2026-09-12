import { useSyncExternalStore } from "react";
import { runManualSyncCycle, runSyncCycle } from "@/features/core/sync/deferred-runtime";
import { clearRetryBackoffAfterReconnect, readSyncQueueCounts, type SyncQueueCounts } from "@/features/core/sync/sync-status-repair";
import {
  probeBackendConnection,
  readBackendConnectionSnapshot,
  type BackendConnectionSnapshot,
} from "@/features/core/sync/backend-health";
import { shouldPassSharedThrottle, shouldRunScheduledNetworkWork } from "@/lib/browser/multiTabCoordinator";
import { nextIdleStep, syncDelayForStep } from "@/features/core/sync/sync-cadence";

const BACKEND_STATUS_INTERVAL_MS = 8_000;
const LOCAL_QUEUE_RECOVERY_THROTTLE_MS = 3_000;
const LOCAL_QUEUE_RECOVERY_THROTTLE_KEY = "kirana.sync.localQueueRecovery.lastRun";

/**
 * One sync engine for the whole app, not one per component.
 *
 * `useOfflineStatus` is called from twenty places — the layout, the dashboard,
 * every vertical page, two dialogs — and most of them only want to read
 * `isOnline`. When the engine lived in the hook body, each of those mounts
 * started its OWN 18s sync interval, 8s health probe, boot sync and five event
 * listeners. Measured on an idle Products page (layout + page + import dialog =
 * three mounts): 38 sync cycles in 101 seconds, arriving in threes on the same
 * millisecond. The re-entrancy guard could not stop it, because it was a useRef
 * and therefore private to each instance.
 *
 * So the engine is module state and the hook is only a subscription. The public
 * shape is unchanged, which is what keeps all twenty call sites working.
 */

type OfflineStatusState = {
  backendStatus: BackendConnectionSnapshot;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  isSyncing: boolean;
  queueStatus: "checking" | "ready" | "error";
};

let state: OfflineStatusState = {
  backendStatus: readBackendConnectionSnapshot(),
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  isSyncing: false,
  queueStatus: "checking",
};

const subscribers = new Set<() => void>();

function publish(next: OfflineStatusState) {
  state = next;
  for (const notify of [...subscribers]) notify();
}

function setCounts(counts: SyncQueueCounts) {
  if (
    state.pendingCount === counts.pending &&
    state.failedCount === counts.failed &&
    state.conflictCount === counts.conflict && state.queueStatus === "ready"
  ) return;
  publish({ ...state, pendingCount: counts.pending, failedCount: counts.failed, conflictCount: counts.conflict, queueStatus: "ready" });
}

function setSyncing(value: boolean) {
  if (state.isSyncing === value) return;
  publish({ ...state, isSyncing: value });
}

// A probe returns a fresh object every time and checkedAt always differs, so
// comparing by reference would re-render every subscriber every eight seconds
// forever. Only the fields anyone renders count as a change.
// The connection coming back is the one moment a retry backoff is provably
// meaningless — the thing it was protecting against is gone. Clearing it here,
// rather than on the browser `online` event, is deliberate: `online` only says a
// network interface exists, while this fires when the backend actually answers.
function noteReachabilityTransition(next: BackendConnectionSnapshot) {
  const wasReachable = state.backendStatus.browserOnline && state.backendStatus.backendReachable;
  const isReachable = next.browserOnline && next.backendReachable;
  if (wasReachable || !isReachable) return;
  void clearRetryBackoffAfterReconnect().catch(() => 0);
}

function setBackendStatus(next: BackendConnectionSnapshot) {
  noteReachabilityTransition(next);
  const current = state.backendStatus;
  if (
    current.browserOnline === next.browserOnline &&
    current.backendReachable === next.backendReachable &&
    current.apiBaseUrl === next.apiBaseUrl &&
    current.error === next.error
  ) return;
  publish({ ...state, backendStatus: next });
}

let isSyncing = false;
let scheduledSyncTimer: number | null = null;
let bootSyncTimer: number | null = null;
let bootRecoveryTimer: number | null = null;
let queueRecoveryTimer: number | null = null;
let syncTimer: number | null = null;
let backendIntervalId: number | null = null;
let running = false;
let idleStep = 0;
// Set by a tick that pushed rows and left more behind: the next batch goes
// straight away instead of waiting out the ladder's fast rung.
let draining = false;

function scheduledSyncDelay() {
  return syncDelayForStep(idleStep, draining);
}

// Called whenever work appears or the connection changes, so the next attempt is
// the fast one rather than whatever the idle ramp had drifted to.
function resetSyncCadence() {
  if (idleStep === 0) return;
  idleStep = 0;
  if (running) armScheduledSync();
}

function armScheduledSync() {
  if (!running) return;
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void runScheduledTick();
  }, scheduledSyncDelay());
}

async function runScheduledTick() {
  try {
    const counts = await refreshCount();
    const hadWork = !counts || counts.totalBlocking > 0;
    const canRun = navigator.onLine && document.visibilityState === "visible";
    const pushed = canRun && shouldRunScheduledNetworkWork() ? await syncNow() : 0;
    if (canRun) await recoverLocalQueueIfNeeded();
    // syncNow refreshed the counts before returning, so this reads the queue as
    // it stands after the batch rather than costing another IndexedDB pass.
    draining = pushed > 0 && state.pendingCount > 0;
    // Step down only on a genuinely quiet tick. A tick that found work stays at
    // the top of the ladder so a queue that needs several passes gets them.
    idleStep = nextIdleStep(idleStep, hadWork);
  } catch {
    // A failed tick must not stop the loop — that is how a queue goes quiet.
    // It does drop back to the ladder: a tick that threw proved nothing about
    // progress, and retrying it in 150ms would hammer whatever just broke.
    draining = false;
  } finally {
    armScheduledSync();
  }
}

let countReadGeneration = 0;
async function refreshCount(): Promise<SyncQueueCounts | null> {
  const generation = ++countReadGeneration;
  try {
    const counts = await readSyncQueueCounts();
    if (generation !== countReadGeneration) return null;
    setCounts(counts);
    return counts;
  } catch {
    // Keep last-known counts, but never describe them as a verified empty queue.
    if (generation === countReadGeneration && state.queueStatus !== "error") {
      publish({ ...state, queueStatus: "error" });
    }
    return null;
  }
}

/** Returns how many outbox rows this cycle actually sent, which is what tells
 * the scheduler whether the queue is draining or merely backed up. */
export async function syncNow(options: { manual?: boolean; hydrate?: boolean } = {}): Promise<number> {
  if (isSyncing) return 0;
  if (!options.manual && !shouldRunScheduledNetworkWork()) return 0;
  const connection = await probeBackendConnection({ force: options.manual });
  setBackendStatus(connection);
  if (!connection.browserOnline || !connection.backendReachable) return 0;
  isSyncing = true;
  setSyncing(true);
  try {
    const hydrate = options.hydrate ?? options.manual === true;
    const result = hydrate ? await runManualSyncCycle() : await runSyncCycle();
    await refreshCount();
    return result.pushed;
  } catch (error) {
    await refreshCount();
    throw error;
  } finally {
    isSyncing = false;
    setSyncing(false);
  }
}

async function recoverLocalQueueIfNeeded() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const counts = await refreshCount();
  if (!counts || counts.totalBlocking === 0) return;
  // Check this BEFORE the shared throttle. shouldPassSharedThrottle consumes the
  // token when it passes, so winning it and then returning at the re-entrancy
  // guard would lock every other tab out of recovery for three seconds having
  // done nothing — the queue then waits for a human to press Sync.
  if (isSyncing) return;
  if (!shouldPassSharedThrottle(LOCAL_QUEUE_RECOVERY_THROTTLE_KEY, LOCAL_QUEUE_RECOVERY_THROTTLE_MS)) return;
  await syncNow({ manual: true, hydrate: false });
}

function scheduleSync(delayMs: number) {
  if (!shouldRunScheduledNetworkWork()) return;
  if (scheduledSyncTimer !== null) window.clearTimeout(scheduledSyncTimer);
  scheduledSyncTimer = window.setTimeout(() => {
    scheduledSyncTimer = null;
    void syncNow().catch(() => undefined);
  }, delayMs);
}

function handleOnline() {
  resetSyncCadence();
  if (shouldRunScheduledNetworkWork()) void probeBackendConnection({ force: true }).then(setBackendStatus);
  scheduleSync(500);
}

function handleOffline() {
  void probeBackendConnection({ force: true }).then(setBackendStatus);
}

function handleQueueUpdated(event?: Event) {
  void refreshCount();
  // The sync engine's own announcements carry `type: "sync"`: a finished push or
  // pull on kirana:local-data-changed, and every outbox status write a push makes
  // on kirana:sync-queue-updated. None is new work. Reacting scheduled another
  // cycle, which announced itself, and so on — that is what turned two schedulers
  // into a loop — and each status write alone cost a cycle with nothing to send.
  // Counts still refresh above; only the follow-up cycle is skipped. A requeue
  // that makes a row due is announced without the tag.
  const detail = (event as CustomEvent | undefined)?.detail as { type?: string } | undefined;
  if (detail?.type === "sync") return;
  // New local work: whatever the idle ramp had drifted to, the next scheduled
  // attempt should be the fast one.
  resetSyncCadence();
  if (navigator.onLine && document.visibilityState === "visible") {
    scheduleSync(450);
    if (queueRecoveryTimer !== null) window.clearTimeout(queueRecoveryTimer);
    queueRecoveryTimer = window.setTimeout(() => {
      queueRecoveryTimer = null;
      void recoverLocalQueueIfNeeded().catch(() => undefined);
    }, 900);
  }
}

function handleBackendStatus(event: Event) {
  const detail = (event as CustomEvent).detail;
  if (detail && typeof detail === "object") setBackendStatus(detail as BackendConnectionSnapshot);
}

function handleVisibility() {
  if (document.visibilityState === "visible") {
    void refreshCount();
    if (navigator.onLine) void recoverLocalQueueIfNeeded().catch(() => undefined);
  }
}

function start() {
  if (running || typeof window === "undefined") return;
  running = true;

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("kirana:sync-queue-updated", handleQueueUpdated);
  window.addEventListener("kirana:local-data-changed", handleQueueUpdated);
  window.addEventListener("kirana:backend-status-changed", handleBackendStatus);
  document.addEventListener("visibilitychange", handleVisibility);

  void refreshCount();
  if (shouldRunScheduledNetworkWork()) void probeBackendConnection({ force: true }).then(setBackendStatus);
  if ((typeof navigator === "undefined" || navigator.onLine) && shouldRunScheduledNetworkWork()) {
    bootSyncTimer = window.setTimeout(() => {
      bootSyncTimer = null;
      void syncNow().catch(() => undefined);
    }, 700);
  }
  bootRecoveryTimer = window.setTimeout(() => {
    bootRecoveryTimer = null;
    void recoverLocalQueueIfNeeded().catch(() => undefined);
  }, 1_000);

  idleStep = 0;
  armScheduledSync();
  backendIntervalId = window.setInterval(() => {
    if (document.visibilityState === "visible" && shouldRunScheduledNetworkWork()) void probeBackendConnection().then(setBackendStatus);
  }, BACKEND_STATUS_INTERVAL_MS);
}

function stop() {
  if (!running) return;
  running = false;
  countReadGeneration += 1;
  state = { ...state, queueStatus: "checking" };

  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);
  window.removeEventListener("kirana:sync-queue-updated", handleQueueUpdated);
  window.removeEventListener("kirana:local-data-changed", handleQueueUpdated);
  window.removeEventListener("kirana:backend-status-changed", handleBackendStatus);
  document.removeEventListener("visibilitychange", handleVisibility);

  for (const timer of [scheduledSyncTimer, bootSyncTimer, bootRecoveryTimer, queueRecoveryTimer, syncTimer]) {
    if (timer !== null) window.clearTimeout(timer);
  }
  scheduledSyncTimer = null;
  bootSyncTimer = null;
  bootRecoveryTimer = null;
  queueRecoveryTimer = null;
  syncTimer = null;
  idleStep = 0;
  if (backendIntervalId !== null) window.clearInterval(backendIntervalId);
  backendIntervalId = null;
}

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  start();
  return () => {
    subscribers.delete(onStoreChange);
    // Only the last listener leaving tears the engine down, so route changes and
    // dialogs opening and closing never restart it.
    if (subscribers.size === 0) stop();
  };
}

const getSnapshot = () => state;

export function useOfflineStatus() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    isOnline: snapshot.backendStatus.browserOnline && snapshot.backendStatus.backendReachable,
    isBrowserOnline: snapshot.backendStatus.browserOnline,
    isBackendReachable: snapshot.backendStatus.backendReachable,
    backendStatus: snapshot.backendStatus,
    pendingCount: snapshot.pendingCount,
    failedCount: snapshot.failedCount,
    conflictCount: snapshot.conflictCount,
    isSyncing: snapshot.isSyncing,
    queueStatus: snapshot.queueStatus,
    syncNow,
  };
}
