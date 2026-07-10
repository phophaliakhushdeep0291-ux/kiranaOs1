import { offlineDB } from "@/lib/offline/db";
import { hydrateInstantCacheFromIndexedDB, migrateLegacyInstantCache, RECENT_CACHE_DAYS } from "@/lib/offline/instant-cache";
import { billsRepository, customersRepository, idMappingsRepository, inventoryMovementsRepository, productsRepository, settingsRepository } from "@/lib/offline/repositories";

const BUSINESS_CACHE_KEYS = ["products", "customers", "bills", "inventory"] as const;
const LEGACY_ID_MAP_KEY = "kirana-os:sync-local-id-map:v1";
const LEGACY_BILLING_DRAFT_KEY = "kirana-os:billing-draft:v1";
const LEGACY_BUYING_AVG_CACHE_KEY = "kirana-os:buying-average-cache:v3";

function canUseLegacyLocalStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readLegacyJson<T>(key: string): T | null {
  if (!canUseLegacyLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

async function migrateBusinessCaches(): Promise<void> {
  await migrateLegacyInstantCache([...BUSINESS_CACHE_KEYS], RECENT_CACHE_DAYS);

  const products = await offlineDB.getRecentCache<Record<string, unknown>[]>("products", []).catch(() => []);
  if (products.length > 0) await productsRepository.bulkPut(products).catch(() => undefined);

  const customers = await offlineDB.getRecentCache<Record<string, unknown>[]>("customers", []).catch(() => []);
  if (customers.length > 0) await customersRepository.bulkPut(customers).catch(() => undefined);

  const bills = await offlineDB.getRecentCache<Record<string, unknown>[]>("bills", []).catch(() => []);
  if (bills.length > 0) await billsRepository.bulkPut(bills).catch(() => undefined);

  const inventory = await offlineDB.getRecentCache<Record<string, unknown>[]>("inventory", []).catch(() => []);
  if (inventory.length > 0) await inventoryMovementsRepository.bulkPut(inventory).catch(() => undefined);
}

async function migrateLegacyIdMap(): Promise<void> {
  const map = readLegacyJson<Record<string, string>>(LEGACY_ID_MAP_KEY);
  if (map && Object.keys(map).length > 0) {
    await idMappingsRepository.putMany(map, "customer").catch(() => undefined);
  }
}

async function migrateLegacySettingsBackedData(): Promise<void> {
  const legacyBillingDraft = readLegacyJson<unknown>(LEGACY_BILLING_DRAFT_KEY);
  if (legacyBillingDraft !== null && await settingsRepository.get(LEGACY_BILLING_DRAFT_KEY) === null) {
    await settingsRepository.set(LEGACY_BILLING_DRAFT_KEY, legacyBillingDraft).catch(() => undefined);
  }

  const buyingAverageCache = readLegacyJson<unknown>(LEGACY_BUYING_AVG_CACHE_KEY);
  if (buyingAverageCache !== null && await settingsRepository.get(LEGACY_BUYING_AVG_CACHE_KEY) === null) {
    await settingsRepository.set(LEGACY_BUYING_AVG_CACHE_KEY, buyingAverageCache).catch(() => undefined);
  }
}

export async function migrateLegacyLocalStorageToDexie(): Promise<void> {
  await offlineDB.init();
  await migrateBusinessCaches();
  await migrateLegacyIdMap();
  await migrateLegacySettingsBackedData();
}

export async function initializeOfflineStorage(): Promise<void> {
  await migrateLegacyLocalStorageToDexie();
  await hydrateInstantCacheFromIndexedDB([...BUSINESS_CACHE_KEYS]);
  await offlineDB.pruneExpiredRecentCache().catch(() => undefined);
  await offlineDB.pruneSyncedHistory().catch(() => undefined);
}
