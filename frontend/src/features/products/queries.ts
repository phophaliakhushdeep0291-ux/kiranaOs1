import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { writeInstantCache, readInstantCache } from "@/lib/offline/instant-cache";
import { offlineDB } from "@/lib/offline/db";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as productsApi from "@/features/products/api";
import { createProductLocalFirst, deleteProductLocalFirst, updateProductLocalFirst } from "@/features/products/local-actions";
import type { Product, ProductInput, QueryParams } from "@/types/api";

const PRODUCTS_CACHE_KEY = "products";

export type ListProductsParams = QueryParams;
export type ListProductsResponse = Product[];
export interface CreateProductVariables { data: ProductInput }
export interface UpdateProductVariables { id: string; data: ProductInput }
export interface DeleteProductVariables { id: string; ownerPin: string; reason?: string }
export type ProductWithProductId = Product & { productId: string };

export const getListProductsQueryKey = (params?: ListProductsParams) => ["products", params ?? {}] as const;

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
  writeInstantCache(PRODUCTS_CACHE_KEY, products);
  try {
    await offlineDB.putMany("products", products);
  } catch {
    // LocalStorage cache is still available for instant paint.
  }
}

function readCachedProducts(params?: ListProductsParams): ProductWithProductId[] {
  return filterCachedProducts(readInstantCache<Product[]>(PRODUCTS_CACHE_KEY, []), params).map(withProductId);
}

async function readProductsFromIndexedDB(params?: ListProductsParams): Promise<ProductWithProductId[]> {
  try {
    const rows = await offlineDB.getAll<Product>("products");
    return filterCachedProducts(rows, params).map(withProductId);
  } catch {
    return [];
  }
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
    initialData: extra.initialData ?? cached,
    queryFn: async () => {
      const liveCached = readCachedProducts(params);
      if (!isBrowserOnline()) return liveCached;
      try {
        const fresh = (await productsApi.listProducts(params)).map(withProductId);
        const cacheSource = params?.search ? await productsApi.listProducts({ limit: 500 }) : fresh;
        void cacheProducts(cacheSource.map(withProductId));
        return fresh;
      } catch (error) {
        if (liveCached.length > 0) return liveCached;
        if (isNetworkLikeError(error)) {
          const fromDB = await readProductsFromIndexedDB(params);
          if (fromDB.length > 0) { void cacheProducts(fromDB); return fromDB; }
        }
        if (isNetworkLikeError(error)) return liveCached;
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
