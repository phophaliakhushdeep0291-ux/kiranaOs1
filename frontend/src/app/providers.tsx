import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/core/auth/AuthContext";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { ApiClientError } from "@/lib/api/http";
import { initializeOfflineStorage } from "@/lib/offline/migrations";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { activateWaitingServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { AppLanguageProvider } from "@/features/core/settings/i18n";
import { AppThemeProvider } from "@/features/core/settings/theme";
import { useRealtimeRefreshBridge } from "@/lib/realtime/useRealtimeRefreshBridge";
import { CloudDataBootstrap } from "@/features/core/sync/CloudDataBootstrap";
import { useMultiDeviceSync } from "@/lib/realtime/useMultiDeviceSync";
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
  };
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(run, { timeout: 8_000 });
    return () => { cancelled = true; window.cancelIdleCallback(id); };
  }
  const id = globalThis.setTimeout(run, 2_000);
  return () => { cancelled = true; globalThis.clearTimeout(id); };
}
function RealtimeRefreshBridge() {
  useRealtimeRefreshBridge();
  useMultiDeviceSync();
  return null;
}

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
              <RealtimeRefreshBridge />
              <CloudDataBootstrap />
              {children}
            </AuthProvider>
          </AppLanguageProvider>
          </AppThemeProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
