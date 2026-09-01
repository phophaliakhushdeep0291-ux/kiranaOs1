import { ApiClientError, apiRequest, buildQuery, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { instantCacheUpdatedAt, readIndexedRecentCache, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";

export interface InventoryLot {
  id: string;
  batchNumber: string;
  manufacturedOn?: string | null;
  expiresOn: string;
  receivedBaseQty: number;
  availableBaseQty: number;
  costPerRateUnit: number;
  status: "active" | "depleted" | "quarantined" | "recalled";
  note?: string | null;
  product: { id: string; name: string; baseUnit: string; rateUnit: string };
  location: { id: string; name: string; code: string };
}

/** One batch the counter may dispense from, in the FEFO order the till itself uses. */
export interface SellableBatch {
  id: string;
  batchNumber: string;
  expiresOn: string;
  availableBaseQty: number;
  /** The MRP printed on this batch's pack. Null means the product's MRP applies. */
  mrp: number | null;
}

export type ExpirySeverity = "expired" | "critical" | "warning";

/** One batch close enough to expiry to act on, with what it would cost to lose. */
export interface ExpiringBatch {
  id: string;
  batchNumber: string;
  expiresOn: string;
  availableBaseQty: number;
  mrp: number | null;
  daysUntilExpiry: number;
  severity: ExpirySeverity;
  /** What the shop paid for what is still on the shelf. */
  valueAtRisk: number;
  product: { id: string; name: string; baseUnit: string; rateUnit: string };
  location: { id: string; name: string; code: string };
}

export interface ExpiryAlerts {
  calculationVersion: string;
  thresholds: { criticalDays: number; warningDays: number };
  buckets: Record<ExpirySeverity, { count: number; valueAtRisk: number }>;
  totalCount: number;
  totalValueAtRisk: number;
  /** Already sorted soonest-first, so a card can take the head of the list. */
  batches: ExpiringBatch[];
}

export const INVENTORY_LOT_CACHE_KEYS = {
  list: (status = "all", expiringWithinDays?: number) => `inventory-lots:list:v1:${status}:${expiringWithinDays ?? "all"}`,
  alerts: "inventory-lots:expiry-alerts:v1",
} as const;

async function readCachedLotResource<T>(path: string, cacheKey: string): Promise<T> {
  if (!isBrowserOnline()) {
    const cached = await readIndexedRecentCache<T | undefined>(cacheKey, undefined);
    if (cached !== undefined) return cached;
    throw new ApiClientError("Batch and expiry data has not been cached on this device yet.", 0, { code: "INVENTORY_LOT_CACHE_MISSING" });
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

export function readInventoryLotMemoryCache<T>(cacheKey: string): T | undefined {
  return readInstantCache<T | undefined>(cacheKey, undefined);
}

export function inventoryLotCacheUpdatedAt(cacheKey: string) {
  return instantCacheUpdatedAt(cacheKey);
}

export function cacheInventoryLotResource<T>(cacheKey: string, value: T): T {
  writeInstantCache(cacheKey, value);
  return value;
}

export const listInventoryLots = (params: { status?: string; expiringWithinDays?: number } = {}) => {
  const status = params.status ?? "all";
  return readCachedLotResource<InventoryLot[]>(`/inventory-lots${buildQuery({ status, expiringWithinDays: params.expiringWithinDays, limit: 500 })}`, INVENTORY_LOT_CACHE_KEYS.list(status, params.expiringWithinDays));
};
export const getExpiryAlerts = (params: { criticalDays?: number; warningDays?: number } = {}) => readCachedLotResource<ExpiryAlerts>(`/inventory-lots/expiry-alerts${buildQuery({ criticalDays: params.criticalDays, warningDays: params.warningDays })}`, INVENTORY_LOT_CACHE_KEYS.alerts);
export const listSellableBatches = (productId: string) => apiRequest<SellableBatch[]>(`/inventory-lots/sellable/${productId}`);
export const changeInventoryLotStatus = (id: string, status: "active" | "quarantined" | "recalled", note: string, ownerPin: string) => apiRequest<InventoryLot>(`/inventory-lots/${id}/status`, { method: "POST", ownerPin, body: JSON.stringify({ status, note }) });
