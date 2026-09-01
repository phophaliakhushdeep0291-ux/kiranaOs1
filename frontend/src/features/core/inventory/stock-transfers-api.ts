import { ApiClientError, apiRequest, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import {
  instantCacheUpdatedAt,
  readIndexedRecentCache,
  readInstantCache,
  writeInstantCache,
} from "@/lib/offline/instant-cache";

export const STOCK_TRANSFER_CACHE_KEYS = {
  locations: "stock-transfers:locations:v1",
  transfers: "stock-transfers:ledger:v2",
  replenishment: "stock-transfers:replenishment:v1",
  locationInventory: (locationId: string) => `stock-transfers:location-inventory:v1:${locationId}`,
} as const;

async function readCachedTransferResource<T>(path: string, cacheKey: string): Promise<T> {
  if (!isBrowserOnline()) {
    const cached = await readIndexedRecentCache<T | undefined>(cacheKey, undefined);
    if (cached !== undefined) return cached;
    throw new ApiClientError("This multi-store data has not been cached on this device yet.", 0, {
      code: "STOCK_TRANSFER_CACHE_MISSING",
    });
  }

  try {
    const current = await apiRequest<T>(path, { background: true });
    writeInstantCache(cacheKey, current);
    return current;
  } catch (error) {
    if (!isRecoverableNetworkError(error)) throw error;
    const cached = await readIndexedRecentCache<T | undefined>(cacheKey, undefined);
    if (cached !== undefined) return cached;
    throw error;
  }
}

export function getStoreLocations<T>() {
  return readCachedTransferResource<T>("/stores", STOCK_TRANSFER_CACHE_KEYS.locations);
}

export function listStockTransfers<T>() {
  return readCachedTransferResource<T>("/stores/transfers?limit=100", STOCK_TRANSFER_CACHE_KEYS.transfers);
}

export function getBranchReplenishment<T>() {
  return readCachedTransferResource<T>("/stores/replenishment-suggestions", STOCK_TRANSFER_CACHE_KEYS.replenishment);
}

export function getLocationInventory<T>(locationId: string) {
  return readCachedTransferResource<T>(`/stores/${locationId}/inventory`, STOCK_TRANSFER_CACHE_KEYS.locationInventory(locationId));
}

export function readStockTransferMemoryCache<T>(cacheKey: string): T | undefined {
  return readInstantCache<T | undefined>(cacheKey, undefined);
}

export function stockTransferCacheUpdatedAt(cacheKey: string): number {
  return instantCacheUpdatedAt(cacheKey);
}

export function cacheStockTransferResource<T>(cacheKey: string, value: T): T {
  writeInstantCache(cacheKey, value);
  return value;
}
