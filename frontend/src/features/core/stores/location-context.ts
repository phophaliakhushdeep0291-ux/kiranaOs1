import { loadAuthSession } from "@/lib/storage/auth-storage";

export const LOCATION_CHANGED_EVENT = "kirana:location-changed";

function storageKey(kind: "active" | "primary" | "count" = "active") {
  const session = loadAuthSession();
  const shopId = session.shop?.id ?? session.user?.shopId ?? "local";
  return `kirana:${kind}-location:${shopId}`;
}

export function getPrimaryLocationId(): string | null {
  try { return localStorage.getItem(storageKey("primary"))?.trim() || null; }
  catch { return null; }
}

/**
 * True only when the shop is known to have exactly one location, counting
 * inactive ones: a branch that still holds stock changes what the primary has.
 * Unknown — before `/stores` has answered on this device, or when it answered
 * for a user who sees only some locations — is not single.
 */
export function isSingleLocationShop(): boolean {
  try { return localStorage.getItem(storageKey("count")) === "1"; }
  catch { return false; }
}

/** `null` when the answer cannot speak for the whole shop (an access-scoped user). */
export function cacheLocationCount(count: number | null) {
  try {
    const key = storageKey("count");
    if (count === null || !Number.isInteger(count) || count < 1) localStorage.removeItem(key);
    else if (localStorage.getItem(key) !== String(count)) localStorage.setItem(key, String(count));
  } catch { /* storage is best effort; unknown reads as more than one */ }
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
