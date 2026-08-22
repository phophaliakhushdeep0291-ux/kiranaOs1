import { useSyncExternalStore } from "react";
import { runSyncCycle } from "@/features/core/sync/engine";
import { runManualSyncCycle } from "@/features/core/sync/manual-sync";
import { clearRetryBackoffAfterReconnect, readSyncQueueCounts, type SyncQueueCounts } from "@/features/core/sync/sync-status-repair";
import {
  probeBackendConnection,
  readBackendConnectionSnapshot,
  type BackendConnectionSnapshot,
} from "@/features/core/sync/backend-health";
import { shouldPassSharedThrottle, shouldRunScheduledNetworkWork } from "@/lib/browser/multiTabCoordinator";

const SYNC_INTERVAL_MS = 18_000;
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
};

let state: OfflineStatusState = {
  backendStatus: readBackendConnectionSnapshot(),
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  isSyncing: false,
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
    state.conflictCount === counts.conflict
  ) return;
  publish({ ...state, pendingCount: counts.pending, failedCount: counts.failed, conflictCount: counts.conflict });
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
let syncIntervalId: number | null = null;
let backendIntervalId: number | null = null;
let running = false;

async function refreshCount(): Promise<SyncQueueCounts | null> {
  try {
    const counts = await readSyncQueueCounts();
    setCounts(counts);
    return counts;
  } catch {
    // Ignore IndexedDB errors in UI status.
    return null;
  }
}

export async function syncNow(options: { manual?: boolean; hydrate?: boolean } = {}) {
  if (isSyncing) return;
  if (!options.manual && !shouldRunScheduledNetworkWork()) return;
  const connection = await probeBackendConnection({ force: options.manual });
  setBackendStatus(connection);
  if (!connection.browserOnline || !connection.backendReachable) return;
  isSyncing = true;
  setSyncing(true);
  try {
    const hydrate = options.hydrate ?? options.manual === true;
    if (hydrate) await runManualSyncCycle();
    else await runSyncCycle();
    await refreshCount();
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
    void syncNow();
  }, delayMs);
}

function handleOnline() {
  if (shouldRunScheduledNetworkWork()) void probeBackendConnection({ force: true }).then(setBackendStatus);
  scheduleSync(500);
}

function handleOffline() {
  void probeBackendConnection({ force: true }).then(setBackendStatus);
}

function handleQueueUpdated(event?: Event) {
  void refreshCount();
  // A finished sync announces itself on the same channel a local edit uses, so
  // reacting to it scheduled another sync, which announced itself, and so on.
  // `useMultiDeviceSync` already filters its own echo this way; this side did not,
  // which is what turned two schedulers into a loop. Counts still refresh above —
  // only the follow-up cycle is skipped.
  const detail = (event as CustomEvent | undefined)?.detail as { type?: string } | undefined;
  if (detail?.type === "sync") return;
  if (navigator.onLine && document.visibilityState === "visible") {
    scheduleSync(450);
    if (queueRecoveryTimer !== null) window.clearTimeout(queueRecoveryTimer);
    queueRecoveryTimer = window.setTimeout(() => {
      queueRecoveryTimer = null;
      void recoverLocalQueueIfNeeded();
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
    if (navigator.onLine) void recoverLocalQueueIfNeeded();
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
      void syncNow();
    }, 700);
  }
  bootRecoveryTimer = window.setTimeout(() => {
    bootRecoveryTimer = null;
    void recoverLocalQueueIfNeeded();
  }, 1_000);

  syncIntervalId = window.setInterval(() => {
    void refreshCount();
    if (navigator.onLine && document.visibilityState === "visible" && shouldRunScheduledNetworkWork()) void syncNow();
    if (navigator.onLine && document.visibilityState === "visible") void recoverLocalQueueIfNeeded();
  }, SYNC_INTERVAL_MS);
  backendIntervalId = window.setInterval(() => {
    if (document.visibilityState === "visible" && shouldRunScheduledNetworkWork()) void probeBackendConnection().then(setBackendStatus);
  }, BACKEND_STATUS_INTERVAL_MS);
}

function stop() {
  if (!running) return;
  running = false;

  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);
  window.removeEventListener("kirana:sync-queue-updated", handleQueueUpdated);
  window.removeEventListener("kirana:local-data-changed", handleQueueUpdated);
  window.removeEventListener("kirana:backend-status-changed", handleBackendStatus);
  document.removeEventListener("visibilitychange", handleVisibility);

  for (const timer of [scheduledSyncTimer, bootSyncTimer, bootRecoveryTimer, queueRecoveryTimer]) {
    if (timer !== null) window.clearTimeout(timer);
  }
  scheduledSyncTimer = null;
  bootSyncTimer = null;
  bootRecoveryTimer = null;
  queueRecoveryTimer = null;
  if (syncIntervalId !== null) window.clearInterval(syncIntervalId);
  if (backendIntervalId !== null) window.clearInterval(backendIntervalId);
  syncIntervalId = null;
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
    syncNow,
  };
}
