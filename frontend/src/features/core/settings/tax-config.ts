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
  /** Round each bill total to the nearest rupee at the counter (Taxes & GST → "Round off"). */
  roundOff: boolean;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  // Kirana counter default: MRP prices already include GST.
  mode: "inclusive",
  defaultRate: 0,
  // Nearest-rupee round-off is near-universal at an Indian counter, so it is on
  // unless the shop turns it off — matching the Taxes settings page default.
  roundOff: true,
};

const PREFS_KEY = "kirana:settings-prefs:v1";

let cache: TaxConfig = { ...DEFAULT_TAX_CONFIG };

export function getTaxConfigSync(): TaxConfig {
  return cache;
}

export function setTaxConfigCache(config: Partial<TaxConfig>) {
  const merged = { ...DEFAULT_TAX_CONFIG, ...config };
  // roundOff rides Shop.settingsJson across devices, so it arrives as untyped JSON.
  // It is sent on every bill and validated as a strict boolean by both the offline
  // validator and the server — a stray 0/1 here fails the save, not just the rounding.
  cache = { ...merged, roundOff: merged.roundOff === true, defaultRate: Number(merged.defaultRate) || 0 };
}

export async function loadTaxConfig(): Promise<TaxConfig> {
  try {
    const prefs = await offlineDB.getSetting<{ taxes?: { mode?: string; defaultRate?: string | number; roundOff?: boolean } }>(PREFS_KEY);
    const saved = prefs?.taxes ?? {};
    const mode: GstMode = saved.mode === "exclusive" || saved.mode === "none" ? saved.mode : "inclusive";
    // Absent (older saved prefs) counts as on — the settings page ships it on.
    cache = { mode, defaultRate: Number(saved.defaultRate) || 0, roundOff: saved.roundOff !== false };
  } catch {
    /* keep whatever is cached */
  }
  return cache;
}
