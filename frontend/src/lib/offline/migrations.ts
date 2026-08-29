import { offlineDB } from "@/lib/offline/db";
import { hydrateInstantCacheFromIndexedDB, migrateLegacyInstantCache, RECENT_CACHE_DAYS } from "@/lib/offline/instant-cache";
import { billsRepository, customersRepository, inventoryMovementsRepository, productsRepository } from "@/lib/offline/repositories";

// The udhar summary snapshot is hydrated here too so a cold start while offline
// shows the server's balances instead of the (possibly drifted) device ledger.
const BUSINESS_CACHE_KEYS = ["products", "customers", "bills", "inventory", "udhar_authoritative_summary"] as const;
const LEGACY_ID_MAP_KEY = "kirana-os:sync-local-id-map:v1";
const LEGACY_BILLING_DRAFT_KEY = "kirana-os:billing-draft:v1";
const LEGACY_BUYING_AVG_CACHE_KEY = "kirana-os:buying-average-cache:v3";

function canUseLegacyLocalStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function removeLegacyValue(key: string): void {
  if (!canUseLegacyLocalStorage()) return;
  try { localStorage.removeItem(key); } catch { /* restricted storage */ }
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
  // This old key predates tenant scoping. There is no trustworthy way to know
  // which shop created it, so importing it into the currently logged-in shop can
  // cross-link another business's records. Discard it; sync rebuilds mappings.
  removeLegacyValue(LEGACY_ID_MAP_KEY);
}

async function migrateLegacySettingsBackedData(): Promise<void> {
  // These unscoped keys can contain a previous shop's live bill and buying data.
  // Never assign them to whichever shop happens to log in next.
  removeLegacyValue(LEGACY_BILLING_DRAFT_KEY);
  removeLegacyValue(LEGACY_BUYING_AVG_CACHE_KEY);
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
