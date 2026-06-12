import { offlineDB } from "@/lib/offline/db";
import type { GstMode } from "@/lib/gst";

/**
 * GST configuration lives in the synced settings blob
 * (kirana:settings-prefs:v1 -> .taxes, written by the Taxes & GST settings
 * page) and rides Shop.settingsJson across devices. This module mirrors the
 * printer-config pattern: an async loader plus a sync cache the billing path
 * can read without awaiting.
 */
export interface TaxConfig {
  mode: GstMode;
  defaultRate: number;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  // Kirana counter default: MRP prices already include GST.
  mode: "inclusive",
  defaultRate: 0,
};

const PREFS_KEY = "kirana:settings-prefs:v1";

let cache: TaxConfig = { ...DEFAULT_TAX_CONFIG };

export function getTaxConfigSync(): TaxConfig {
  return cache;
}

export function setTaxConfigCache(config: Partial<TaxConfig>) {
  cache = { ...DEFAULT_TAX_CONFIG, ...config };
}

export async function loadTaxConfig(): Promise<TaxConfig> {
  try {
    const prefs = await offlineDB.getSetting<{ taxes?: { mode?: string; defaultRate?: string | number } }>(PREFS_KEY);
    const saved = prefs?.taxes ?? {};
    const mode: GstMode = saved.mode === "exclusive" || saved.mode === "none" ? saved.mode : "inclusive";
    cache = { mode, defaultRate: Number(saved.defaultRate) || 0 };
  } catch {
    /* keep whatever is cached */
  }
  return cache;
}
