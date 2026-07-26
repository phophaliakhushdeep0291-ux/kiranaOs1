import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import { getMutationOptions, getQueryOptions, type MutationHookOptions, type QueryHookOptions } from "@/lib/api/query-options";
import { readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import * as customersApi from "@/features/customers/api";
import * as ledgerApi from "@/features/ledger/api";
import { cacheAuthoritativeSummary } from "@/features/ledger/authoritative-balances";
import { createCustomerLocalFirst, deleteCustomerLocalFirst, updateCustomerLocalFirst } from "@/features/customers/local-actions";
import { getLocalUdharLedger, getLocalUdharSummary, recordPaymentLocalFirst } from "@/features/payments/local-actions";
import type { Customer, CustomerInput, CustomerKhataResult, LedgerResult, QueryParams, UdharSummary } from "@/types/api";

const CUSTOMERS_CACHE_KEY = "customers";

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

function isNetworkLikeError(error: unknown) {
  return !(error instanceof ApiClientError) || !isBrowserOnline();
}

function normaliseCustomerForCache(customer: Customer): Customer {
  const udhar = Number(customer.udharAmount ?? customer.totalUdhar ?? 0);
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

export async function cacheCustomers(customers: Customer[]) {
  writeInstantCache(CUSTOMERS_CACHE_KEY, customers);
  try {
    await offlineDB.putMany("customers", customers);
  } catch {
    // IndexedDB cache is best effort for instant paint.
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
    queryFn: async () => {
      const liveCached = readCachedCustomers(params);
      if (!isBrowserOnline()) return liveCached;
      try {
        const fresh = (await customersApi.listCustomers(params)).map(normaliseCustomerForCache);
        const cacheSource = params?.search ? await customersApi.listCustomers({ limit: 1000 }) : fresh;
        void cacheCustomers(cacheSource.map(normaliseCustomerForCache));
        return fresh;
      } catch (error) {
        if (liveCached.length > 0) return liveCached;
        if (isNetworkLikeError(error)) {
          const fromDB = await readCustomersFromIndexedDB(params);
          if (fromDB.length > 0) { void cacheCustomers(fromDB); return fromDB; }
        }
        if (isNetworkLikeError(error)) return liveCached;
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
    queryFn: async () => {
      // Offline falls back to the last server snapshot (plus local movement
      // since) rather than the raw device ledger — see authoritative-balances.
      if (!isBrowserOnline()) return getLocalUdharSummary();
      try {
        const summary = await ledgerApi.getUdharSummary();
        cacheAuthoritativeSummary(summary);
        return summary;
      } catch (error) {
        if (isNetworkLikeError(error)) return getLocalUdharSummary();
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
    queryFn: async () => {
      if (!isBrowserOnline()) return getLocalUdharLedger(normalisedLimit) as LedgerResult<UdharLedgerDisplayEntry>;
      try {
        return await ledgerApi.getUdharLedger(params) as LedgerResult<UdharLedgerDisplayEntry>;
      } catch (error) {
        if (isNetworkLikeError(error)) return getLocalUdharLedger(normalisedLimit) as LedgerResult<UdharLedgerDisplayEntry>;
        throw error;
      }
    },
  });
}
