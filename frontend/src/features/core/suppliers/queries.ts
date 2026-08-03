import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as suppliersApi from "@/features/core/suppliers/api";
import { createSupplierLocalFirst, deleteSupplierLocalFirst, updateSupplierLocalFirst } from "@/features/core/suppliers/local-actions";
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

function isVisible(supplier: Supplier): boolean {
  const row = supplier as Supplier & { deleted_at?: unknown; deletedAt?: unknown };
  return row.deleted_at == null && row.deletedAt == null;
}

function isDeviceOwned(supplier: Supplier): boolean {
  const row = supplier as Supplier & { demo_data?: unknown; sync_status?: unknown; server_id?: unknown; serverId?: unknown };
  if (row.demo_data === true || supplier.id.startsWith("demo_") || supplier.id.startsWith("local_")) return true;
  if (typeof row.server_id === "string" || typeof row.serverId === "string") return false;
  return ["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(String(row.sync_status ?? "").toLowerCase());
}

export function mergeSuppliers(serverRows: Supplier[], localRows: Supplier[]): Supplier[] {
  const rows = new Map(serverRows.filter(isVisible).map((supplier) => [supplier.id, supplier]));
  for (const supplier of localRows) {
    if (!isVisible(supplier)) {
      rows.delete(supplier.id);
      continue;
    }
    if (isDeviceOwned(supplier)) rows.set(supplier.id, { ...rows.get(supplier.id), ...supplier });
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readSuppliersFromIndexedDB(): Promise<Supplier[]> {
  return offlineDB.getAll<Supplier>("suppliers").then((rows) => rows.filter(isVisible)).catch(() => []);
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
      if (!isBrowserOnline()) return mergeSuppliers([], [...liveCached, ...await readSuppliersFromIndexedDB()]);
      try {
        const [fresh, localRows] = await Promise.all([
          suppliersApi.listSuppliers(),
          readSuppliersFromIndexedDB(),
        ]);
        const merged = mergeSuppliers(fresh, [...liveCached, ...localRows]);
        void cacheSuppliers(merged);
        return merged;
      } catch (error) {
        if (isNetworkLikeError(error)) return mergeSuppliers([], [...liveCached, ...await readSuppliersFromIndexedDB()]);
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
