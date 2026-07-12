// Offline-first pricing rules: fetch the shop's ACTIVE rules when online, cache
// them to IndexedDB, and expose them (normalized to engine rules) for the
// billing pricing evaluation. When offline, billing reads the last cached copy;
// with no cache it simply falls back to the product's built-in tiers. Same
// online-first + read-cache pattern as the offers/catalog features.

import { useEffect, useMemo, useState } from "react";
import { offlineDB } from "@/lib/offline/db";
import { listPricingRules, type ApiPricingRule } from "./api";
import { normalizeApiRule } from "./resolve-line-price";
import type { PricingRule } from "./engine/types";

const CACHE_KEY = "kirana-os:pricing-rules:v1";

async function readCache(): Promise<ApiPricingRule[]> {
  const rows = await offlineDB.getSetting<ApiPricingRule[]>(CACHE_KEY).catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

async function writeCache(rows: ApiPricingRule[]): Promise<void> {
  await offlineDB.setSetting(CACHE_KEY, rows).catch(() => undefined);
}

/** Refresh the cache from the server (best-effort; keeps old cache on failure). */
export async function refreshPricingRulesCache(): Promise<ApiPricingRule[]> {
  try {
    const res = await listPricingRules("ACTIVE");
    const rows = res.rules ?? [];
    await writeCache(rows);
    return rows;
  } catch {
    return readCache();
  }
}

/**
 * Live shop pricing rules for billing. Reads the cache immediately (offline-safe)
 * and revalidates from the server in the background. Returns engine-normalized
 * rules ready for resolveLinePrice.
 */
export function useShopPricingRules(): { rules: PricingRule[]; refresh: () => void } {
  const [rows, setRows] = useState<ApiPricingRule[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void readCache().then((cached) => { if (active) setRows(cached); });
    void refreshPricingRulesCache().then((fresh) => { if (active) setRows(fresh); });
    return () => { active = false; };
  }, [tick]);

  const rules = useMemo(
    () => rows.map(normalizeApiRule).filter((r): r is PricingRule => r != null),
    [rows],
  );
  return { rules, refresh: () => setTick((t) => t + 1) };
}
