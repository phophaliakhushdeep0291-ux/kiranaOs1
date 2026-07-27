import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/AuthContext";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { ApiClientError } from "@/lib/api/http";
import { initializeOfflineStorage } from "@/lib/offline/migrations";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { activateWaitingServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { AppLanguageProvider } from "@/features/settings/i18n";
import { AppThemeProvider } from "@/features/settings/theme";
import { useRealtimeRefreshBridge } from "@/lib/realtime/useRealtimeRefreshBridge";
import { CloudDataBootstrap } from "@/features/sync/CloudDataBootstrap";
import { useMultiDeviceSync } from "@/lib/realtime/useMultiDeviceSync";
import { startBackgroundLeadershipHeartbeat } from "@/lib/browser/multiTabCoordinator";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";
import { autoCleanupEnabled, getAppPreferences } from "@/features/settings/app-preferences";
import { loadSecurityPolicy } from "@/features/settings/security-policy";
import { offlineDB } from "@/lib/offline/db";

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
      staleTime: 1000 * 30,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

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
    void initializeOfflineStorage()
      .then(() => hardenLocalFinancialData())
      .catch(() => {
        // Offline storage is an enhancement; the UI should still render if the browser blocks IndexedDB.
      });
    const stopLeadership = startBackgroundLeadershipHeartbeat();
    const timer = window.setInterval(() => {
      void hardenLocalFinancialData().catch(() => undefined);
    }, 30_000);
    // Settings → Advanced → "Auto cleanup temp files". Off means expired caches
    // and synced history are left alone until the owner runs it by hand.
    const cleanupTimer = window.setInterval(() => {
      if (!autoCleanupEnabled()) return;
      void offlineDB.pruneExpiredRecentCache().catch(() => undefined);
      void offlineDB.pruneSyncedHistory().catch(() => undefined);
    }, 10 * 60_000);
    return () => {
      window.clearInterval(timer);
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
