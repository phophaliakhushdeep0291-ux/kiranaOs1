import { useMutation, useQuery } from "@tanstack/react-query";
import { isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
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
  unit?: string;
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
    const cachedEntries = readInstantCache<InventoryLedgerDisplayEntry[]>(INVENTORY_MOVEMENTS_CACHE_KEY, []);
    return { entries: cachedEntries.slice(0, Number.isFinite(limit) ? limit : 50), total: cachedEntries.length };
  };
  const cached = readCachedLedger();
  return useQuery<InventoryLedgerResponse, ApiClientError, InventoryLedgerResponse, StockLedgerQueryKey>({
    ...extra,
    queryKey: getGetStockLedgerQueryKey(params),
    initialData: extra.initialData ?? cached,
    queryFn: async () => {
      const liveCached = readCachedLedger();
      if (!isBrowserOnline()) return liveCached;
      try {
        return await inventoryApi.getStockLedger(params) as InventoryLedgerResponse;
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
