import { dexieDB, offlineDB } from "@/lib/offline/db";
import { getLicenseEvaluation, listCachedDevices } from "@/features/core/devices/license";
import { getStoredBusinessType, type BusinessType } from "@/features/core/settings/business-type-store";
import { buildId } from "@/features/core/settings/app-info";

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
  offlineLicenseState: "valid" | "grace" | "missing" | "invalid" | "expired";
  billingAllowed: boolean;
  currentDeviceStatus: string | null;
  warnings: string[];
}

async function readStorageHealth() {
  const manager = typeof navigator !== "undefined" ? navigator.storage : undefined;
  const persistentStorageSupported = Boolean(manager?.persisted && manager?.persist);
  const [rawEstimate, persisted] = await Promise.all([
    manager?.estimate?.().catch(() => ({})) ?? Promise.resolve({}),
    manager?.persisted?.().catch(() => false) ?? Promise.resolve(false),
  ]);
  const estimate = rawEstimate as StorageEstimate;
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
const OFFLINE_VERTICAL_BY_BUSINESS_TYPE: Partial<Record<BusinessType, string>> = {
  clothing: "clothing", footwear: "footwear", auto_parts: "auto-parts",
  electronics: "electronics", pharmacy: "pharmacy", stationery: "stationery-books",
  furniture: "furniture-home", cosmetics: "beauty-cosmetics", restaurant: "restaurant",
};

  if (typeof window === "undefined" || !("caches" in window)) return false;
  try {
    const keys = await window.caches.keys();
    const shellKeys = keys.filter((key) => key.startsWith("kiranaos-shell"));
    for (const key of shellKeys) {
      const cache = await window.caches.open(key);
      const requests = await cache.keys();
      const paths = new Set(requests.map((request) => new URL(request.url).pathname));
      const hasRequiredShell = ["/index.html", "/manifest.webmanifest", "/offline.html"]
        .every((path) => paths.has(path));
      const hasScript = [...paths].some((path) => path.endsWith(".js"));
      const hasStyles = [...paths].some((path) => path.endsWith(".css"));
      const verticalId = OFFLINE_VERTICAL_BY_BUSINESS_TYPE[getStoredBusinessType()];
      const hasActiveVertical = !verticalId || paths.has(`/__offline/vertical/${verticalId}/${buildId()}`);
      if (hasRequiredShell && hasScript && hasStyles && hasActiveVertical) return true;
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

  const [storage, appShellCached, license, devices] = await Promise.all([
    readStorageHealth(),
    isAppShellCached(),
    getLicenseEvaluation().catch(() => null),
    listCachedDevices().catch(() => []),
  ]);
  const currentDevice = devices.find((device) => device.is_current_device) ?? null;
  const offlineLicenseState = license?.state ?? "missing";
  const billingAllowed = license?.billingAllowed ?? true;
  const currentDeviceStatus = currentDevice?.status ?? null;
  const deviceTrusted = currentDeviceStatus === "active";
  const warnings: string[] = [];
  if (!databaseAvailable) warnings.push("Local database is unavailable; do not continue offline billing.");
  if (!appShellCached) warnings.push("The app shell or this shop type's screens are not yet cached for an offline restart.");
  if (storage.persistentStorageSupported && !storage.persistentStorageGranted) warnings.push("Browser storage is not protected from automatic cleanup.");
  if ((storage.storageUsageRatio ?? 0) >= 0.85) warnings.push("Browser storage is more than 85% full.");
  if (productCount === 0) warnings.push("No products are cached on this device yet.");
  if (offlineLicenseState === "missing") warnings.push("No signed offline licence is cached; refresh it while internet is available.");
  if (!billingAllowed) warnings.push("The cached offline licence does not currently allow new billing.");
  if (!currentDeviceStatus) warnings.push("This device has not been activated for offline billing.");
  else if (!deviceTrusted) warnings.push(`This device is ${currentDeviceStatus} and cannot be trusted for offline billing.`);

  const state: OfflineReadinessState = !databaseAvailable || !appShellCached || !billingAllowed || !deviceTrusted
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
    offlineLicenseState,
    billingAllowed,
    currentDeviceStatus,
    warnings,
  };
}
