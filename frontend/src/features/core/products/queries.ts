import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { instantCacheUpdatedAt, KEEP_EVERY_ROW, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { offlineDB } from "@/lib/offline/db";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as productsApi from "@/features/core/products/api";
import { createProductLocalFirst, deleteProductLocalFirst, updateProductLocalFirst } from "@/features/core/products/local-actions";
import type { Product, ProductInput, QueryParams } from "@/types/api";
import { getActiveLocationId } from "@/features/core/stores/location-context";

const PRODUCTS_CACHE_KEY = "products";

export type ListProductsParams = QueryParams;
export type ListProductsResponse = Product[];
export interface CreateProductVariables { data: ProductInput }
export interface UpdateProductVariables { id: string; data: ProductInput }
export interface DeleteProductVariables { id: string; ownerPin: string; reason?: string }

export const getListProductsQueryKey = (params?: ListProductsParams) => ["products", getActiveLocationId() ?? "company", params ?? {}] as const;

type ListProductsQueryKey = ReturnType<typeof getListProductsQueryKey>;

function filterCachedProducts(products: Product[], params?: ListProductsParams): Product[] {
  const q = String(params?.search ?? "").trim().toLowerCase();
  const activeProducts = products.filter((p) => p.deletedAt == null && (p as { deleted_at?: unknown }).deleted_at == null);
  const limit = Number(params?.limit ?? activeProducts.length);
  const filtered = q
    ? activeProducts.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.aliases?.some((alias) => alias.toLowerCase().includes(q)),
      )
    : activeProducts;
  return filtered.slice(0, Number.isFinite(limit) && limit > 0 ? limit : filtered.length);
}

function productsCacheKey(): string {
  return `${PRODUCTS_CACHE_KEY}:${getActiveLocationId() ?? "company"}`;
}

export async function cacheProducts(products: Product[]) {
  // KEEP_EVERY_ROW, not the default 30-day window: a catalogue is master data,
  // and a product nobody has edited in a month is still on the shelf. Pruning it
  // here quietly deleted it from the billing screen until the next hard reload.
  writeInstantCache(productsCacheKey(), products, KEEP_EVERY_ROW);
  try {
    await offlineDB.putMany("products", products);
  } catch {
    // LocalStorage cache is still available for instant paint.
  }
}

function readCachedProducts(params?: ListProductsParams): Product[] {
  return filterCachedProducts(readInstantCache<Product[]>(productsCacheKey(), []), params);
}

function isProductTombstone(row: Product): boolean {
  return row.deletedAt != null || (row as Product & { deleted_at?: unknown }).deleted_at != null;
}

function productsForActiveLocation(rows: Product[]): Product[] {
  const locationId = getActiveLocationId();
  return locationId && rows.some((row) => Boolean((row as Product & { inventoryLocationId?: string }).inventoryLocationId))
    ? rows.filter((row) => (row as Product & { inventoryLocationId?: string }).inventoryLocationId === locationId)
    : rows;
}

/**
 * The local catalogue, split into what the screen shows and what it must suppress.
 *
 * Both halves come out of one `getAll`. The list query needs both on every fetch,
 * and reading the table twice to get them doubles the deserialisation cost of a
 * few thousand rows on the cheap Android phones this runs on.
 *
 * The tombstones are the reason this returns a pair at all. Deletion is
 * local-first: the row is marked deleted in IndexedDB and the delete goes to the
 * outbox, so the server keeps listing the product until that queue drains. Every
 * other reader here strips deleted rows, which is right for a list about to be
 * rendered and wrong for one about to be merged with the server's answer — the
 * tombstone is the only thing in that merge that knows the product is gone.
 * Without it the live server row won, the deleted product came back to the
 * catalogue, and cacheProducts then wrote it over the local deletion so the
 * resurrection outlived a reload.
 *
 * Tombstones are deliberately not filtered by `params`: one is not a row anybody
 * displays, it is a row that suppresses one, and a search or limit that hid it
 * would let the product back onto the very screen doing the searching.
 */
async function readLocalProductState(params?: ListProductsParams): Promise<{ active: Product[]; tombstones: Product[] }> {
  try {
    const rows = await offlineDB.getAll<Product>("products");
    return {
      active: filterCachedProducts(productsForActiveLocation(rows), params),
      tombstones: rows.filter(isProductTombstone),
    };
  } catch {
    return { active: [], tombstones: [] };
  }
}

async function readProductsFromIndexedDB(params?: ListProductsParams): Promise<Product[]> {
  return (await readLocalProductState(params)).active;
}

/**
 * The whole catalogue, with no display limit — for exports.
 *
 * The list query carries a `limit` for the screen, and `filterCachedProducts` slices
 * the cached seed to the same number. That is right for a paginated table and wrong
 * for an export, whose entire job is to carry a catalogue to another shop: a shop
 * with more products than the limit would get a short file and no hint of it, which
 * is the worst way for a migration tool to fail.
 *
 * Server first because it is authoritative and returns everything (the products list
 * endpoint applies no `take`). The local store when there is no network, so exporting
 * offline still yields the full catalogue rather than one page of it.
 */
export async function loadProductsForExport(): Promise<Product[]> {
  try {
    return await productsApi.listProducts();
  } catch {
    return await readProductsFromIndexedDB();
  }
}

/**
 * Every id this row can be recognised by.
 *
 * `clientProductId` is what makes a just-created product one product rather than
 * two: the device keys its own row by the id it minted, the server answers with
 * its OWN id, and the only thing tying them together is the client id the server
 * echoes back. Without it both rows were added, so the catalogue listed the
 * product twice and `cacheProducts` wrote both copies to IndexedDB, where they
 * survived a reload until the create was finally acknowledged.
 */
function productKeys(product: Product): string[] {
  const row = product as Product & {
    productId?: unknown; local_id?: unknown; server_id?: unknown; localId?: unknown; serverId?: unknown;
    clientProductId?: unknown; client_product_id?: unknown;
  };
  return [
    product.id,
    row.productId,
    row.local_id,
    row.server_id,
    row.localId,
    row.serverId,
    row.clientProductId,
    row.client_product_id,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function isDeviceOwnedProduct(product: Product): boolean {
  const row = product as Product & { demo_data?: unknown; sync_status?: unknown; server_id?: unknown; serverId?: unknown };
  if (row.demo_data === true || product.id.startsWith("demo_") || product.id.startsWith("local_")) return true;
  if (typeof row.server_id === "string" || typeof row.serverId === "string") {
    return ["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(String(row.sync_status ?? "").toLowerCase());
  }
  return ["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(String(row.sync_status ?? "").toLowerCase());
}

export function mergeProducts(serverRows: Product[], localRows: Product[], retainSyncedLocal = false): Product[] {
  const rows: Product[] = [];
  const keyToIndex = new Map<string, number>();
  const add = (product: Product) => {
    const keys = productKeys(product);
    const index = keys.map((key) => keyToIndex.get(key)).find((value): value is number => value !== undefined);
    if (index === undefined) {
      const nextIndex = rows.push(product) - 1;
      keys.forEach((key) => keyToIndex.set(key, nextIndex));
      return;
    }
    rows[index] = { ...rows[index], ...product };
    productKeys(rows[index]).forEach((key) => keyToIndex.set(key, index));
  };

  serverRows.forEach(add);
  for (const local of localRows) {
    if (!retainSyncedLocal && !isDeviceOwnedProduct(local)) continue;
    const deleted = local.deletedAt != null || (local as Product & { deleted_at?: unknown }).deleted_at != null;
    if (deleted) {
      const indexes = productKeys(local).map((key) => keyToIndex.get(key)).filter((value): value is number => value !== undefined);
      // A tombstone that matches nothing yet is still the only record that this
      // product is gone, so it is carried rather than dropped. It used to be
      // discarded here, and the merge that matters runs in two stages: the local
      // stage has no server rows to overlay, so the tombstone died there and the
      // server's live row won the second stage. The product came back to the
      // catalogue seconds after it was deleted. Callers strip deleted rows before
      // rendering (filterCachedProducts), so carrying it costs nothing.
      if (indexes.length === 0) add(local);
      else indexes.forEach((index) => { rows[index] = { ...rows[index], ...local }; });
    } else add(local);
  }
  return rows;
}

export function useListProducts(
  params?: ListProductsParams,
  options?: QueryHookOptions<ListProductsResponse, ListProductsQueryKey>,
) {
  const extra = getQueryOptions<ListProductsResponse, ListProductsQueryKey>(options);
  const cached = readCachedProducts(params);
  return useQuery<ListProductsResponse, ApiClientError, ListProductsResponse, ListProductsQueryKey>({
    ...extra,
    queryKey: getListProductsQueryKey(params),
    initialData: extra.initialData ?? (cached.length > 0 ? cached : undefined),
    // Dated, so the cache paints instantly WITHOUT claiming to be the server's
    // answer. Undated initialData counts as fresh from now, and under this
    // screen's staleTime the catalogue was then never fetched at all — billing
    // sat on whatever the cache held until the user reloaded the page.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(productsCacheKey()),
    queryFn: async () => {
      const liveCached = readCachedProducts(params);
      const { active: fromDB, tombstones } = await readLocalProductState(params);
      // Tombstones last: they have to land on top of any live copy of the same
      // product still sitting in the cache or the database.
      const localRows = mergeProducts([], [...liveCached, ...fromDB, ...tombstones], true);
      if (!isBrowserOnline()) return filterCachedProducts(localRows, params);
      try {
        const fresh = await productsApi.listProducts(params);
        if (params?.search) {
          const fullServerRows = await productsApi.listProducts({ limit: 500 });
          void cacheProducts(mergeProducts(fullServerRows, localRows));
          return filterCachedProducts(mergeProducts(fresh, localRows), params);
        }
        const merged = filterCachedProducts(mergeProducts(fresh, localRows), params);
        void cacheProducts(merged);
        return merged;
      } catch (error) {
        if (isRecoverableNetworkError(error)) return filterCachedProducts(localRows, params);
        throw error;
      }
    },
  });
}

export function useCreateProduct(options?: MutationHookOptions<Product, CreateProductVariables>) {
  return useMutation<Product, ApiClientError, CreateProductVariables>({
    ...getMutationOptions<Product, CreateProductVariables>(options),
    mutationFn: ({ data }) => createProductLocalFirst(data),
  });
}

export function useUpdateProduct(options?: MutationHookOptions<Product, UpdateProductVariables>) {
  return useMutation<Product, ApiClientError, UpdateProductVariables>({
    ...getMutationOptions<Product, UpdateProductVariables>(options),
    mutationFn: ({ id, data }) => updateProductLocalFirst(id, data),
  });
}

export function useDeleteProduct(options?: MutationHookOptions<Product, DeleteProductVariables>) {
  return useMutation<Product, ApiClientError, DeleteProductVariables>({
    ...getMutationOptions<Product, DeleteProductVariables>(options),
    mutationFn: ({ id, ownerPin, reason }) => deleteProductLocalFirst(id, ownerPin, reason),
  });
}
