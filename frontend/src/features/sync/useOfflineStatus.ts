import { useState, useEffect, useCallback, useRef } from "react";
import { runSyncCycle } from "@/features/sync/engine";
import { readSyncQueueCounts, type SyncQueueCounts } from "@/features/sync/sync-status-repair";
import { probeBackendConnection, readBackendConnectionSnapshot } from "@/features/sync/backend-health";
import { shouldPassSharedThrottle, shouldRunScheduledNetworkWork } from "@/lib/browser/multiTabCoordinator";

const SYNC_INTERVAL_MS = 60_000;
const BACKEND_STATUS_INTERVAL_MS = 20_000;
const LOCAL_QUEUE_RECOVERY_THROTTLE_MS = 12_000;
const LOCAL_QUEUE_RECOVERY_THROTTLE_KEY = "kirana.sync.localQueueRecovery.lastRun";

export function useOfflineStatus() {
  const [backendStatus, setBackendStatus] = useState(() => readBackendConnectionSnapshot());
  const isOnline = backendStatus.browserOnline && backendStatus.backendReachable;
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);
  const scheduledSyncTimerRef = useRef<number | null>(null);

  const refreshCount = useCallback(async (): Promise<SyncQueueCounts | null> => {
    try {
      const counts = await readSyncQueueCounts();
      setPendingCount(counts.pending);
      setFailedCount(counts.failed);
      setConflictCount(counts.conflict);
      return counts;
    } catch {
      // Ignore IndexedDB errors in UI status.
      return null;
    }
  }, []);

  const syncNow = useCallback(async (options: { manual?: boolean } = {}) => {
    if (isSyncingRef.current) return;
    if (!options.manual && !shouldRunScheduledNetworkWork()) return;
    const connection = await probeBackendConnection({ force: options.manual });
    setBackendStatus(connection);
    if (!connection.browserOnline || !connection.backendReachable) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      await runSyncCycle();
      await refreshCount();
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [refreshCount]);

  const recoverLocalQueueIfNeeded = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const counts = await refreshCount();
    if (!counts || counts.totalBlocking === 0) return;
    if (!shouldPassSharedThrottle(LOCAL_QUEUE_RECOVERY_THROTTLE_KEY, LOCAL_QUEUE_RECOVERY_THROTTLE_MS)) return;
    await syncNow({ manual: true });
  }, [refreshCount, syncNow]);

  useEffect(() => {
    const scheduleSync = (delayMs: number) => {
      if (!shouldRunScheduledNetworkWork()) return;
      if (scheduledSyncTimerRef.current !== null) window.clearTimeout(scheduledSyncTimerRef.current);
      scheduledSyncTimerRef.current = window.setTimeout(() => {
        scheduledSyncTimerRef.current = null;
        void syncNow();
      }, delayMs);
    };

    const handleOnline = () => {
      if (shouldRunScheduledNetworkWork()) void probeBackendConnection({ force: true }).then(setBackendStatus);
      scheduleSync(1_500);
    };
    const handleOffline = () => {
      void probeBackendConnection({ force: true }).then(setBackendStatus);
    };
    const handleQueueUpdated = () => {
      void refreshCount();
      if (navigator.onLine && document.visibilityState === "visible") {
        scheduleSync(2_000);
        window.setTimeout(() => void recoverLocalQueueIfNeeded(), 2_500);
      }
    };
    const handleBackendStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && typeof detail === "object") setBackendStatus(detail);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshCount();
        if (navigator.onLine) void recoverLocalQueueIfNeeded();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("kirana:sync-queue-updated", handleQueueUpdated);
    window.addEventListener("kirana:local-data-changed", handleQueueUpdated);
    window.addEventListener("kirana:backend-status-changed", handleBackendStatus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("kirana:sync-queue-updated", handleQueueUpdated);
      window.removeEventListener("kirana:local-data-changed", handleQueueUpdated);
      window.removeEventListener("kirana:backend-status-changed", handleBackendStatus);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (scheduledSyncTimerRef.current !== null) window.clearTimeout(scheduledSyncTimerRef.current);
    };
  }, [recoverLocalQueueIfNeeded, refreshCount, syncNow]);

  useEffect(() => {
    void refreshCount();
    if (shouldRunScheduledNetworkWork()) void probeBackendConnection({ force: true }).then(setBackendStatus);
    if ((typeof navigator === "undefined" || navigator.onLine) && shouldRunScheduledNetworkWork()) {
      window.setTimeout(() => void syncNow(), 2_000);
    }
    window.setTimeout(() => void recoverLocalQueueIfNeeded(), 2_400);
    const interval = window.setInterval(() => {
      void refreshCount();
      if (navigator.onLine && document.visibilityState === "visible" && shouldRunScheduledNetworkWork()) void syncNow();
      if (navigator.onLine && document.visibilityState === "visible") void recoverLocalQueueIfNeeded();
    }, SYNC_INTERVAL_MS);
    const backendInterval = window.setInterval(() => {
      if (document.visibilityState === "visible" && shouldRunScheduledNetworkWork()) void probeBackendConnection().then(setBackendStatus);
    }, BACKEND_STATUS_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(backendInterval);
    };
  }, [recoverLocalQueueIfNeeded, refreshCount, syncNow]);

  return {
    isOnline,
    isBrowserOnline: backendStatus.browserOnline,
    isBackendReachable: backendStatus.backendReachable,
    backendStatus,
    pendingCount,
    failedCount,
    conflictCount,
    isSyncing,
    syncNow,
  };
}
