import { loadAuthSession } from "@/lib/storage/auth-storage";

export const LOCATION_CHANGED_EVENT = "kirana:location-changed";

function storageKey() {
  const session = loadAuthSession();
  const shopId = session.shop?.id ?? session.user?.shopId ?? "local";
  return `kirana:active-location:${shopId}`;
}

export function getActiveLocationId(): string | null {
  try {
    const value = localStorage.getItem(storageKey());
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function setActiveLocationId(locationId: string) {
  const normalized = String(locationId || "").trim();
  if (!normalized) return;
  try { localStorage.setItem(storageKey(), normalized); } catch { /* storage is best effort */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LOCATION_CHANGED_EVENT, { detail: { locationId: normalized } }));
}

