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
    productName: String(raw.productName ?? raw.product_name ?? product?.name ?? ""),
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

const UNSYNCED_LEDGER_STATUSES = new Set(["local_only", "pending_sync", "syncing", "failed", "conflict"]);

function isUnsyncedLedgerEntry(raw: Record<string, unknown>): boolean {
  return UNSYNCED_LEDGER_STATUSES.has(String(raw.sync_status ?? raw.syncStatus ?? raw.status ?? "").toLowerCase());
}

function ledgerProductId(raw: Record<string, unknown>): string {
  return String(raw.productId ?? raw.product_id ?? "");
}

function readCachedActiveProductIds(): Set<string> {
  const rows = [
    ...readInstantCache<Product[]>(PRODUCTS_CACHE_KEY, []),
    ...readInstantCache<InventoryItem[]>(INVENTORY_CACHE_KEY, []),
  ];
  return new Set(rows
    .filter((row) => row.deletedAt == null && (row as { deleted_at?: unknown }).deleted_at == null)
    .map((row) => String(row.id ?? ""))
    .filter(Boolean));
}

export function keepInventoryLedgerRowsWithActiveProducts(
  rows: Record<string, unknown>[],
  activeProductIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  return rows.filter((row) => {
    const productId = ledgerProductId(row);
    return productId.length > 0 && activeProductIds.has(productId);
  });
}

/**
 * Reconcile an authoritative server ledger page with local work that has not
 * reached the server yet. Synced cache rows are deliberately not carried over:
 * retaining them made a previous shop's history immortal even after a clean
 * server response and after the scoped IndexedDB tables had been repaired.
 */
export function reconcileInventoryLedgerEntries(
  localEntries: Record<string, unknown>[],
  serverEntries: Record<string, unknown>[],
  limit = 50,
): InventoryLedgerDisplayEntry[] {
  const merged = new Map<string, InventoryLedgerDisplayEntry>();
  for (const raw of localEntries) {
    if (!isUnsyncedLedgerEntry(raw)) continue;
    const entry = normalizeInventoryLedgerEntry(raw);
    if (entry.id) merged.set(entry.id, entry);
  }
  for (const raw of serverEntries) {
    const entry = normalizeInventoryLedgerEntry(raw);
    const clientMovementId = String(raw.clientMovementId ?? raw.client_movement_id ?? "");
    if (clientMovementId) merged.delete(clientMovementId);
    if (entry.id) merged.set(entry.id, entry);
  }
  return [...merged.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Number.isFinite(limit) ? limit : 50);
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

/**
 * Every identity of a product this device has deleted and not yet synced.
 *
 * Deleting is local-first, so the server keeps returning the product until the
 * outbox drains — and the two queries below take the server's answer wholesale.
 * A product deleted from the catalogue therefore went on sitting in stock, and
 * each refresh wrote it back into the cache, so it outlived the screen. The
 * products list suppresses the same rows for the same reason; this is that rule
 * on the stock side of the app.
 *
 * Keyed by every id the row is known by, because a product created on this
 * device carries the local id it was minted with while the server answers with
 * its own.
 */
async function deletedProductIdentities(): Promise<Set<string>> {
  try {
    const rows = await offlineDB.getAll<Product>("products");
    const ids = rows
      .filter((row) => row.deletedAt != null || (row as { deleted_at?: unknown }).deleted_at != null)
      .flatMap((row) => {
        const record = row as Product & { productId?: unknown; server_id?: unknown; local_id?: unknown };
        return [row.id, record.productId, record.server_id, record.local_id];
      })
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export function withoutDeletedProducts(items: InventoryItem[], deleted: Set<string>): InventoryItem[] {
  if (deleted.size === 0) return items;
  return items.filter((item) => {
    const productId = (item as InventoryItem & { productId?: unknown }).productId;
    return !(typeof productId === "string" && deleted.has(productId)) && !deleted.has(String(item.id ?? ""));
  });
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
        const fresh = withoutDeletedProducts(
          (await inventoryApi.getInventory()).map((item) => normalizeInventoryItem(item)),
          await deletedProductIdentities(),
        );
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
        return withoutDeletedProducts(
          (await inventoryApi.getLowStock()).map((item) => normalizeInventoryItem(item)),
          await deletedProductIdentities(),
        );
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
    const cachedEntries = keepInventoryLedgerRowsWithActiveProducts(
      readInstantCache<Record<string, unknown>[]>(INVENTORY_MOVEMENTS_CACHE_KEY, []),
      readCachedActiveProductIds(),
    )
      .map(normalizeInventoryLedgerEntry);
    return { entries: cachedEntries.slice(0, Number.isFinite(limit) ? limit : 50), total: cachedEntries.length };
  };
  const cached = readCachedLedger();
  return useQuery<InventoryLedgerResponse, ApiClientError, InventoryLedgerResponse, StockLedgerQueryKey>({
    ...extra,
    queryKey: getGetStockLedgerQueryKey(params),
    initialData: extra.initialData ?? cached,
    // Ledger history is security-sensitive during an account/shop switch. Paint
    // the scoped cache immediately, but always validate it against the server on
    // mount instead of allowing a recent cache write to postpone that fetch.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? 0,
    queryFn: async () => {
      const liveCached = readCachedLedger();
      if (!isBrowserOnline()) return liveCached;
      try {
        const response = await inventoryApi.getStockLedger(params) as LedgerResult<Record<string, unknown>>;
        const [indexedRows, indexedProducts] = await Promise.all([
          offlineDB.getAll<Record<string, unknown>>(INVENTORY_MOVEMENTS_CACHE_KEY).catch(() => []),
          offlineDB.getAll<Product>(PRODUCTS_CACHE_KEY).catch(() => []),
        ]);
        const activeProductIds = new Set(indexedProducts
          .filter((product) => product.deletedAt == null && (product as { deleted_at?: unknown }).deleted_at == null)
          .map((product) => String(product.id ?? ""))
          .filter(Boolean));
        const entries = reconcileInventoryLedgerEntries(
          keepInventoryLedgerRowsWithActiveProducts([...liveCached.entries, ...indexedRows], activeProductIds),
          response.entries ?? [],
          limit,
        );
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
