import { ApiClientError, apiRequest, buildQuery, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { instantCacheUpdatedAt, readIndexedRecentCache, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { safeRandomUUID } from "@/lib/safe-uuid";
import type { InventoryItem, LedgerResult, QueryParams, StockMovementInput } from "@/types/api";

export function getInventory() {
  return apiRequest<InventoryItem[]>("/inventory");
}

export function getLowStock() {
  return apiRequest<InventoryItem[]>("/inventory/low-stock");
}

export function getStockLedger(params?: QueryParams) {
  return apiRequest<LedgerResult<unknown>>(`/inventory/ledger${buildQuery(params)}`);
}

export function recordPurchase(data: StockMovementInput) {
  const payload = withMovementIdentity(data, "purchase");
  return apiRequest<unknown>("/inventory/purchase", {
    method: "POST",
    body: JSON.stringify(payload),
    ownerPin: data.ownerPin,
  });
}

export function recordDamage(data: StockMovementInput) {
  const payload = withMovementIdentity(data, "damage");
  return apiRequest<unknown>("/inventory/damage", {
    method: "POST",
    body: JSON.stringify(payload),
    ownerPin: data.ownerPin,
  });
}

export function stockCorrection(data: StockMovementInput) {
  const payload = withMovementIdentity(data, "correction");
  return apiRequest<unknown>("/inventory/correction", {
    method: "POST",
    body: JSON.stringify(payload),
    ownerPin: data.ownerPin,
  });
}

function withMovementIdentity(data: StockMovementInput, action: string): StockMovementInput {
  const idempotencyKey = data.idempotencyKey || `inventory:${action}:${safeRandomUUID()}`;
  return {
    ...data,
    idempotencyKey,
    clientMovementId: data.clientMovementId || idempotencyKey,
  };
}

export type StockCountStatus = "counting" | "review" | "applied" | "cancelled";

export interface StockCountLine {
  id: string;
  productId: string;
  productName: string;
  baseUnit: string;
  expectedBaseQty: number | null;
  countedBaseQty: number | null;
  varianceBaseQty: number | null;
  reason?: string | null;
  countedAt?: string | null;
}

export interface StockCountSession {
  id: string;
  name: string;
  status: StockCountStatus;
  blindCount: boolean;
  locationId: string;
  location: { id: string; name: string; code: string };
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  appliedAt?: string | null;
  cancelledAt?: string | null;
  lines: StockCountLine[];
  /**
   * Products left out because they are counted per pack size.
   *
   * A count line holds one total for the product, which says nothing about how
   * many of each pack are on the shelf, so those products cannot take part. Sent
   * on the create response only — it describes this selection, not the stored
   * count — and the shop needs it before it walks the aisle looking for a product
   * that is not on the list.
   */
  excludedPerPackProducts?: Array<{ id: string; name: string }>;
  summary: {
    totalLines: number;
    countedLines: number;
    remainingLines: number;
    varianceLines: number;
    netVarianceBaseQty: number | null;
  };
}

export const STOCK_COUNT_CACHE_KEYS = {
  list: (status: StockCountStatus | "all" = "all", limit = 30) => `stock-counts:list:v1:${status}:${limit}`,
  detail: (id: string) => `stock-counts:detail:v1:${id}`,
} as const;

async function readCachedStockCountResource<T>(path: string, cacheKey: string): Promise<T> {
  if (!isBrowserOnline()) {
    const cached = await readIndexedRecentCache<T | undefined>(cacheKey, undefined);
    if (cached !== undefined) return cached;
    throw new ApiClientError("This stock count has not been cached on this device yet.", 0, { code: "STOCK_COUNT_CACHE_MISSING" });
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

function cacheStockCountSession(session: StockCountSession) {
  writeInstantCache(STOCK_COUNT_CACHE_KEYS.detail(session.id), session);
  const listKey = STOCK_COUNT_CACHE_KEYS.list("all", 30);
  const current = readInstantCache<StockCountSession[]>(listKey, []);
  const next = [session, ...current.filter((row) => row.id !== session.id)]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 30);
  writeInstantCache(listKey, next);
  return session;
}

export function readStockCountMemoryCache<T>(cacheKey: string): T | undefined {
  return readInstantCache<T | undefined>(cacheKey, undefined);
}

export function stockCountCacheUpdatedAt(cacheKey: string) {
  return instantCacheUpdatedAt(cacheKey);
}

export function getStockCounts(status: StockCountStatus | "all" = "all", limit = 30) {
  return readCachedStockCountResource<StockCountSession[]>(`/inventory/counts${buildQuery({ status, limit })}`, STOCK_COUNT_CACHE_KEYS.list(status, limit));
}

export function getStockCount(id: string) {
  return readCachedStockCountResource<StockCountSession>(`/inventory/counts/${id}`, STOCK_COUNT_CACHE_KEYS.detail(id));
}

export async function createStockCount(data: { name: string; blindCount: boolean; productIds?: string[] }) {
  return cacheStockCountSession(await apiRequest<StockCountSession>("/inventory/counts", { method: "POST", body: JSON.stringify(data) }));
}

export async function updateStockCountLines(id: string, lines: Array<{ productId: string; countedBaseQty: number; reason?: string }>) {
  return cacheStockCountSession(await apiRequest<StockCountSession>(`/inventory/counts/${id}/lines`, { method: "PATCH", body: JSON.stringify({ lines }) }));
}

export async function submitStockCount(id: string) {
  return cacheStockCountSession(await apiRequest<StockCountSession>(`/inventory/counts/${id}/submit`, { method: "POST" }));
}

export async function decideStockCount(id: string, action: "apply" | "cancel", data: { ownerPin: string; note: string }) {
  return cacheStockCountSession(await apiRequest<StockCountSession>(`/inventory/counts/${id}/${action}`, {
    method: "POST",
    ownerPin: data.ownerPin,
    body: JSON.stringify({ ownerPin: data.ownerPin, note: data.note }),
  }));
}
