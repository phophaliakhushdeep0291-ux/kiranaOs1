import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import { instantCacheUpdatedAt, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import * as customersApi from "@/features/core/customers/api";
import * as ledgerApi from "@/features/core/ledger/api";
import { cacheAuthoritativeSummary } from "@/features/core/ledger/authoritative-balances";
import { createCustomerLocalFirst, deleteCustomerLocalFirst, updateCustomerLocalFirst } from "@/features/core/customers/local-actions";
import { getLocalUdharLedger, getLocalUdharSummary, getLocalUdharSummaryAsync, recordPaymentLocalFirst } from "@/features/core/payments/local-actions";
import { getLedgerCustomerId, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";
import type { Customer, CustomerInput, CustomerKhataResult, LedgerResult, QueryParams, UdharSummary } from "@/types/api";

const CUSTOMERS_CACHE_KEY = "customers";
const UNSYNCED_LEDGER_STATUSES = new Set(["pending_sync", "syncing", "failed", "local_only"]);

export type ListCustomersParams = QueryParams;
export type ListCustomersResponse = Customer[];
export interface CreateCustomerVariables { data: CustomerInput }
export interface UpdateCustomerVariables { id: string; data: CustomerInput }
export interface DeleteCustomerVariables { id: string; ownerPin: string; reason?: string }
export interface RecordUdharPaymentVariables {
  id: string;
  data: { amount: number; mode: string; note?: string };
  /** The authoritative balance shown to the operator; see RecordPaymentOptions. */
  expectedOutstanding?: number;
}
export interface CustomerKhataView extends CustomerKhataResult {
  entries: unknown[];
  totalOutstanding: number;
}
export interface UdharLedgerDisplayEntry extends Record<string, unknown> {
  id: string;
  type: string;
  customerId: string;
  customerName?: string;
  mobile?: string;
  amount: number;
  createdAt: string;
}

export const getListCustomersQueryKey = (params?: ListCustomersParams) => ["customers", params ?? {}] as const;
export const getGetCustomerKhataQueryKey = (id: string) => ["customers", id, "khata"] as const;
export const getGetUdharSummaryQueryKey = () => ["udhar", "summary"] as const;
export const getGetUdharLedgerQueryKey = (params?: QueryParams) => ["udhar", "ledger", params ?? {}] as const;

type ListCustomersQueryKey = ReturnType<typeof getListCustomersQueryKey>;
type CustomerKhataQueryKey = ReturnType<typeof getGetCustomerKhataQueryKey>;
type UdharSummaryQueryKey = ReturnType<typeof getGetUdharSummaryQueryKey>;
type UdharLedgerQueryKey = ReturnType<typeof getGetUdharLedgerQueryKey>;

function normaliseCustomerForCache(customer: Customer): Customer {
  const parsed = Number(customer.udharAmount ?? customer.totalUdhar ?? 0);
  const udhar = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  return { ...customer, udharAmount: udhar, totalUdhar: udhar };
}

function filterCachedCustomers(customers: Customer[], params?: ListCustomersParams): Customer[] {
  const q = String(params?.search ?? "").trim().toLowerCase();
  const activeCustomers = customers.filter((c) => c.deletedAt == null && (c as { deleted_at?: unknown }).deleted_at == null);
  const limit = Number(params?.limit ?? activeCustomers.length);
  const filtered = q
    ? activeCustomers.filter((c) => c.name.toLowerCase().includes(q) || c.mobile?.includes(q))
    : activeCustomers;
  return filtered.slice(0, Number.isFinite(limit) && limit > 0 ? limit : filtered.length);
}

/** Cache raw server rows, never a caller's pre-request snapshot of local rows. */
export async function cacheCustomers(serverRows: Customer[]): Promise<Customer[]> {
  try {
    const merged = await offlineDB.transaction(["customers", "customer_ledger"], async (tx) => {
      // Sync can remap/delete a local id while a customer request is in flight.
      // Reading the device rows inside this write transaction prevents an old
      // pending local echo from being reinserted after its server id is known.
      const [current, ledger] = await Promise.all([
        offlineDB.getAll<Customer>("customers"),
        offlineDB.getAll<CustomerLedgerEntry>("customer_ledger"),
      ]);
      const byIdentity = new Map<string, Customer>();
      for (const customer of current) {
        for (const identity of customerKeys(customer)) byIdentity.set(identity, customer);
      }
      const fresh = serverRows.map((row) => {
        const stored = customerKeys(row).map((identity) => byIdentity.get(identity)).find(Boolean);
        const identities = new Set(stored ? customerKeys(stored) : customerKeys(row));
        const hasPendingFinancialWork = ledger.some((entry) => {
          const customerId = getLedgerCustomerId(entry);
          return customerId !== null && identities.has(customerId)
            && UNSYNCED_LEDGER_STATUSES.has(String(entry.sync_status ?? "").toLowerCase());
        });
        if (!stored || !hasPendingFinancialWork || stored.balance_derived_from_local_ledger !== true) {
          return { ...stored, ...row };
        }
        // The server response cannot include ledger rows still queued on this
        // device. Preserve only the transaction-derived balance fields while
        // accepting all other current server data.
        return {
          ...stored,
          ...row,
          type: Number(stored.udharAmount ?? stored.totalUdhar ?? 0) > 0 ? "udhar" : row.type,
          udharAmount: stored.udharAmount,
          totalUdhar: stored.totalUdhar,
          balance_derived_from_local_ledger: true,
        } as Customer;
      });
      const rows = mergeCustomers(fresh, current).map(normaliseCustomerForCache);
      await tx.putMany("customers", rows);
      return rows;
    });
    writeInstantCache(CUSTOMERS_CACHE_KEY, merged);
    return merged;
  } catch {
    // A cache failure may still show the response, but must not replace the
    // durable local data or publish a stale snapshot back into storage.
    return mergeCustomers(serverRows, readCachedCustomers()).map(normaliseCustomerForCache);
  }
}

function readCachedCustomers(params?: ListCustomersParams): Customer[] {
  return filterCachedCustomers(readInstantCache<Customer[]>(CUSTOMERS_CACHE_KEY, []), params).map(normaliseCustomerForCache);
}

async function readCustomersFromIndexedDB(params?: ListCustomersParams): Promise<Customer[]> {
  try {
    const rows = await offlineDB.getAll<Customer>("customers");
    return filterCachedCustomers(rows, params).map(normaliseCustomerForCache);
  } catch {
    return [];
  }
}

function customerKeys(customer: Customer): string[] {
  const row = customer as Customer & { local_id?: unknown; server_id?: unknown; localId?: unknown; serverId?: unknown };
  return [customer.id, row.local_id, row.server_id, row.localId, row.serverId]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function isDeviceOwnedCustomer(customer: Customer): boolean {
  const row = customer as Customer & { demo_data?: unknown; sync_status?: unknown };
  return row.demo_data === true || customer.id.startsWith("demo_") || customer.id.startsWith("local_") ||
    ["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(String(row.sync_status ?? "").toLowerCase());
}

export function mergeCustomers(serverRows: Customer[], localRows: Customer[], retainSyncedLocal = false): Customer[] {
  const rows: Customer[] = [];
  const keyToIndex = new Map<string, number>();
  const add = (customer: Customer) => {
    const keys = customerKeys(customer);
    const index = keys.map((key) => keyToIndex.get(key)).find((value): value is number => value !== undefined);
    if (index === undefined) {
      const nextIndex = rows.push(customer) - 1;
      keys.forEach((key) => keyToIndex.set(key, nextIndex));
      return;
    }
    rows[index] = { ...rows[index], ...customer };
    customerKeys(rows[index]).forEach((key) => keyToIndex.set(key, index));
  };
  serverRows.forEach(add);
  for (const local of localRows) {
    if (!retainSyncedLocal && !isDeviceOwnedCustomer(local)) continue;
    add(local);
  }
  return rows.filter((customer) => customer.deletedAt == null && (customer as Customer & { deleted_at?: unknown }).deleted_at == null);
}

export function useListCustomers(
  params?: ListCustomersParams,
  options?: QueryHookOptions<ListCustomersResponse, ListCustomersQueryKey>,
) {
  const extra = getQueryOptions<ListCustomersResponse, ListCustomersQueryKey>(options);
  const cached = readCachedCustomers(params);
  return useQuery<ListCustomersResponse, ApiClientError, ListCustomersResponse, ListCustomersQueryKey>({
    ...extra,
    queryKey: getListCustomersQueryKey(params),
    initialData: extra.initialData ?? cached,
    // Dated so the cached rows paint instantly without posing as the server's
    // answer: undated initialData counts as fresh from now, so nothing refetches
    // until staleTime lapses and the screen stays pinned to the cache.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(CUSTOMERS_CACHE_KEY),
    queryFn: async () => {
      const liveCached = readCachedCustomers(params);
      const fromDB = await readCustomersFromIndexedDB(params);
      const localRows = mergeCustomers([], [...liveCached, ...fromDB], true);
      if (!isBrowserOnline()) return filterCachedCustomers(localRows, params).map(normaliseCustomerForCache);
      try {
        const fresh = (await customersApi.listCustomers(params)).map(normaliseCustomerForCache);
        if (params?.search) {
          const fullServerRows = await customersApi.listCustomers({ limit: 1000 });
          const current = await cacheCustomers(fullServerRows);
          return filterCachedCustomers(mergeCustomers(fresh, current), params).map(normaliseCustomerForCache);
        }
        return filterCachedCustomers(await cacheCustomers(fresh), params);
      } catch (error) {
        if (isRecoverableNetworkError(error)) return filterCachedCustomers(localRows, params).map(normaliseCustomerForCache);
        throw error;
      }
    },
  });
}

export function useCreateCustomer(options?: MutationHookOptions<Customer, CreateCustomerVariables>) {
  return useMutation<Customer, ApiClientError, CreateCustomerVariables>({
    ...getMutationOptions<Customer, CreateCustomerVariables>(options),
    mutationFn: ({ data }) => createCustomerLocalFirst(data),
  });
}

export function useUpdateCustomer(options?: MutationHookOptions<Customer, UpdateCustomerVariables>) {
  return useMutation<Customer, ApiClientError, UpdateCustomerVariables>({
    ...getMutationOptions<Customer, UpdateCustomerVariables>(options),
    mutationFn: ({ id, data }) => updateCustomerLocalFirst(id, data),
  });
}

export function useDeleteCustomer(options?: MutationHookOptions<{ success: boolean; message?: string }, DeleteCustomerVariables>) {
  return useMutation<{ success: boolean; message?: string }, ApiClientError, DeleteCustomerVariables>({
    ...getMutationOptions<{ success: boolean; message?: string }, DeleteCustomerVariables>(options),
    mutationFn: ({ id, ownerPin, reason }) => deleteCustomerLocalFirst({ id, ownerPin, reason }),
  });
}

export function useGetCustomerKhata(
  id: string,
  options?: QueryHookOptions<CustomerKhataView, CustomerKhataQueryKey>,
) {
  return useQuery<CustomerKhataView, ApiClientError, CustomerKhataView, CustomerKhataQueryKey>({
    queryKey: getGetCustomerKhataQueryKey(id),
    queryFn: async () => {
      const data = await customersApi.getCustomerKhata(id);
      return {
        ...data,
        entries: data.entries ?? data.ledger ?? [],
        totalOutstanding: data.totalOutstanding ?? data.customer?.udharAmount ?? 0,
      };
    },
    enabled: Boolean(id),
    ...getQueryOptions<CustomerKhataView, CustomerKhataQueryKey>(options),
  });
}

export function useRecordUdharPayment(options?: MutationHookOptions<unknown, RecordUdharPaymentVariables>) {
  return useMutation<unknown, ApiClientError, RecordUdharPaymentVariables>({
    ...getMutationOptions<unknown, RecordUdharPaymentVariables>(options),
    mutationFn: ({ id, data, expectedOutstanding }) => recordPaymentLocalFirst(id, data, { expectedOutstanding }),
  });
}

export function useGetUdharSummary(options?: QueryHookOptions<UdharSummary, UdharSummaryQueryKey>) {
  const extra = getQueryOptions<UdharSummary, UdharSummaryQueryKey>(options);
  const cached = getLocalUdharSummary();
  return useQuery<UdharSummary, ApiClientError, UdharSummary, UdharSummaryQueryKey>({
    ...extra,
    queryKey: getGetUdharSummaryQueryKey(),
    initialData: extra.initialData ?? cached,
    // Dated so the cached rows paint instantly without posing as the server's
    // answer: undated initialData counts as fresh from now, so nothing refetches
    // until staleTime lapses and the screen stays pinned to the cache.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(CUSTOMERS_CACHE_KEY),
    queryFn: async () => {
      // Offline falls back to the last server snapshot (plus local movement
      // since) rather than the raw device ledger — see authoritative-balances.
      if (!isBrowserOnline()) return getLocalUdharSummaryAsync();
      try {
        const summary = await ledgerApi.getUdharSummary();
        cacheAuthoritativeSummary(summary);
        return summary;
      } catch (error) {
        if (isRecoverableNetworkError(error)) return getLocalUdharSummaryAsync();
        throw error;
      }
    },
  });
}

export function useGetUdharLedger(
  params?: QueryParams,
  options?: QueryHookOptions<LedgerResult<UdharLedgerDisplayEntry>, UdharLedgerQueryKey>,
) {
  const extra = getQueryOptions<LedgerResult<UdharLedgerDisplayEntry>, UdharLedgerQueryKey>(options);
  const limit = Number(params?.limit ?? 50);
  const normalisedLimit = Number.isFinite(limit) ? limit : 50;
  const cached = getLocalUdharLedger(normalisedLimit) as LedgerResult<UdharLedgerDisplayEntry>;
  return useQuery<LedgerResult<UdharLedgerDisplayEntry>, ApiClientError, LedgerResult<UdharLedgerDisplayEntry>, UdharLedgerQueryKey>({
    ...extra,
    queryKey: getGetUdharLedgerQueryKey(params),
    initialData: extra.initialData ?? cached,
    // Dated so the cached rows paint instantly without posing as the server's
    // answer: undated initialData counts as fresh from now, so nothing refetches
    // until staleTime lapses and the screen stays pinned to the cache.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(CUSTOMERS_CACHE_KEY),
    queryFn: async () => {
      if (!isBrowserOnline()) return getLocalUdharLedger(normalisedLimit) as LedgerResult<UdharLedgerDisplayEntry>;
      try {
        return await ledgerApi.getUdharLedger(params) as LedgerResult<UdharLedgerDisplayEntry>;
      } catch (error) {
        if (isRecoverableNetworkError(error)) return getLocalUdharLedger(normalisedLimit) as LedgerResult<UdharLedgerDisplayEntry>;
        throw error;
      }
    },
  });
}
