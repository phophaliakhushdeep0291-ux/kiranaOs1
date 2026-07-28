import { dexieDB, offlineDB } from "@/lib/offline/db";

export type OfflineReadinessState = "ready" | "degraded" | "not_ready";

export interface OfflineReadinessSnapshot {
  state: OfflineReadinessState;
  checkedAt: string;
  databaseAvailable: boolean;
  appShellCached: boolean;
  persistentStorageSupported: boolean;
  persistentStorageGranted: boolean | null;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  storageUsageRatio: number | null;
  productCount: number;
  customerCount: number;
  pendingSyncCount: number;
  warnings: string[];
}

async function readStorageHealth() {
  const manager = typeof navigator !== "undefined" ? navigator.storage : undefined;
  const persistentStorageSupported = Boolean(manager?.persisted && manager?.persist);
  const [estimate, persisted] = await Promise.all([
    manager?.estimate?.().catch(() => ({})) ?? Promise.resolve({}),
    manager?.persisted?.().catch(() => false) ?? Promise.resolve(false),
  ]);
  const usage = typeof estimate.usage === "number" ? estimate.usage : null;
  const quota = typeof estimate.quota === "number" ? estimate.quota : null;
  return {
    persistentStorageSupported,
    persistentStorageGranted: persistentStorageSupported ? persisted : null,
    storageUsageBytes: usage,
    storageQuotaBytes: quota,
    storageUsageRatio: usage !== null && quota ? usage / quota : null,
  };
}

async function isAppShellCached(): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) return false;
  try {
    const keys = await window.caches.keys();
    const shellKeys = keys.filter((key) => key.startsWith("kiranaos-shell"));
    for (const key of shellKeys) {
      const cache = await window.caches.open(key);
      if ((await cache.match("/index.html")) || (await cache.match("/"))) return true;
    }
  } catch {
    // Cache Storage can be unavailable in private or restricted browser modes.
  }
  return false;
}

export async function requestPersistentOfflineStorage(): Promise<boolean | null> {
  const manager = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!manager?.persist) return null;
  try {
    if (await manager.persisted?.()) return true;
    return await manager.persist();
  } catch {
    return false;
  }
}

export async function readOfflineReadiness(): Promise<OfflineReadinessSnapshot> {
  let databaseAvailable = false;
  let productCount = 0;
  let customerCount = 0;
  let pendingSyncCount = 0;
  try {
    await dexieDB.open();
    databaseAvailable = true;
    [productCount, customerCount, pendingSyncCount] = await Promise.all([
      offlineDB.getAll("products").then((rows) => rows.length),
      offlineDB.getAll("customers").then((rows) => rows.length),
      offlineDB.getPendingCount(),
    ]);
  } catch {
    databaseAvailable = false;
  }

  const [storage, appShellCached] = await Promise.all([readStorageHealth(), isAppShellCached()]);
  const warnings: string[] = [];
  if (!databaseAvailable) warnings.push("Local database is unavailable; do not continue offline billing.");
  if (!appShellCached) warnings.push("The complete app shell has not been verified for an offline restart.");
  if (storage.persistentStorageSupported && !storage.persistentStorageGranted) warnings.push("Browser storage is not protected from automatic cleanup.");
  if ((storage.storageUsageRatio ?? 0) >= 0.85) warnings.push("Browser storage is more than 85% full.");
  if (productCount === 0) warnings.push("No products are cached on this device yet.");

  const state: OfflineReadinessState = !databaseAvailable || !appShellCached
    ? "not_ready"
    : warnings.length > 0
      ? "degraded"
      : "ready";

  return {
    state,
    checkedAt: new Date().toISOString(),
    databaseAvailable,
    appShellCached,
    ...storage,
    productCount,
    customerCount,
    pendingSyncCount,
    warnings,
  };
}