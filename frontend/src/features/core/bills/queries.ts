import { useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { RECENT_CACHE_DAYS, pruneRecentRows, instantCacheUpdatedAt, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { offlineDB } from "@/lib/offline/db";
import { getQueryOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as billingApi from "@/features/core/billing/api";
import { billIdentityKeys, dedupeBillsForDisplay, dedupePaymentsForDisplay, withBillSyncFlag } from "@/features/core/sync/bill-reconciliation";
import type { Bill, BillListResult, QueryParams } from "@/types/api";

const BILLS_CACHE_KEY = "bills";

export type ListBillsParams = QueryParams;
export type ListBillsResponse = BillListResult;

export const getListBillsQueryKey = (params?: ListBillsParams) => ["bills", params ?? {}] as const;

type ListBillsQueryKey = ReturnType<typeof getListBillsQueryKey>;

function billCreatedAtMs(bill: Bill): number {
  const record = bill as Bill & { created_at?: unknown; billDate?: unknown; date?: unknown };
  const raw = bill.businessDate ?? bill.business_date ?? bill.createdAt ?? record.created_at ?? record.billDate ?? record.date;
  const parsed = typeof raw === "string" || raw instanceof Date ? new Date(raw).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestBillsFirst(bills: Bill[]): Bill[] {
  // billCreatedAtMs walks a six-field fallback chain and parses a date, so
  // calling it from the comparator costs ~2n·log n parses over the shop's whole
  // bill history. Stamp each bill once and sort on the stamp.
  return bills
    .map((bill) => ({ bill, at: billCreatedAtMs(bill) }))
    .sort((a, b) => b.at - a.at)
    .map((entry) => entry.bill);
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

/**
 * A lean row must never take data away from a rich one.
 *
 * The bills SCREEN asks the server for `view=list`: the twenty columns a row
 * renders and a count of the lines instead of the lines. Those rows land here
 * like any other, and this cache is not just paint — it is the offline copy the
 * reprinted receipt, the WhatsApp share and the cancel dialog read. Writing a
 * lean row straight over a cached rich one would empty a bill of its lines, and
 * nobody would find out until a customer asked for a duplicate receipt with no
 * internet.
 *
 * So a lean row updates the scalars it carries and keeps whatever relations were
 * already there. Object spread does that for `items` on its own — the lean row
 * has no such key, so the prior value survives — but `payments` it does carry, in
 * a narrower form, and that one has to be held back explicitly.
 */
async function keepRicherRelations(incoming: Bill[]): Promise<Bill[]> {
  let stored: Bill[] = [];
  try {
    stored = await offlineDB.getAll<Bill>("bills");
  } catch {
    stored = [];
  }
  const priorByKey = new Map<string, Record<string, unknown>>();
  for (const row of [...readInstantCache<Bill[]>(BILLS_CACHE_KEY, []), ...stored]) {
    const record = row as unknown as Record<string, unknown>;
    if (!Array.isArray(record.items) && !Array.isArray(record.payments)) continue;
    for (const key of billIdentityKeys(record)) if (!priorByKey.has(key)) priorByKey.set(key, record);
  }
  if (priorByKey.size === 0) return incoming;

  return incoming.map((bill) => {
    const record = bill as unknown as Record<string, unknown>;
    const prior = billIdentityKeys(record).map((key) => priorByKey.get(key)).find(Boolean);
    if (!prior) return bill;
    const merged: Record<string, unknown> = { ...prior, ...record };
    if (Array.isArray(prior.items)) merged.items = prior.items;
    if (Array.isArray(prior.payments)) merged.payments = prior.payments;
    return merged as unknown as Bill;
  });
}

export async function cacheBills(bills: Bill[], options: { lean?: boolean } = {}) {
  const incoming = options.lean ? await keepRicherRelations(bills) : bills;
  const recentBills = pruneRecentRows(dedupeBillsForDisplay(incoming.map(withBillAliases)) as unknown as Bill[], RECENT_CACHE_DAYS);
  writeInstantCache(BILLS_CACHE_KEY, recentBills, RECENT_CACHE_DAYS);
  try {
    await offlineDB.putMany("bills", recentBills);
    await offlineDB.pruneStoreOlderThan("bills", RECENT_CACHE_DAYS);
  } catch {
    // LocalStorage cache is still available for instant paint.
  }
}

function readCachedBills(): Bill[] {
  return newestBillsFirst(
    dedupeBillsForDisplay(readInstantCache<Bill[]>(BILLS_CACHE_KEY, []).map(withBillAliases)) as unknown as Bill[],
  );
}

async function readBillsFromIndexedDB(params?: ListBillsParams): Promise<Bill[]> {
  try {
    const rows = await offlineDB.getAll<Bill>("bills");
    const q = String(params?.search ?? "").trim().toLowerCase();
    const recent = rows
      .filter((b) => (b as { deletedAt?: unknown }).deletedAt == null)
      .map(withBillAliases);
    const filtered = q
      ? recent.filter((b) => String(b.billNumber ?? b.billNo ?? "").toLowerCase().includes(q))
      : recent;
    const visible = newestBillsFirst(dedupeBillsForDisplay(filtered) as unknown as Bill[]);
    const limit = Number(params?.limit ?? filtered.length);
    return visible.slice(0, Number.isFinite(limit) && limit > 0 ? limit : visible.length);
  } catch {
    return [];
  }
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
    // Dated so the cached rows paint instantly without posing as the server's
    // answer: undated initialData counts as fresh from now, so nothing refetches
    // until staleTime lapses and the screen stays pinned to the cache.
    initialDataUpdatedAt: extra.initialDataUpdatedAt ?? instantCacheUpdatedAt(BILLS_CACHE_KEY),
    queryFn: async () => {
      const liveCachedBills = readCachedBills();
      if (!isBrowserOnline()) return { bills: liveCachedBills, total: liveCachedBills.length };
      try {
        const data = await billingApi.listBills({ ...params, view: "list" });
        const bills = (data.bills ?? []).map(withBillAliases);
        const visibleBills = dedupeBillsForDisplay([
          ...liveCachedBills.filter((bill) => {
            const syncStatus = (bill as { sync_status?: string }).sync_status;
            return syncStatus === "pending_sync" || syncStatus === "syncing" || syncStatus === "failed" || bill.status === "pending_sync";
          }),
          ...bills,
        ]) as unknown as Bill[];
        void cacheBills(visibleBills, { lean: true });
        return { ...data, bills: visibleBills, total: visibleBills.length };
      } catch (error) {
        if (liveCachedBills.length > 0) return { bills: liveCachedBills, total: liveCachedBills.length };
        if (isRecoverableNetworkError(error)) {
          const fromDB = await readBillsFromIndexedDB(params);
          if (fromDB.length > 0) { void cacheBills(fromDB); return { bills: fromDB, total: fromDB.length }; }
        }
        if (isRecoverableNetworkError(error)) return { bills: liveCachedBills, total: liveCachedBills.length };
        throw error;
      }
    },
  });
}
