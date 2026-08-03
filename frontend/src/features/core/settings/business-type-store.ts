import { useSyncExternalStore } from "react";

/**
 * Which trade this shop is, and nothing else.
 *
 * Split out of `business-types.ts` on purpose: that module also carries the
 * ~11 kB of per-trade labels, categories and dashboard copy, and the vertical
 * registry — which the router imports, so it lands in the startup shell — needs
 * only the current key. Importing the whole table there put every trade's copy
 * in front of every shop's first paint.
 */
export const BUSINESS_TYPE_IDS = [
  "kirana", "clothing", "footwear", "auto_parts", "electronics",
  "pharmacy", "stationery", "furniture", "cosmetics", "restaurant", "other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPE_IDS)[number];

const KNOWN = new Set<string>(BUSINESS_TYPE_IDS);

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && KNOWN.has(value);
}

const LS_KEY = "kirana-os:ui-business-type:v1";

// Module-level reactive store: every component using useBusinessType() re-renders
// the moment the type changes (settings save, server hydration) — no reload needed.
let currentType: BusinessType = (() => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    return isBusinessType(saved) ? saved : "kirana";
  } catch {
    return "kirana";
  }
})();

const listeners = new Set<() => void>();

export function getStoredBusinessType(): BusinessType {
  return currentType;
}

export function saveBusinessType(bt: BusinessType) {
  if (!isBusinessType(bt)) return;
  currentType = bt;
  try {
    localStorage.setItem(LS_KEY, bt);
  } catch { /* private mode */ }
  listeners.forEach((notify) => notify());
}

export function subscribeToBusinessType(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

/** The key on its own, for callers that do not need the trade's copy. */
export function useBusinessTypeKey(): BusinessType {
  return useSyncExternalStore(subscribeToBusinessType, getStoredBusinessType, getStoredBusinessType);
}
