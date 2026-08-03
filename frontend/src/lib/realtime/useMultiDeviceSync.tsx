import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/core/auth/useAuth";
import { runSyncCycle } from "@/features/core/sync/engine";
import { hydrateFromBackendSnapshot } from "@/features/core/sync/cloud-hydration";
import { probeBackendConnection } from "@/features/core/sync/backend-health";
import {
  shouldPassSharedThrottle,
  shouldRunScheduledNetworkWork,
} from "@/lib/browser/multiTabCoordinator";

const SYNC_INTERVAL_MS = 8_000;
const SNAPSHOT_INTERVAL_MS = 60_000;
const FOCUS_THROTTLE_MS = 2_000;
const LOCAL_WRITE_SYNC_DELAY_MS = 250;
const CHANNEL_NAME = "kirana:multi-device-sync";

type SyncBroadcastMessage = {
  type: "sync-complete" | "cloud-import-complete";
  reason: string;
  timestamp: number;
  result?: unknown;
};

function isVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function isAuthError(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 0;
  return status === 401 || status === 403;
}

function makeChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/**
 * Keeps multiple browser tabs/devices under the same shop smooth without turning
 * every tab into a polling storm.
 *
 * - Interactive actions stay independent: any visible tab/device can create bills,
 *   open customers, or run reports.
 * - Scheduled sync is coordinated per browser profile: one visible tab pushes/pulls.
 * - Different devices/browsers still run their own light sync loop, so Device B can
 *   see a bill created on Device A after a short delay or on focus.
 * - Browser tabs use BroadcastChannel so a sync in one tab refreshes local UI in the others.
 */
export function useMultiDeviceSync() {
  const { isAuthenticated, accessToken, user, shop } = useAuth();
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const lastSnapshotAtRef = useRef(0);
  const localWriteTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || !user?.id) return;

    let disposed = false;
    const shopKey = shop?.id ?? user.shopId ?? "unknown-shop";
    const syncThrottleKey = `kirana.multiDeviceSync.lastRun::${shopKey}`;
    const focusThrottleKey = `kirana.multiDeviceSync.focusRun::${shopKey}`;
    const snapshotThrottleKey = `kirana.multiDeviceSync.snapshotRun::${shopKey}`;

    const channel = makeChannel();
    channelRef.current = channel;

    const notifyLocalRefresh = (reason: string, result?: unknown) => {
      window.dispatchEvent(new CustomEvent("kirana:local-data-changed", {
        detail: { type: "sync", action: "multi-device-refresh", reason, result },
      }));
      window.dispatchEvent(new CustomEvent("kirana:multi-device-sync-complete", {
        detail: { reason, result },
      }));
      void queryClient.invalidateQueries({ refetchType: "none" });
    };

    const postBroadcast = (message: SyncBroadcastMessage) => {
      try { channel?.postMessage(message); } catch { /* best-effort */ }
    };

    const run = async (reason: string, options: { force?: boolean; snapshot?: boolean } = {}) => {
      if (disposed || inFlightRef.current) return;
      if (!isVisible()) return;
      if (!options.force && !shouldRunScheduledNetworkWork()) return;
      if (!options.force && !shouldPassSharedThrottle(syncThrottleKey, 900)) return;

      inFlightRef.current = true;
      try {
        const connection = await probeBackendConnection();
        if (!connection.browserOnline || !connection.backendReachable) return;

        const syncResult = await runSyncCycle();
        const didWork = Boolean((syncResult.pushed ?? 0) > 0 || (syncResult.pulled ?? 0) > 0 || (syncResult.conflicts ?? 0) > 0 || (syncResult.failed ?? 0) > 0);
        if (didWork) {
          notifyLocalRefresh(reason, syncResult);
          postBroadcast({ type: "sync-complete", reason, timestamp: Date.now(), result: syncResult });
        }

        const shouldSnapshot = options.snapshot || Date.now() - lastSnapshotAtRef.current > SNAPSHOT_INTERVAL_MS;
        if (shouldSnapshot && shouldPassSharedThrottle(snapshotThrottleKey, SNAPSHOT_INTERVAL_MS)) {
          lastSnapshotAtRef.current = Date.now();
          const snapshot = await hydrateFromBackendSnapshot();
          notifyLocalRefresh(`${reason}:snapshot`, snapshot);
          postBroadcast({ type: "cloud-import-complete", reason, timestamp: Date.now(), result: snapshot });
        }
      } catch (error) {
        // Auth/device errors should not spin forever. The device activation flow will retry
        // from AuthContext/CloudDataBootstrap; this loop stays quiet until focus/next interval.
        if (!isAuthError(error)) {
          // Keep this hook silent in UI; Sync Status page remains the place for detailed errors.
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    const scheduleAfterLocalWrite = () => {
      if (localWriteTimerRef.current !== null) window.clearTimeout(localWriteTimerRef.current);
      localWriteTimerRef.current = window.setTimeout(() => {
        localWriteTimerRef.current = null;
        void run("local-write", { force: false });
      }, LOCAL_WRITE_SYNC_DELAY_MS);
    };

    const onLocalDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; action?: string }>).detail;
      // Avoid loops from our own sync completion events.
      if (detail?.action === "multi-device-refresh" || detail?.action === "pull" || detail?.action === "direct-import") return;
      scheduleAfterLocalWrite();
    };

    const onSyncQueueUpdated = () => scheduleAfterLocalWrite();
    const onOnline = () => {
      if (shouldPassSharedThrottle(focusThrottleKey, FOCUS_THROTTLE_MS)) void run("online", { force: true, snapshot: true });
    };
    const onFocus = () => {
      if (isVisible() && shouldPassSharedThrottle(focusThrottleKey, FOCUS_THROTTLE_MS)) void run("focus", { force: true });
    };
    const onVisibility = () => {
      if (isVisible()) onFocus();
    };

    if (channel) {
      channel.onmessage = (event: MessageEvent<SyncBroadcastMessage>) => {
        const message = event.data;
        if (!message || typeof message !== "object") return;
        if (message.type === "sync-complete" || message.type === "cloud-import-complete") {
          notifyLocalRefresh(`broadcast:${message.reason}`, message.result);
        }
      };
    }

    window.addEventListener("kirana:local-data-changed", onLocalDataChanged);
    window.addEventListener("kirana:sync-queue-updated", onSyncQueueUpdated);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    intervalRef.current = window.setInterval(() => {
      void run("interval");
    }, SYNC_INTERVAL_MS);

    // First visible run after login/hydration. This is intentionally force=true so the
    // second device does not wait for the interval before catching up.
    window.setTimeout(() => {
      if (!disposed) void run("initial", { force: true, snapshot: true });
    }, 450);

    return () => {
      disposed = true;
      if (localWriteTimerRef.current !== null) window.clearTimeout(localWriteTimerRef.current);
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      channelRef.current?.close();
      channelRef.current = null;
      window.removeEventListener("kirana:local-data-changed", onLocalDataChanged);
      window.removeEventListener("kirana:sync-queue-updated", onSyncQueueUpdated);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accessToken, isAuthenticated, queryClient, shop?.id, user?.id, user?.shopId]);
}
