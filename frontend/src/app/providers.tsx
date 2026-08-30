import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/core/auth/AuthContext";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { ApiClientError } from "@/lib/api/http";
import { initializeOfflineStorage } from "@/lib/offline/migrations";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { activateWaitingServiceWorker, isServiceWorkerUpdateReady } from "@/lib/pwa/registerServiceWorker";
import { AppLanguageProvider } from "@/features/core/settings/i18n";
import { AppThemeProvider } from "@/features/core/settings/theme";
import { startBackgroundLeadershipHeartbeat } from "@/lib/browser/multiTabCoordinator";
import { hardenLocalFinancialData } from "@/features/core/sync/local-data-hardening";
import { autoCleanupEnabled, getAppPreferences } from "@/features/core/settings/app-preferences";
import { loadSecurityPolicy } from "@/features/core/settings/security-policy";
import { offlineDB } from "@/lib/offline/db";
import { requestPersistentOfflineStorage } from "@/features/core/sync/offline-readiness";

function shouldRetryQuery(failureCount: number, error: unknown) {
  if (error instanceof ApiClientError) {
    // Do not retry validation/auth/plan/rate-limit responses. Retrying 429s from
    // several open POS windows created a request storm during multi-device tests.
    if ([400, 401, 403, 404, 409, 422, 429].includes(error.status)) return false;
  }
  return failureCount < 1;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      // Run local IndexedDB fallbacks even when the browser is offline.
      networkMode: "always",
      staleTime: 1000 * 30,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

function scheduleFinancialHardening(): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled || document.visibilityState !== "visible") return;
    void hardenLocalFinancialData().catch(() => undefined);
    // Owner PINs left in already-settled outbox rows by builds that kept them. Rides the
    // same idle pass rather than adding a second one — neither is urgent, and both are
    // one-shot cleanups of history rather than anything this session needs.
    void offlineDB.scrubSettledOutboxSecrets().catch(() => undefined);
  };
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(run, { timeout: 8_000 });
    return () => { cancelled = true; window.cancelIdleCallback(id); };
  }
  const id = globalThis.setTimeout(run, 2_000);
  return () => { cancelled = true; globalThis.clearTimeout(id); };
}
const BackgroundRuntime = lazy(async () => {
  try {
    return await import("@/features/core/sync/BackgroundRuntime");
  } catch (error) {
    // Background refresh is recoverable and must never replace Billing with an
    // error screen. A navigation/reload retries the chunk; local reads and
    // writes remain available in the current session.
    window.dispatchEvent(new CustomEvent("kirana:background-runtime-load-failed", {
      detail: { message: error instanceof Error ? error.message : String(error) },
    }));
    return { default: () => <></> };
  }
});

export function AppProviders({ children }: { children: ReactNode }) {
  const { toast } = useToast();

  useEffect(() => {
    // Apply saved app preferences (compact density in particular) before the
    // first paint of any page, not only after Settings has been opened.
    getAppPreferences();
    void loadSecurityPolicy();
    void requestPersistentOfflineStorage().then((granted) => {
      window.dispatchEvent(new CustomEvent("kirana:offline-storage-persistence", { detail: { granted } }));
    });
    let cancelInitialHardening: () => void = () => undefined;
    void initializeOfflineStorage()
      .then(() => { cancelInitialHardening = scheduleFinancialHardening(); })
      .catch(() => {
        // Offline storage is an enhancement; the UI should still render if the browser blocks IndexedDB.
      });
    const stopLeadership = startBackgroundLeadershipHeartbeat();
    const timer = window.setInterval(() => {
      scheduleFinancialHardening();
    }, 5 * 60_000);
    // Settings → Advanced → "Auto cleanup temp files". Off means expired caches
    // and synced history are left alone until the owner runs it by hand.
    const cleanupTimer = window.setInterval(() => {
      if (!autoCleanupEnabled()) return;
      void offlineDB.pruneExpiredRecentCache().catch(() => undefined);
      void offlineDB.pruneSyncedHistory().catch(() => undefined);
    }, 10 * 60_000);
    return () => {
      window.clearInterval(timer);
      cancelInitialHardening();
      window.clearInterval(cleanupTimer);
      stopLeadership();
    };
  }, []);

  useEffect(() => {
    const onUpdateReady = () => {
      toast({
        title: "App update ready",
        description: "A fresh version is available. Finish the current bill, then refresh.",
        action: (
          <ToastAction altText="Refresh now" onClick={activateWaitingServiceWorker}>
            Refresh now
          </ToastAction>
        ),
      });
    };
    const onRegistrationFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      toast({
        title: "Offline install not available",
        description: detail?.message ? "App still works, but offline shell caching could not start." : "App still works, but offline shell caching could not start.",
      });
    };
    window.addEventListener("kirana:pwa-update-ready", onUpdateReady);
    window.addEventListener("kirana:pwa-registration-failed", onRegistrationFailed);
    // A cached installed PWA can finish finding its waiting worker before React
    // mounts (notably while the Hindi dictionary is loading). Do not lose the
    // only prompt that tells the operator to move onto the deployed build.
    if (isServiceWorkerUpdateReady()) onUpdateReady();
    return () => {
      window.removeEventListener("kirana:pwa-update-ready", onUpdateReady);
      window.removeEventListener("kirana:pwa-registration-failed", onRegistrationFailed);
    };
  }, [toast]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppThemeProvider>
          <AppLanguageProvider>
            <AuthProvider>
              <Suspense fallback={null}>
                <BackgroundRuntime />
              </Suspense>
              {children}
            </AuthProvider>
            {/* Inside the language provider, not beside it. The toast close
                button is translated, and `useAppLanguage` throws when it cannot
                find its provider — so a Toaster mounted outside took the whole
                app down to a white screen the first time anything raised a
                toast, which on a counter means the first time a bill saved. */}
            <Toaster />
          </AppLanguageProvider>
          </AppThemeProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
