import { ApiClientError, apiRequest, buildQuery, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { emitLocalDataChanged, instantCacheUpdatedAt, readIndexedRecentCache, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { offlineDB } from "@/lib/offline/db";
import { getActiveLocationId } from "@/features/core/stores/location-context";

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
  /** Locally received and usable by automatic FEFO, but not selectable by server id until sync. */
  pendingSync?: boolean;
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
  list: (status = "all", expiringWithinDays?: number, locationId = getActiveLocationId() ?? "primary") => `inventory-lots:list:v1:${locationId}:${status}:${expiringWithinDays ?? "all"}`,
  alerts: (locationId = getActiveLocationId() ?? "primary") => `inventory-lots:expiry-alerts:v1:${locationId}`,
  sellable: (productId: string, locationId = getActiveLocationId() ?? "primary") => `inventory-lots:sellable:v1:${locationId}:${productId}`,
} as const;

function locationRequestOptions(locationId?: string) {
  return locationId && locationId !== "primary"
    ? { headers: { "x-location-id": locationId } }
    : undefined;
}

async function readCachedLotResource<T>(path: string, cacheKey: string, locationId?: string): Promise<T> {
  if (!isBrowserOnline()) {
    const cached = await readIndexedRecentCache<T | undefined>(cacheKey, undefined);
    if (cached !== undefined) return cached;
    throw new ApiClientError("Batch and expiry data has not been cached on this device yet.", 0, { code: "INVENTORY_LOT_CACHE_MISSING" });
  }
  try {
    const current = await apiRequest<T>(path, { background: true, ...locationRequestOptions(locationId) });
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

export const listInventoryLots = (params: { status?: string; expiringWithinDays?: number; locationId?: string } = {}) => {
  const status = params.status ?? "all";
  const locationId = params.locationId ?? getActiveLocationId() ?? "primary";
  return readCachedLotResource<InventoryLot[]>(`/inventory-lots${buildQuery({ status, expiringWithinDays: params.expiringWithinDays, limit: 500 })}`, INVENTORY_LOT_CACHE_KEYS.list(status, params.expiringWithinDays, locationId), locationId);
};
export const getExpiryAlerts = (params: { criticalDays?: number; warningDays?: number; locationId?: string } = {}) => {
  const locationId = params.locationId ?? getActiveLocationId() ?? "primary";
  return readCachedLotResource<ExpiryAlerts>(`/inventory-lots/expiry-alerts${buildQuery({ criticalDays: params.criticalDays, warningDays: params.warningDays })}`, INVENTORY_LOT_CACHE_KEYS.alerts(locationId), locationId);
};
export const listSellableBatches = (productId: string, locationId = getActiveLocationId() ?? "primary") => readCachedLotResource<SellableBatch[]>(`/inventory-lots/sellable/${productId}`, INVENTORY_LOT_CACHE_KEYS.sellable(productId, locationId), locationId);
export const changeInventoryLotStatus = (id: string, status: "active" | "quarantined" | "recalled", note: string, ownerPin: string) => apiRequest<InventoryLot>(`/inventory-lots/${id}/status`, { method: "POST", ownerPin, body: JSON.stringify({ status, note }) });

export interface SellableBatchProjectionInput {
  productId: string;
  movementType: "purchase" | "sale" | "damage" | "correction";
  quantityBaseQty: number;
  locationId?: string;
  inventoryLotId?: string;
  batchNumber?: string;
  expiresOn?: string;
  batchMrp?: number;
}

export async function loadCachedSellableBatches(productId: string, locationId?: string) {
  const key = INVENTORY_LOT_CACHE_KEYS.sellable(productId, locationId ?? getActiveLocationId() ?? "primary");
  const memory = readInventoryLotMemoryCache<SellableBatch[]>(key);
  if (memory !== undefined) return memory;
  return loadPersistedCachedSellableBatches(productId, locationId).catch(() => undefined);
}

/** Read the durable projection, bypassing memory so an active write transaction sees the latest committed value. */
export async function loadPersistedCachedSellableBatches(productId: string, locationId?: string) {
  const key = INVENTORY_LOT_CACHE_KEYS.sellable(productId, locationId ?? getActiveLocationId() ?? "primary");
  return offlineDB.getRecentCache<SellableBatch[] | undefined>(key, undefined);
}

/** Pure projection used both by post-commit UI refreshes and atomic financial writes. */
export function projectCachedSellableBatches(
  cached: SellableBatch[] | undefined,
  input: SellableBatchProjectionInput,
): SellableBatch[] | undefined {
  const quantity = Math.abs(Number(input.quantityBaseQty || 0));
  if (!(quantity > 0)) return cached;

  if (input.movementType === "purchase" && input.batchNumber && input.expiresOn) {
    const rows = cached ?? [];
    const existing = rows.find((row) => row.batchNumber === input.batchNumber && row.expiresOn.slice(0, 10) === input.expiresOn?.slice(0, 10));
    const next = existing
      ? rows.map((row) => row.id === existing.id ? { ...row, availableBaseQty: Number(row.availableBaseQty) + quantity, mrp: input.batchMrp ?? row.mrp } : row)
      : [...rows, {
        id: `local-batch:${input.productId}:${input.batchNumber}:${input.expiresOn}`,
        batchNumber: input.batchNumber,
        expiresOn: input.expiresOn,
        availableBaseQty: quantity,
        mrp: input.batchMrp ?? null,
        pendingSync: true,
      }];
    return next.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  }

  if (!cached) return undefined;
  if (input.inventoryLotId || input.batchNumber) {
    return cached.map((row) => {
      const sameBatch = input.inventoryLotId
        ? row.id === input.inventoryLotId
        : row.batchNumber === input.batchNumber
          && (!input.expiresOn || row.expiresOn.slice(0, 10) === input.expiresOn.slice(0, 10));
      return sameBatch
        ? { ...row, availableBaseQty: Math.max(0, Number(row.availableBaseQty) - quantity) }
        : row;
    }).filter((row) => row.availableBaseQty > 0);
  }
  let remaining = quantity;
  return cached.map((row) => {
    if (remaining <= 0) return row;
    const taken = Math.min(remaining, Number(row.availableBaseQty));
    remaining -= taken;
    return { ...row, availableBaseQty: Math.max(0, Number(row.availableBaseQty) - taken) };
  }).filter((row) => row.availableBaseQty > 0);
}

/**
 * Keep the counter's cached FEFO choices aligned with a local-first movement.
 * This cache is a projection, not the financial source of truth, so it is
 * written after the atomic IndexedDB movement. Under uncertainty (damage may
 * have come from quarantined stock) reducing saleable FEFO stock is the safe
 * direction: the till can temporarily understate availability but never offer
 * a batch that the local movement may already have exhausted.
 */
export async function reconcileCachedSellableBatches(input: SellableBatchProjectionInput) {
  const key = INVENTORY_LOT_CACHE_KEYS.sellable(input.productId, input.locationId ?? getActiveLocationId() ?? "primary");
  const cached = await readIndexedRecentCache<SellableBatch[] | undefined>(key, undefined);
  const next = projectCachedSellableBatches(cached, input);
  if (next === undefined || next === cached) return next;
  writeInstantCache(key, next);
  emitLocalDataChanged({ type: "inventory_lot", productId: input.productId, action: "cache-updated" });
  return next;
}
