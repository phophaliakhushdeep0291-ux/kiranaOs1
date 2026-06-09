import { useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { RECENT_CACHE_DAYS, pruneRecentRows, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { offlineDB } from "@/lib/offline/db";
import { getQueryOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as billingApi from "@/features/billing/api";
import { dedupeBillsForDisplay, dedupePaymentsForDisplay, withBillSyncFlag } from "@/features/sync/bill-reconciliation";
import type { Bill, BillListResult, QueryParams } from "@/types/api";

const BILLS_CACHE_KEY = "bills";

export type ListBillsParams = QueryParams;
export type ListBillsResponse = BillListResult;

export const getListBillsQueryKey = (params?: ListBillsParams) => ["bills", params ?? {}] as const;

type ListBillsQueryKey = ReturnType<typeof getListBillsQueryKey>;

function isNetworkLikeError(error: unknown) {
  return !(error instanceof ApiClientError) || !isBrowserOnline();
}

function withDedupedBillPayments(bill: Bill): Bill {
  const record = bill as Bill & { payments?: Array<Record<string, unknown>> };
  if (!Array.isArray(record.payments)) return bill;
  const billId = String((bill as { id?: unknown }).id ?? "");
  const customerId = String((bill as { customerId?: unknown; customer_id?: unknown }).customerId ?? (bill as { customer_id?: unknown }).customer_id ?? "");
  const payments = dedupePaymentsForDisplay(
    record.payments.map((rawPayment: unknown) => {
      const payment = rawPayment && typeof rawPayment === "object" ? rawPayment as Record<string, unknown> : {};
      return {
        ...payment,
        billId: payment.billId ?? payment.bill_id ?? billId,
        bill_id: payment.bill_id ?? payment.billId ?? billId,
        customerId: payment.customerId ?? payment.customer_id ?? customerId,
        customer_id: payment.customer_id ?? payment.customerId ?? customerId,
      };
    }),
  );
  return { ...bill, payments } as Bill;
}

export function withBillAliases(bill: Bill): Bill {
  return withBillSyncFlag(withDedupedBillPayments({
    ...bill,
    billNumber: bill.billNumber ?? bill.billNo,
    totalAmount: bill.totalAmount ?? bill.grandTotal ?? 0,
    netAmount: bill.netAmount ?? bill.grandTotal ?? 0,
  }));
}

export async function cacheBills(bills: Bill[]) {
  const recentBills = pruneRecentRows(dedupeBillsForDisplay(bills.map(withBillAliases)) as unknown as Bill[], RECENT_CACHE_DAYS);
  writeInstantCache(BILLS_CACHE_KEY, recentBills, RECENT_CACHE_DAYS);
  try {
    await offlineDB.putMany("bills", recentBills);
    await offlineDB.pruneStoreOlderThan("bills", RECENT_CACHE_DAYS);
  } catch {
    // LocalStorage cache is still available for instant paint.
  }
}

function readCachedBills(): Bill[] {
  return dedupeBillsForDisplay(readInstantCache<Bill[]>(BILLS_CACHE_KEY, []).map(withBillAliases)) as unknown as Bill[];
}

export function useListBills(
  params?: ListBillsParams,
  options?: QueryHookOptions<ListBillsResponse, ListBillsQueryKey>,
) {
  const extra = getQueryOptions<ListBillsResponse, ListBillsQueryKey>(options);
  const cachedBills = readCachedBills();
  return useQuery<ListBillsResponse, ApiClientError, ListBillsResponse, ListBillsQueryKey>({
    ...extra,
    queryKey: getListBillsQueryKey(params),
    initialData: extra.initialData ?? { bills: cachedBills, total: cachedBills.length },
    queryFn: async () => {
      const liveCachedBills = readCachedBills();
      if (!isBrowserOnline()) return { bills: liveCachedBills, total: liveCachedBills.length };
      try {
        const data = await billingApi.listBills(params);
        const bills = (data.bills ?? []).map(withBillAliases);
        const visibleBills = dedupeBillsForDisplay([
          ...liveCachedBills.filter((bill) => {
            const syncStatus = (bill as { sync_status?: string }).sync_status;
            return syncStatus === "pending_sync" || syncStatus === "syncing" || syncStatus === "failed" || bill.status === "pending_sync";
          }),
          ...bills,
        ]) as unknown as Bill[];
        void cacheBills(visibleBills);
        return { ...data, bills: visibleBills, total: visibleBills.length };
      } catch (error) {
        if (liveCachedBills.length > 0 || isNetworkLikeError(error)) return { bills: liveCachedBills, total: liveCachedBills.length };
        throw error;
      }
    },
  });
}
