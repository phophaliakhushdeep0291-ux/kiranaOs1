import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { shouldPassSharedThrottle, shouldRunInteractiveNetworkWork } from "@/lib/browser/multiTabCoordinator";
import { LOCAL_DATA_CHANGE_CHANNEL, type LocalDataChangeMessage } from "@/lib/offline/instant-cache";

const FAST_REFRESH_DELAY_MS = 250;
const FULL_REFRESH_DELAY_MS = 1_200;

function isVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Keeps all visible pages reactive to local-first writes, outbox state changes,
 * backend status changes, and sync completion. Without this bridge, some screens
 * can keep showing React Query's previous snapshot until a manual browser refresh.
 */
export function useRealtimeRefreshBridge() {
  const queryClient = useQueryClient();
  const fastTimerRef = useRef<number | null>(null);
  const fullTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = (timer: number | null) => {
      if (timer !== null) window.clearTimeout(timer);
    };

    const scheduleRefresh = (delayMs = FAST_REFRESH_DELAY_MS) => {
      if (!isVisible()) return;
      clearTimer(fastTimerRef.current);
      fastTimerRef.current = window.setTimeout(() => {
        fastTimerRef.current = null;
        // Mark local-first queries stale without immediately hammering the backend.
        // Pages that listen to local events still update instantly from IndexedDB.
        void queryClient.invalidateQueries({ refetchType: "none" });
      }, delayMs);
    };

    const scheduleFullRefresh = () => {
      if (!isVisible() || !shouldRunInteractiveNetworkWork()) return;
      // Multiple visible POS windows are allowed to do their own work, but active
      // query refetches are coalesced across tabs to avoid a dashboard request storm.
      if (!shouldPassSharedThrottle("kirana.activeQueryRefresh.lastRun", 2_500)) return;
      clearTimer(fullTimerRef.current);
      fullTimerRef.current = window.setTimeout(() => {
        fullTimerRef.current = null;
        void queryClient.invalidateQueries({ refetchType: "active" });
      }, FULL_REFRESH_DELAY_MS);
    };

    const onLocalDataChanged = () => scheduleRefresh();
    const onSyncQueueUpdated = () => scheduleRefresh();
    const channel = typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(LOCAL_DATA_CHANGE_CHANNEL)
      : null;
    if (channel) {
      channel.onmessage = (event: MessageEvent<LocalDataChangeMessage>) => {
        const message = event.data;
        if (!message || message.source !== "kirana-local-data") return;
        window.dispatchEvent(new CustomEvent("kirana:local-data-changed", {
          detail: { ...(message.detail ?? {}), source: "broadcast" },
        }));
      };
    }
    let lastBackendReachable: boolean | null = null;
    const onBackendStatusChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ backendReachable?: boolean }>).detail;
      const reachable = Boolean(detail?.backendReachable);
      if (reachable && lastBackendReachable === false) scheduleFullRefresh();
      else scheduleRefresh();
      lastBackendReachable = reachable;
    };
    const onOnline = () => scheduleFullRefresh();
    const onVisibility = () => {
      if (isVisible()) scheduleFullRefresh();
    };

    window.addEventListener("kirana:local-data-changed", onLocalDataChanged);
    window.addEventListener("kirana:sync-queue-updated", onSyncQueueUpdated);
    window.addEventListener("kirana:backend-status-changed", onBackendStatusChanged);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimer(fastTimerRef.current);
      clearTimer(fullTimerRef.current);
      channel?.close();
      window.removeEventListener("kirana:local-data-changed", onLocalDataChanged);
      window.removeEventListener("kirana:sync-queue-updated", onSyncQueueUpdated);
      window.removeEventListener("kirana:backend-status-changed", onBackendStatusChanged);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queryClient]);
}
