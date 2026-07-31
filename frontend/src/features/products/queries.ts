import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { writeInstantCache, readInstantCache } from "@/lib/offline/instant-cache";
import { offlineDB } from "@/lib/offline/db";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as productsApi from "@/features/products/api";
import { createProductLocalFirst, deleteProductLocalFirst, updateProductLocalFirst } from "@/features/products/local-actions";
import type { Product, ProductInput, QueryParams } from "@/types/api";
import { getActiveLocationId } from "@/features/stores/location-context";

const PRODUCTS_CACHE_KEY = "products";

export type ListProductsParams = QueryParams;
export type ListProductsResponse = Product[];
export interface CreateProductVariables { data: ProductInput }
export interface UpdateProductVariables { id: string; data: ProductInput }
export interface DeleteProductVariables { id: string; ownerPin: string; reason?: string }
export type ProductWithProductId = Product & { productId: string };

export const getListProductsQueryKey = (params?: ListProductsParams) => ["products", getActiveLocationId() ?? "company", params ?? {}] as const;

type ListProductsQueryKey = ReturnType<typeof getListProductsQueryKey>;

function isNetworkLikeError(error: unknown) {
  return !(error instanceof ApiClientError) || !isBrowserOnline();
}

function withProductId(product: Product): ProductWithProductId {
  return { ...product, productId: product.id };
}

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

export async function cacheProducts(products: Product[]) {
  writeInstantCache(`${PRODUCTS_CACHE_KEY}:${getActiveLocationId() ?? "company"}`, products);
  try {
    await offlineDB.putMany("products", products);
  } catch {
    // LocalStorage cache is still available for instant paint.
  }
}

function readCachedProducts(params?: ListProductsParams): ProductWithProductId[] {
  return filterCachedProducts(readInstantCache<Product[]>(`${PRODUCTS_CACHE_KEY}:${getActiveLocationId() ?? "company"}`, []), params).map(withProductId);
}

async function readProductsFromIndexedDB(params?: ListProductsParams): Promise<ProductWithProductId[]> {
  try {
    const rows = await offlineDB.getAll<Product>("products");
    const locationId = getActiveLocationId();
    const locationAwareRows = locationId && rows.some((row) => Boolean((row as Product & { inventoryLocationId?: string }).inventoryLocationId))
      ? rows.filter((row) => (row as Product & { inventoryLocationId?: string }).inventoryLocationId === locationId)
      : rows;
    return filterCachedProducts(locationAwareRows, params).map(withProductId);
  } catch {
    return [];
  }
}

function productKeys(product: Product): string[] {
  const row = product as Product & { productId?: unknown; local_id?: unknown; server_id?: unknown; localId?: unknown; serverId?: unknown };
  return [product.id, row.productId, row.local_id, row.server_id, row.localId, row.serverId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function isDeviceOwnedProduct(product: Product): boolean {
  const row = product as Product & { demo_data?: unknown; sync_status?: unknown; server_id?: unknown; serverId?: unknown };
  if (row.demo_data === true || product.id.startsWith("demo_") || product.id.startsWith("local_")) return true;
  if (typeof row.server_id === "string" || typeof row.serverId === "string") {
    return ["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(String(row.sync_status ?? "").toLowerCase());
  }
  return ["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(String(row.sync_status ?? "").toLowerCase());
}

export function mergeProducts(serverRows: Product[], localRows: Product[], retainSyncedLocal = false): ProductWithProductId[] {
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
      indexes.forEach((index) => { rows[index] = { ...rows[index], ...local }; });
    } else add(local);
  }
  return rows.map(withProductId);
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
    queryFn: async () => {
      const liveCached = readCachedProducts(params);
      const fromDB = await readProductsFromIndexedDB(params);
      const localRows = mergeProducts([], [...liveCached, ...fromDB], true);
      if (!isBrowserOnline()) return filterCachedProducts(localRows, params).map(withProductId);
      try {
        const fresh = (await productsApi.listProducts(params)).map(withProductId);
        if (params?.search) {
          const fullServerRows = await productsApi.listProducts({ limit: 500 });
          void cacheProducts(mergeProducts(fullServerRows, localRows));
          return filterCachedProducts(mergeProducts(fresh, localRows), params).map(withProductId);
        }
        const merged = filterCachedProducts(mergeProducts(fresh, localRows), params).map(withProductId);
        void cacheProducts(merged);
        return merged;
      } catch (error) {
        if (isNetworkLikeError(error)) return filterCachedProducts(localRows, params).map(withProductId);
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
