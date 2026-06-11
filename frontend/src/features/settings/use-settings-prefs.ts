import { useEffect, useRef, useState } from "react";
import { useGetShop, useUpdateShop } from "@/lib/api/client";
import { offlineDB } from "@/lib/offline/db";
import { DEFAULT_PRINTER_CONFIG, setPrinterConfigCache, type PrinterConfig } from "@/features/settings/printer-config";

export const PREFS_KEY = "kirana:settings-prefs:v1";

/**
 * The whole Settings module persists its preferences inside one synced blob
 * (Shop.settingsJson, mirrored to IndexedDB). Keys are loosely typed so each
 * tab can own its own nested section without a central schema churn.
 */
export interface SettingsPrefs {
  printer?: Partial<PrinterConfig>;
  gstMode?: string;
  gstRate?: string;
  storeProfile?: Record<string, unknown>;
  branding?: Record<string, unknown>;
  hours?: Record<string, unknown>;
  bank?: Record<string, unknown>;
  docs?: Record<string, unknown>;
  security?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  integrations?: Record<string, unknown>;
  advanced?: Record<string, unknown>;
  printPreview?: boolean;
  eInvoice?: boolean;
  hsnTracking?: boolean;
  autoSync?: boolean;
  dailyBackup?: boolean;
  biometric?: boolean;
  twoFactor?: boolean;
  sessionTimeout?: string;
  lowStock?: boolean;
  paymentReminders?: boolean;
  dailySummary?: boolean;
  promotions?: boolean;
  [key: string]: unknown;
}

/**
 * Loads the settings blob (IndexedDB instantly, server as source of truth on
 * first load) and returns a `patch` that writes through to both, debouncing the
 * server sync. Keeps the printer print-path cache fresh whenever printer changes.
 */
export function useSettingsPrefs() {
  const shop = useGetShop();
  const save = useUpdateShop({ mutation: { onError: () => undefined } });
  const [prefs, setPrefs] = useState<SettingsPrefs>({});
  const [hydrated, setHydrated] = useState(false);
  const serverLoadedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<SettingsPrefs | null>(null);

  useEffect(() => {
    let active = true;
    void offlineDB.getSetting<SettingsPrefs>(PREFS_KEY).then((saved) => {
      if (!active) return;
      if (saved) {
        setPrefs(saved);
        if (saved.printer) setPrinterConfigCache({ ...DEFAULT_PRINTER_CONFIG, ...saved.printer });
      }
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (serverLoadedRef.current) return;
    const raw = shop.data?.settingsJson;
    if (raw == null) return;
    serverLoadedRef.current = true;
    try {
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object") {
        setPrefs((p) => ({ ...p, ...parsed }));
        if (parsed.printer) setPrinterConfigCache({ ...DEFAULT_PRINTER_CONFIG, ...parsed.printer });
        void offlineDB.setSetting(PREFS_KEY, parsed);
      }
    } catch { /* ignore malformed */ }
  }, [shop.data?.settingsJson]);

  // Flush any pending server write on unmount so a change made just before
  // navigating away is never lost (and can't be clobbered by a stale re-load).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pendingRef.current) {
      save.mutate({ data: { settingsJson: JSON.stringify(pendingRef.current) } });
      pendingRef.current = null;
    }
  }, []);

  function patch(partial: Partial<SettingsPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      pendingRef.current = next;
      void offlineDB.setSetting(PREFS_KEY, next); // durable + instant; cheap IndexedDB put
      if ("printer" in partial && next.printer) setPrinterConfigCache({ ...DEFAULT_PRINTER_CONFIG, ...next.printer });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { save.mutate({ data: { settingsJson: JSON.stringify(next) } }); pendingRef.current = null; }, 700);
      return next;
    });
  }

  return { prefs, patch, hydrated, shop: shop.data, shopLoading: shop.isLoading };
}
