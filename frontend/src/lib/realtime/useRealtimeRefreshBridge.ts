import { useEffect, useRef } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { shouldPassSharedThrottle, shouldRunInteractiveNetworkWork } from "@/lib/browser/multiTabCoordinator";
import { LOCAL_DATA_CHANGE_CHANNEL, isFromThisTab, type LocalDataChangeMessage } from "@/lib/offline/instant-cache";
import { refreshesOnLocalData } from "@/lib/api/query-meta";

const FAST_REFRESH_DELAY_MS = 120;
const FULL_REFRESH_DELAY_MS = 1_200;
// The sync engine announces a push's result, a pull, and the multi-device refresh
// separately, spread over about a second. Refreshed one by one, each cost a round
// of every list on screen — and the online list queries go to the server — so a
// single sale re-downloaded bills, customers and products three or four times.
const SYNC_REFRESH_WINDOW_MS = 1_000;

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
  const syncTimerRef = useRef<number | null>(null);
  const fullTimerRef = useRef<number | null>(null);
  const pendingRefetchTypeRef = useRef<"none" | "active">("none");

  useEffect(() => {
    const clearTimer = (timer: number | null) => {
      if (timer !== null) window.clearTimeout(timer);
    };

    // A query whose fetch began after the last change a refresh answers has
    // already read it. Pages refetch their own lists when they write or hear a
    // change (BillingPage after a sale, CustomersPage, BillsPage), so by the time
    // a window below closes, refetching those again sent the same request twice.
    // A counter orders fetch starts against changes exactly; a clock would tie,
    // because a page's own refetch starts in the same millisecond as the change.
    // Only changes that call for a refetch count. Outbox churn lands just after
    // a sale's own refetch began, and counting it undid the skip for that sale.
    let order = 0;
    const fetchOrder = new WeakMap<Query, number>();
    let fastSince = 0;
    let syncSince = 0;
    const unsubscribeFetches = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "fetch") fetchOrder.set(event.query, ++order);
    });
    const notFetchedSince = (since: number) => (query: Query) =>
      refreshesOnLocalData(query) && (fetchOrder.get(query) ?? 0) <= since;

    const scheduleRefresh = (
      delayMs = FAST_REFRESH_DELAY_MS,
      refetchType: "none" | "active" = "none",
    ) => {
      if (!isVisible()) return;
      // Never let a later low-priority sync-status event downgrade an already
      // scheduled active refresh from a local write.
      if (refetchType === "active") {
        pendingRefetchTypeRef.current = "active";
        fastSince = ++order;
      }
      // Coalesce into a bounded window, not a trailing debounce: a busy outbox
      // must not continually move the timer and starve a visible local edit.
      if (fastTimerRef.current !== null) return;
      fastTimerRef.current = window.setTimeout(() => {
        fastTimerRef.current = null;
        const pendingRefetchType = pendingRefetchTypeRef.current;
        pendingRefetchTypeRef.current = "none";
        // An active refresh refetches everything a pending sync refresh would.
        if (pendingRefetchType === "active") {
          clearTimer(syncTimerRef.current);
          syncTimerRef.current = null;
        }
        // A local-first WRITE refetches the queries actually on screen so every page
        // reflects an add/edit without a manual reload — not only the few pages that
        // wired their own listener. Other triggers (sync-queue churn, backend status)
        // pass refetchType "none" to just mark queries stale and avoid hammering the
        // backend. The debounce coalesces bursts and this is visibility-gated.
        // Settings and capability queries a write cannot move opt out (see
        // query-meta.ts); coming back online or into view still refreshes them.
        // A passive pass still marks everything else stale, as it always did.
        const predicate = pendingRefetchType === "active" ? notFetchedSince(fastSince) : refreshesOnLocalData;
        void queryClient.invalidateQueries({ refetchType: pendingRefetchType, predicate });
      }, delayMs);
    };

    // The sync engine's own announcements share one bounded window per burst. A
    // local write's refresh keeps its fast path and, when it runs, covers any
    // pending sync refresh too.
    const scheduleSyncRefresh = () => {
      if (!isVisible()) return;
      // Only a write's refresh can carry this announcement. The outbox's own
      // queue churn also leaves a fast refresh pending during every push, and
      // upgrading that passive one refetched every list again ahead of the window.
      if (fastTimerRef.current !== null && pendingRefetchTypeRef.current === "active") {
        fastSince = ++order;
        return;
      }
      syncSince = ++order;
      if (syncTimerRef.current !== null) return;
      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null;
        void queryClient.invalidateQueries({ refetchType: "active", predicate: notFetchedSince(syncSince) });
      }, SYNC_REFRESH_WINDOW_MS);
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

    const onLocalDataChanged = (event: Event) => {
      // Every visible tab must consume committed data, including broadcasts.
      // A shared network throttle previously downgraded the next write to
      // passive invalidation and left the UI stale until navigation/reload.
      // The per-tab window above still coalesces bursts; queue-only churn stays
      // passive and scheduled cloud recovery keeps its shared throttle.
      if ((event as CustomEvent<{ type?: string } | undefined>).detail?.type === "sync") {
        scheduleSyncRefresh();
        return;
      }
      scheduleRefresh(FAST_REFRESH_DELAY_MS, "active");
    };
    const onSyncQueueUpdated = () => scheduleRefresh();
    const channel = typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(LOCAL_DATA_CHANGE_CHANNEL)
      : null;
    if (channel) {
      channel.onmessage = (event: MessageEvent<LocalDataChangeMessage>) => {
        const message = event.data;
        // This tab already heard its own change when it was made.
        if (!message || message.source !== "kirana-local-data" || isFromThisTab(message)) return;
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
      unsubscribeFetches();
      clearTimer(fastTimerRef.current);
      clearTimer(syncTimerRef.current);
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
