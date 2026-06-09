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
import { AppLanguageProvider } from "@/features/settings/i18n";
import { useRealtimeRefreshBridge } from "@/lib/realtime/useRealtimeRefreshBridge";
import { CloudDataBootstrap } from "@/features/sync/CloudDataBootstrap";
import { useMultiDeviceSync } from "@/lib/realtime/useMultiDeviceSync";
import { startBackgroundLeadershipHeartbeat } from "@/lib/browser/multiTabCoordinator";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";

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
    void initializeOfflineStorage()
      .then(() => hardenLocalFinancialData())
      .catch(() => {
        // Offline storage is an enhancement; the UI should still render if the browser blocks IndexedDB.
      });
    const stopLeadership = startBackgroundLeadershipHeartbeat();
    const timer = window.setInterval(() => {
      void hardenLocalFinancialData().catch(() => undefined);
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      stopLeadership();
    };
  }, []);

  useEffect(() => {
    const onUpdateReady = () => {
      toast({
        title: "App update ready",
        description: "A fresh version is available. Finish the current bill, then refresh when convenient.",
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
          <AppLanguageProvider>
            <AuthProvider>
              <RealtimeRefreshBridge />
              <CloudDataBootstrap />
              {children}
            </AuthProvider>
          </AppLanguageProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
