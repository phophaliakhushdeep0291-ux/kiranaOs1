import { loadAuthSession } from "@/lib/storage/auth-storage";

export const LOCATION_CHANGED_EVENT = "kirana:location-changed";

function storageKey(kind: "active" | "primary" = "active") {
  const session = loadAuthSession();
  const shopId = session.shop?.id ?? session.user?.shopId ?? "local";
  return `kirana:${kind}-location:${shopId}`;
}

export function getPrimaryLocationId(): string | null {
  try { return localStorage.getItem(storageKey("primary"))?.trim() || null; }
  catch { return null; }
}

export function cachePrimaryLocationId(locationId: string) {
  const normalized = locationId.trim();
  if (!normalized || getPrimaryLocationId() === normalized) return;
  try { localStorage.setItem(storageKey("primary"), normalized); } catch { return; }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LOCATION_CHANGED_EVENT, {
    detail: { locationId: getActiveLocationId(), primaryLocationId: normalized },
  }));
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
