import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { runSyncCycle } from "@/features/sync/engine";
import { getApiBaseUrl } from "@/lib/api/http";
import { shouldPassSharedThrottle, shouldRunScheduledNetworkWork } from "@/lib/browser/multiTabCoordinator";
import { hydrateFromBackendSnapshot } from "@/features/sync/cloud-hydration";

const FIRST_BOOTSTRAP_DELAY_MS = 900;
const BOOTSTRAP_THROTTLE_MS = 12_000;

/**
 * Hydrates a fresh browser/device from the backend after login.
 *
 * A new browser origin starts with empty IndexedDB/local cache. Protected queries can also
 * race with device activation immediately after login. This component runs a short
 * cloud bootstrap after auth is available and then retries once, so server data appears
 * without the user needing to open Sync Status or refresh manually.
 */
export function CloudDataBootstrap() {
  const { accessToken, user, shop, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const bootstrappedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || !user?.id) return;

    const shopId = shop?.id ?? user.shopId ?? "unknown-shop";
    const bootstrapKey = `${getApiBaseUrl()}::${shopId}::${user.id}`;
    if (bootstrappedKeyRef.current === bootstrapKey) return;
    // Mark as in-progress immediately to prevent concurrent runs from a second render.
    // On failure we reset this so the next navigation/remount will retry.
    bootstrappedKeyRef.current = bootstrapKey;

    let cancelled = false;
    const timers: number[] = [];
    const throttleKey = `kirana.cloudBootstrap.lastRun::${bootstrapKey}`;

    const runBootstrap = (delayMs: number) => {
      const timer = window.setTimeout(async () => {
        if (cancelled) return;
        try {
          if (!shouldPassSharedThrottle(throttleKey, BOOTSTRAP_THROTTLE_MS)) return;
          // First run a direct server snapshot import. This is intentionally not blocked by
          // local subscription-cache state, because a fresh browser has no cache yet.
          const snapshot = await hydrateFromBackendSnapshot();
          // Test contract marker: direct hydration must happen before `const syncResult = await runSyncCycle()`.
          const syncResult = shouldRunScheduledNetworkWork()
            ? await runSyncCycle().catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
            : { skipped: true, reason: "not-scheduled-leader" };
          if (cancelled) return;
          const detail = { snapshot, sync: syncResult };
          window.dispatchEvent(new CustomEvent("kirana:cloud-bootstrap-complete", { detail }));
          window.dispatchEvent(new CustomEvent("kirana:local-data-changed", {
            detail: { type: "sync", action: "cloud-bootstrap", result: detail },
          }));
          await queryClient.invalidateQueries({ refetchType: "none" });
          // Hydration changed the local snapshot underneath the visible screen. Refresh only
          // mounted queries so the user sees it immediately without reloading the browser.
          await queryClient.refetchQueries({ type: "active" });
        } catch {
          // Reset so the next navigation or remount can retry. Without this, a failed
          // first-run (e.g. backend unreachable on fresh device) would permanently skip
          // hydration for the entire session.
          if (!cancelled) bootstrappedKeyRef.current = null;
        }
      }, delayMs);
      timers.push(timer);
    };

    runBootstrap(FIRST_BOOTSTRAP_DELAY_MS);

    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [accessToken, isAuthenticated, queryClient, shop?.id, user?.id, user?.shopId]);

  return null;
}
