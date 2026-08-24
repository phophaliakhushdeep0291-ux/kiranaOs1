import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { instantCacheUpdatedAt, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { offlineDB } from "@/lib/offline/db";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as inventoryApi from "@/features/core/inventory/api";
import { recordDamageLocalFirst, recordPurchaseLocalFirst, recordSaleLocalFirst, stockCorrectionLocalFirst } from "@/features/core/inventory/local-actions";
import { normalizeInventoryItem } from "@/features/core/inventory/stock-display";
import type { InventoryItem, LedgerResult, Product, QueryParams, StockMovementInput } from "@/types/api";

const INVENTORY_CACHE_KEY = "inventory";
const PRODUCTS_CACHE_KEY = "products";
const INVENTORY_MOVEMENTS_CACHE_KEY = "inventory_movements";

export interface InventoryLedgerDisplayEntry extends Record<string, unknown> {
  id: string;
  productName?: string;
  action?: string;
  quantityDelta?: number;
  stockBefore?: number;
  stockAfter?: number;
  unit?: string;
  actorUserId?: string | null;
  actorName?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  note?: string;
  createdAt: string;
}
export type InventoryResponse = InventoryItem[];
export type InventoryLedgerResponse = LedgerResult<InventoryLedgerDisplayEntry>;
export type StockMovementVariables = { data: StockMovementInput };

export const getGetInventoryQueryKey = () => ["inventory"] as const;
export const getGetLowStockQueryKey = () => ["inventory", "low-stock"] as const;
export const getGetStockLedgerQueryKey = (params?: QueryParams) => ["inventory", "ledger", params ?? {}] as const;

type InventoryQueryKey = ReturnType<typeof getGetInventoryQueryKey>;
type LowStockQueryKey = ReturnType<typeof getGetLowStockQueryKey>;
type StockLedgerQueryKey = ReturnType<typeof getGetStockLedgerQueryKey>;

export function normalizeInventoryLedgerEntry(raw: Record<string, unknown>): InventoryLedgerDisplayEntry {
  const product = raw.product && typeof raw.product === "object"
    ? raw.product as Record<string, unknown>
    : null;
  return {
    ...raw,
    id: String(raw.id ?? raw.clientMovementId ?? raw.client_movement_id ?? ""),
    productName: String(raw.productName ?? raw.product_name ?? ""),
    action: String(raw.action ?? raw.type ?? "movement"),
    quantityDelta: Number(raw.quantityDelta ?? raw.quantity_delta ?? raw.changeBaseQty ?? 0),
    stockBefore: Number(raw.stockBefore ?? raw.stock_before ?? raw.oldStockBaseQty ?? 0),
    stockAfter: Number(raw.stockAfter ?? raw.stock_after ?? raw.newStockBaseQty ?? 0),
    unit: String(raw.unit ?? raw.baseUnit ?? product?.baseUnit ?? ""),
    actorUserId: raw.actorUserId as string | null | undefined ?? raw.actor_user_id as string | null | undefined ?? null,
    actorName: raw.actorName as string | null | undefined ?? raw.actor_name as string | null | undefined ?? null,
    sourceType: raw.sourceType as string | null | undefined ?? raw.source_type as string | null | undefined ?? null,
    sourceId: raw.sourceId as string | null | undefined ?? raw.source_id as string | null | undefined ?? null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date(0).toISOString()),
    sync_status: raw.sync_status ?? "synced",
  };
}

function readCachedInventory(): InventoryItem[] {
  return readInstantCache<InventoryItem[]>(INVENTORY_CACHE_KEY, readInstantCache<Product[]>(PRODUCTS_CACHE_KEY, []) as InventoryItem[])
    .map((item) => normalizeInventoryItem(item));
}

function productRowsToInventory(rows: Product[]): InventoryItem[] {
  return rows
    .filter((product) => product.deletedAt == null && (product as { deleted_at?: unknown }).deleted_at == null)
    .map((product) => normalizeInventoryItem(product));
}

async function readInventoryFromIndexedDB(): Promise<InventoryItem[]> {
  try {
    return productRowsToInventory(await offlineDB.getAll<Product>("products"));
  } catch {
    return [];
  }
}

export function useGetInventory(options?: QueryHookOptions<InventoryResponse, InventoryQueryKey>) {
  const extra = getQueryOptions<InventoryResponse, InventoryQueryKey>(options);
  const cached = readCachedInventory();
  return useQuery<InventoryResponse, ApiClientError, InventoryResponse, InventoryQueryKey>({
    ...extra,
    queryKey: getGetInventoryQueryKey(),
    initialData: extra.initialData ?? (cached.length > 0 ? cached : undefined),
    // Dated so the cached rows paint instantly without posing as the server's
    // answer: undated initialData counts as fresh from now, so nothing refetches
    // until staleTime lapses and the screen stays pinned to the cache.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(INVENTORY_CACHE_KEY),
    queryFn: async () => {
      const liveCached = readCachedInventory();
      if (liveCached.length === 0) {
        const fromDB = await readInventoryFromIndexedDB();
        if (fromDB.length > 0) {
          writeInstantCache(INVENTORY_CACHE_KEY, fromDB);
          return fromDB;
        }
      }
      if (!isBrowserOnline()) {
        if (liveCached.length > 0) return liveCached;
        const fromDB = await readInventoryFromIndexedDB();
        if (fromDB.length > 0) writeInstantCache(INVENTORY_CACHE_KEY, fromDB);
        return fromDB;
      }
      try {
        const fresh = (await inventoryApi.getInventory()).map((item) => normalizeInventoryItem(item));
        writeInstantCache(INVENTORY_CACHE_KEY, fresh);
        return fresh;
      } catch (error) {
        if (liveCached.length > 0) return liveCached;
        if (isRecoverableNetworkError(error)) {
          const fromDB = await readInventoryFromIndexedDB();
          if (fromDB.length > 0) {
            writeInstantCache(INVENTORY_CACHE_KEY, fromDB);
            return fromDB;
          }
          return liveCached;
        }
        throw error;
      }
    },
  });
}

function readCachedLowStock(): InventoryItem[] {
  return readCachedInventory()
    .filter((item) => Number(item.stockBaseQty ?? 0) <= Number(item.lowStockThreshold ?? 0));
}

async function readLowStockFromIndexedDB(): Promise<InventoryItem[]> {
  return (await readInventoryFromIndexedDB())
    .filter((item) => Number(item.stockBaseQty ?? 0) <= Number(item.lowStockThreshold ?? 0));
}

export function useGetLowStock(options?: QueryHookOptions<InventoryResponse, LowStockQueryKey>) {
  const extra = getQueryOptions<InventoryResponse, LowStockQueryKey>(options);
  const cached = readCachedLowStock();
  return useQuery<InventoryResponse, ApiClientError, InventoryResponse, LowStockQueryKey>({
    ...extra,
    queryKey: getGetLowStockQueryKey(),
    initialData: extra.initialData ?? (cached.length > 0 ? cached : undefined),
    // Dated so the cached rows paint instantly without posing as the server's
    // answer: undated initialData counts as fresh from now, so nothing refetches
    // until staleTime lapses and the screen stays pinned to the cache.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(INVENTORY_CACHE_KEY),
    queryFn: async () => {
      const liveCached = readCachedLowStock();
      if (liveCached.length === 0) {
        const fromDB = await readLowStockFromIndexedDB();
        if (fromDB.length > 0) return fromDB;
      }
      if (!isBrowserOnline()) {
        if (liveCached.length > 0) return liveCached;
        return readLowStockFromIndexedDB();
      }
      try {
        return (await inventoryApi.getLowStock()).map((item) => normalizeInventoryItem(item));
      } catch (error) {
        if (liveCached.length > 0) return liveCached;
        if (isRecoverableNetworkError(error)) return readLowStockFromIndexedDB();
        throw error;
      }
    },
  });
}

export function useGetStockLedger(
  params?: QueryParams,
  options?: QueryHookOptions<InventoryLedgerResponse, StockLedgerQueryKey>,
) {
  const extra = getQueryOptions<InventoryLedgerResponse, StockLedgerQueryKey>(options);
  const limit = Number(params?.limit ?? 50);
  const readCachedLedger = () => {
    const cachedEntries = readInstantCache<Record<string, unknown>[]>(INVENTORY_MOVEMENTS_CACHE_KEY, [])
      .map(normalizeInventoryLedgerEntry);
    return { entries: cachedEntries.slice(0, Number.isFinite(limit) ? limit : 50), total: cachedEntries.length };
  };
  const cached = readCachedLedger();
  return useQuery<InventoryLedgerResponse, ApiClientError, InventoryLedgerResponse, StockLedgerQueryKey>({
    ...extra,
    queryKey: getGetStockLedgerQueryKey(params),
    initialData: extra.initialData ?? cached,
    // Dated so the cached rows paint instantly without posing as the server's
    // answer: undated initialData counts as fresh from now, so nothing refetches
    // until staleTime lapses and the screen stays pinned to the cache.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(INVENTORY_MOVEMENTS_CACHE_KEY),
    queryFn: async () => {
      const liveCached = readCachedLedger();
      if (!isBrowserOnline()) return liveCached;
      try {
        const response = await inventoryApi.getStockLedger(params) as LedgerResult<Record<string, unknown>>;
        const merged = new Map(liveCached.entries.map((entry) => [entry.id, entry]));
        for (const raw of response.entries ?? []) {
          const entry = normalizeInventoryLedgerEntry(raw);
          const clientMovementId = String(raw.clientMovementId ?? raw.client_movement_id ?? "");
          if (clientMovementId) merged.delete(clientMovementId);
          merged.set(entry.id, entry);
        }
        const entries = [...merged.values()]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, Number.isFinite(limit) ? limit : 50);
        writeInstantCache(INVENTORY_MOVEMENTS_CACHE_KEY, entries);
        return { ...response, entries, total: Math.max(response.total ?? 0, entries.length) };
      } catch (error) {
        if (liveCached.entries.length > 0 || isRecoverableNetworkError(error)) return liveCached;
        throw error;
      }
    },
  });
}

export function useRecordPurchase(options?: MutationHookOptions<unknown, StockMovementVariables>) {
  return useMutation<unknown, ApiClientError, StockMovementVariables>({
    ...getMutationOptions<unknown, StockMovementVariables>(options),
    mutationFn: ({ data }) => recordPurchaseLocalFirst(data),
  });
}

export function useRecordDamage(options?: MutationHookOptions<unknown, StockMovementVariables>) {
  return useMutation<unknown, ApiClientError, StockMovementVariables>({
    ...getMutationOptions<unknown, StockMovementVariables>(options),
    mutationFn: ({ data }) => recordDamageLocalFirst(data),
  });
}

export function useRecordSale(options?: MutationHookOptions<unknown, StockMovementVariables>) {
  return useMutation<unknown, ApiClientError, StockMovementVariables>({
    ...getMutationOptions<unknown, StockMovementVariables>(options),
    mutationFn: ({ data }) => recordSaleLocalFirst(data),
  });
}

export function useStockCorrection(options?: MutationHookOptions<unknown, StockMovementVariables>) {
  return useMutation<unknown, ApiClientError, StockMovementVariables>({
    ...getMutationOptions<unknown, StockMovementVariables>(options),
    mutationFn: ({ data }) => stockCorrectionLocalFirst(data),
  });
}
