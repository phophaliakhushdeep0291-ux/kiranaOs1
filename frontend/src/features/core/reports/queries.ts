import { roundMoney } from "@/lib/money";
import { useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { RECENT_CACHE_DAYS, emitLocalDataChanged, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { getQueryOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as billingApi from "@/features/core/billing/api";
import * as inventoryApi from "@/features/core/inventory/api";
import * as productsApi from "@/features/core/products/api";
import * as customersApi from "@/features/core/customers/api";
import * as reportsApi from "@/features/core/reports/api";
import { cacheProducts } from "@/features/core/products/queries";
import { cacheCustomers } from "@/features/core/customers/queries";
import { cacheBills, withBillAliases } from "@/features/core/bills/queries";
import { aggregateFinancialRows } from "@/features/core/finance/services/FinancialAggregationService";
import type { Bill, Customer, MonthlyBreakdownRow, PaymentSummary, PnLReport, Product, QueryParams, TopProductRow } from "@/types/api";
import type { CustomerLedgerEntry } from "@/features/core/ledger/accounting";

const CACHE_KEYS = {
  products: "products",
  customers: "customers",
  bills: "bills",
  inventory: "inventory",
};

export interface LocalDashboardSnapshot {
  source: "local_cache";
  hasCache: boolean;
  updatedAt: string;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number;
  billCount: number;
  cash: number;
  upi: number;
  bank: number;
  credit: number;
  paymentTotal: number;
  totalOutstanding: number;
  outstandingCustomers: Array<{ customerId: string; customerName: string; mobile?: string; amount: number; outstanding: number }>;
}

export const getGetPnLQueryKey = (params?: QueryParams) => ["reports", "pnl", params ?? {}] as const;
export const getGetMonthlyBreakdownQueryKey = (params?: QueryParams) => ["reports", "monthly", params ?? {}] as const;
export const getGetTopProductsQueryKey = (params?: QueryParams) => ["reports", "top-products", params ?? {}] as const;
export const getGetPaymentSummaryQueryKey = (params?: QueryParams) => ["reports", "payments", params ?? {}] as const;

type PnLQueryKey = ReturnType<typeof getGetPnLQueryKey>;
type MonthlyBreakdownQueryKey = ReturnType<typeof getGetMonthlyBreakdownQueryKey>;
type TopProductsQueryKey = ReturnType<typeof getGetTopProductsQueryKey>;
type PaymentSummaryQueryKey = ReturnType<typeof getGetPaymentSummaryQueryKey>;

/** Fast cached paint uses the same signed/deduped arithmetic as the full report. */
export function getLocalDashboardSnapshot(date = new Date()): LocalDashboardSnapshot {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const snapshot = aggregateFinancialRows({
    date: day,
    bills: readInstantCache<Bill[]>(CACHE_KEYS.bills, []).map(withBillAliases) as (Bill & Record<string, unknown>)[],
    customers: readInstantCache<Customer[]>(CACHE_KEYS.customers, []),
    ledger: readInstantCache<CustomerLedgerEntry[]>("customer_ledger", []),
  });
  return {
    source: "local_cache",
    hasCache: snapshot.hasLocalData,
    updatedAt: snapshot.generatedAt,
    revenue: snapshot.revenueToday,
    grossProfit: snapshot.profitToday,
    grossMarginPct: snapshot.grossMarginPct,
    billCount: snapshot.totalBillsToday,
    cash: snapshot.cashSalesToday,
    upi: snapshot.upiSalesToday,
    bank: snapshot.bankSalesToday,
    credit: snapshot.udharSalesToday,
    paymentTotal: roundMoney(snapshot.cashSalesToday + snapshot.upiSalesToday + snapshot.bankSalesToday + snapshot.udharSalesToday),
    totalOutstanding: snapshot.totalOutstandingUdhar,
    outstandingCustomers: snapshot.outstandingCustomers.map((row) => ({ ...row, mobile: row.mobile ?? undefined, amount: row.outstanding })),
  };
}

export async function warmRecentLocalCache(days = RECENT_CACHE_DAYS) {
  if (!isBrowserOnline()) return getLocalDashboardSnapshot();
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  await Promise.allSettled([
    productsApi.listProducts({ limit: 1000 }).then((rows) => cacheProducts(rows.map((p) => ({ ...p, productId: p.id } as Product & { productId: string })))),
    customersApi.listCustomers({ limit: 2000 }).then((rows) => cacheCustomers(rows.map((c) => ({ ...c, totalUdhar: c.totalUdhar ?? c.udharAmount ?? 0 })))),
    billingApi.listBills({ from: formatDate(from), to: formatDate(to), limit: 2000 }).then((data) => cacheBills((data.bills ?? []).map(withBillAliases))),
    inventoryApi.getInventory().then((rows) => writeInstantCache(CACHE_KEYS.inventory, rows, days)),
  ]);
  emitLocalDataChanged({ type: "recent_cache_warmed", days });
  return getLocalDashboardSnapshot();
}

export function useGetPnL(params?: QueryParams, options?: QueryHookOptions<PnLReport, PnLQueryKey>) {
  return useQuery<PnLReport, ApiClientError, PnLReport, PnLQueryKey>({
    queryKey: getGetPnLQueryKey(params),
    queryFn: () => reportsApi.getPnL(params),
    ...getQueryOptions<PnLReport, PnLQueryKey>(options),
  });
}

export function useGetMonthlyBreakdown(
  params?: QueryParams,
  options?: QueryHookOptions<MonthlyBreakdownRow[], MonthlyBreakdownQueryKey>,
) {
  return useQuery<MonthlyBreakdownRow[], ApiClientError, MonthlyBreakdownRow[], MonthlyBreakdownQueryKey>({
    queryKey: getGetMonthlyBreakdownQueryKey(params),
    queryFn: () => reportsApi.getMonthlyBreakdown(params),
    ...getQueryOptions<MonthlyBreakdownRow[], MonthlyBreakdownQueryKey>(options),
  });
}

export function useGetTopProducts(params?: QueryParams, options?: QueryHookOptions<TopProductRow[], TopProductsQueryKey>) {
  return useQuery<TopProductRow[], ApiClientError, TopProductRow[], TopProductsQueryKey>({
    queryKey: getGetTopProductsQueryKey(params),
    queryFn: () => reportsApi.getTopProducts(params),
    ...getQueryOptions<TopProductRow[], TopProductsQueryKey>(options),
  });
}

export function useGetPaymentSummary(
  params?: QueryParams,
  options?: QueryHookOptions<PaymentSummary, PaymentSummaryQueryKey>,
) {
  return useQuery<PaymentSummary, ApiClientError, PaymentSummary, PaymentSummaryQueryKey>({
    queryKey: getGetPaymentSummaryQueryKey(params),
    queryFn: () => reportsApi.getPaymentSummary(params),
    ...getQueryOptions<PaymentSummary, PaymentSummaryQueryKey>(options),
  });
}
