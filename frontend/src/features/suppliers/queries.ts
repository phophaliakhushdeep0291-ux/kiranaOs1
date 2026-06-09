import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as suppliersApi from "@/features/suppliers/api";
import { createSupplierLocalFirst, deleteSupplierLocalFirst, updateSupplierLocalFirst } from "@/features/suppliers/local-actions";
import type { Supplier } from "@/types/api";

const SUPPLIERS_CACHE_KEY = "suppliers";

export type ListSuppliersResponse = Supplier[];
export interface CreateSupplierVariables { data: Partial<Supplier> }
export interface UpdateSupplierVariables { id: string; data: Partial<Supplier> }
export interface DeleteSupplierVariables { id: string; ownerPin: string; reason?: string }
export interface DeleteSupplierResponse { success: true; pendingSync: true }

export const getListSuppliersQueryKey = () => ["suppliers"] as const;

type ListSuppliersQueryKey = ReturnType<typeof getListSuppliersQueryKey>;

function isNetworkLikeError(error: unknown) {
  return !(error instanceof ApiClientError) || !isBrowserOnline();
}

export async function cacheSuppliers(suppliers: Supplier[]) {
  writeInstantCache(SUPPLIERS_CACHE_KEY, suppliers);
  try {
    await offlineDB.putMany("suppliers", suppliers);
  } catch {
    // IndexedDB cache is best effort for instant paint.
  }
}

function readCachedSuppliers(): Supplier[] {
  return readInstantCache<Supplier[]>(SUPPLIERS_CACHE_KEY, []).filter((supplier) => (supplier as { deleted_at?: unknown }).deleted_at == null);
}

export function useListSuppliers(options?: QueryHookOptions<ListSuppliersResponse, ListSuppliersQueryKey>) {
  const extra = getQueryOptions<ListSuppliersResponse, ListSuppliersQueryKey>(options);
  const cached = readCachedSuppliers();
  return useQuery<ListSuppliersResponse, ApiClientError, ListSuppliersResponse, ListSuppliersQueryKey>({
    ...extra,
    queryKey: getListSuppliersQueryKey(),
    initialData: extra.initialData ?? cached,
    queryFn: async () => {
      const liveCached = readCachedSuppliers();
      if (!isBrowserOnline()) return liveCached;
      try {
        const fresh = await suppliersApi.listSuppliers();
        void cacheSuppliers(fresh);
        return fresh;
      } catch (error) {
        if (liveCached.length > 0 || isNetworkLikeError(error)) return liveCached;
        throw error;
      }
    },
  });
}

export function useCreateSupplier(options?: MutationHookOptions<Supplier, CreateSupplierVariables>) {
  return useMutation<Supplier, ApiClientError, CreateSupplierVariables>({
    ...getMutationOptions<Supplier, CreateSupplierVariables>(options),
    mutationFn: ({ data }) => createSupplierLocalFirst(data),
  });
}

export function useUpdateSupplier(options?: MutationHookOptions<Supplier, UpdateSupplierVariables>) {
  return useMutation<Supplier, ApiClientError, UpdateSupplierVariables>({
    ...getMutationOptions<Supplier, UpdateSupplierVariables>(options),
    mutationFn: ({ id, data }) => updateSupplierLocalFirst(id, data),
  });
}

export function useDeleteSupplier(options?: MutationHookOptions<DeleteSupplierResponse, DeleteSupplierVariables>) {
  return useMutation<DeleteSupplierResponse, ApiClientError, DeleteSupplierVariables>({
    ...getMutationOptions<DeleteSupplierResponse, DeleteSupplierVariables>(options),
    mutationFn: ({ id, ownerPin, reason }) => deleteSupplierLocalFirst({ id, ownerPin, reason }),
  });
}
