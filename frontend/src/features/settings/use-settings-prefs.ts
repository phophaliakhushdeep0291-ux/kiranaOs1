import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetShop } from "@/lib/api/client";
import { offlineDB } from "@/lib/offline/db";
import { getGetShopQueryKey } from "@/features/settings/queries";
import { updateShop as updateShopOnServer } from "@/features/settings/api";
import { DEFAULT_PRINTER_CONFIG, setPrinterConfigCache, type PrinterConfig } from "@/features/settings/printer-config";
import type { Shop } from "@/types/api";
import { setPaymentConfigCache } from "@/features/settings/payment-config";

export const PREFS_KEY = "kirana:settings-prefs:v1";
export const PREFS_PENDING_KEY = "kirana:settings-prefs-pending:v1";

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
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState<SettingsPrefs>({});
  const [hydrated, setHydrated] = useState(false);
  const serverLoadedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<SettingsPrefs | null>(null);
  const prefsRef = useRef<SettingsPrefs>({});

  async function persistPrefsToServer(next: SettingsPrefs): Promise<Shop | null> {
    try {
      const updated = await updateShopOnServer({ settingsJson: JSON.stringify(next) });
      queryClient.setQueryData(getGetShopQueryKey(), updated);
      await offlineDB.setSetting("shop", updated).catch(() => undefined);
      if (pendingRef.current === next) {
        pendingRef.current = null;
        await offlineDB.setSetting(PREFS_PENDING_KEY, null).catch(() => undefined);
      }
      return updated;
    } catch {
      pendingRef.current = next;
      await offlineDB.setSetting(PREFS_PENDING_KEY, next).catch(() => undefined);
      return null;
    }
  }

  useEffect(() => {
    let active = true;
    void offlineDB.getSetting<SettingsPrefs>(PREFS_KEY).then((saved) => {
      if (!active) return;
      if (saved) {
        prefsRef.current = saved;
        setPrefs(saved);
        if (saved.printer) setPrinterConfigCache({ ...DEFAULT_PRINTER_CONFIG, ...saved.printer });
        setPaymentConfigCache(saved.bank, shop.data?.name);
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
        setPrefs((p) => {
          const merged = { ...p, ...parsed };
          prefsRef.current = merged;
          void offlineDB.setSetting(PREFS_KEY, merged);
          return merged;
        });
        if (parsed.printer) setPrinterConfigCache({ ...DEFAULT_PRINTER_CONFIG, ...parsed.printer });
        setPaymentConfigCache(parsed.bank, shop.data?.name);
      }
    } catch { /* ignore malformed */ }
  }, [shop.data?.settingsJson]);

  // A failed settings write must survive reloads and a backend outage. Retry the
  // exact latest blob on reconnect and periodically while the tab remains open;
  // an older in-flight success can never clear a newer pending value.
  useEffect(() => {
    let active = true;
    void offlineDB.getSetting<SettingsPrefs>(PREFS_PENDING_KEY).then((saved) => {
      if (!active || !saved) return;
      pendingRef.current = saved;
      void persistPrefsToServer(saved);
    });
    const retry = () => {
      const pending = pendingRef.current;
      if (pending) void persistPrefsToServer(pending);
    };
    window.addEventListener("online", retry);
    const interval = window.setInterval(retry, 30_000);
    return () => {
      active = false;
      window.removeEventListener("online", retry);
      window.clearInterval(interval);
    };
  }, []);

  // Flush any pending server write on unmount so a change made just before
  // navigating away is never lost (and can't be clobbered by a stale re-load).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pendingRef.current) {
      void persistPrefsToServer(pendingRef.current);
    }
  }, []);

  function patch(partial: Partial<SettingsPrefs>, options: { immediate?: boolean } = {}): Promise<Shop | null> {
    const next = { ...prefsRef.current, ...partial };
    prefsRef.current = next;
    pendingRef.current = next;
    setPrefs(next);
    void offlineDB.setSetting(PREFS_KEY, next); // durable + instant; cheap IndexedDB put
    void offlineDB.setSetting(PREFS_PENDING_KEY, next);
    if ("printer" in partial && next.printer) setPrinterConfigCache({ ...DEFAULT_PRINTER_CONFIG, ...next.printer });
    if ("bank" in partial) setPaymentConfigCache(next.bank, shop.data?.name);
    if (timer.current) clearTimeout(timer.current);
    if (options.immediate) return persistPrefsToServer(next);
    timer.current = setTimeout(() => { void persistPrefsToServer(next); }, 700);
    return Promise.resolve(null);
  }

  return { prefs, patch, hydrated, shop: shop.data, shopLoading: shop.isLoading };
}
