import { roundMoney } from "@/lib/money";
import { useQuery } from "@tanstack/react-query";
import { ApiClientError, isBrowserOnline } from "@/lib/api/http";
import { RECENT_CACHE_DAYS, emitLocalDataChanged, readInstantCache, writeInstantCache } from "@/lib/offline/instant-cache";
import { getQueryOptions, type QueryHookOptions } from "@/lib/api/query-options";
import * as billingApi from "@/features/billing/api";
import * as inventoryApi from "@/features/inventory/api";
import * as productsApi from "@/features/products/api";
import * as customersApi from "@/features/customers/api";
import * as reportsApi from "@/features/reports/api";
import { cacheProducts } from "@/features/products/queries";
import { cacheCustomers } from "@/features/customers/queries";
import { cacheBills, withBillAliases } from "@/features/bills/queries";
import { dedupeBillsForDisplay, dedupePaymentsForDisplay } from "@/features/sync/bill-reconciliation";
import type { Bill, Customer, MonthlyBreakdownRow, PaymentSummary, PnLReport, Product, QueryParams, TopProductRow } from "@/types/api";
import { BillPaymentMode } from "@/types/api";
import { calculateLedgerBalance, dedupeLedgerEntries, getLedgerCustomerId, type CustomerLedgerEntry } from "@/features/ledger/accounting";

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

function sameLocalDate(dateLike: unknown, yyyyMmDd: string) {
  if (!dateLike) return false;
  const date = new Date(String(dateLike));
  if (!Number.isFinite(date.getTime())) return false;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}` === yyyyMmDd;
}



function normaliseCustomerForCache(customer: Customer): Customer {
  const udhar = Number(customer.udharAmount ?? customer.totalUdhar ?? 0);
  return { ...customer, udharAmount: udhar, totalUdhar: udhar };
}

function billTenderFromCacheBill(bill: Bill): { cash: number; upi: number; bank: number } {
  const record = bill as Bill & Record<string, unknown> & { payments?: Array<Record<string, unknown>> };
  const billId = String(record.id ?? record.billId ?? record.bill_id ?? "");
  const customerId = String(record.customerId ?? record.customer_id ?? "");
  if (Array.isArray(record.payments) && record.payments.length > 0) {
    const normalizedPayments: Array<Record<string, unknown>> = (record.payments as Array<Record<string, unknown>>).map((payment) => ({
      ...payment,
      billId: payment.billId ?? payment.bill_id ?? billId,
      bill_id: payment.bill_id ?? payment.billId ?? billId,
      customerId: payment.customerId ?? payment.customer_id ?? customerId,
      customer_id: payment.customer_id ?? payment.customerId ?? customerId,
      paid_at: String(payment.paid_at ?? payment.paidAt ?? payment.created_at ?? payment.createdAt ?? record.created_at ?? record.createdAt ?? ""),
      paidAt: String(payment.paidAt ?? payment.paid_at ?? payment.createdAt ?? payment.created_at ?? record.createdAt ?? record.created_at ?? ""),
    }));
    const payments = dedupePaymentsForDisplay(normalizedPayments);
    return payments.reduce<{ cash: number; upi: number; bank: number }>(
      (sum, payment) => {
        const amount = Number(payment.amount ?? 0);
        const mode = String(payment.mode ?? "").toLowerCase();
        if (mode === BillPaymentMode.cash) sum.cash += amount;
        if (mode === BillPaymentMode.upi) sum.upi += amount;
        if (mode === BillPaymentMode.bank) sum.bank += amount;
        return sum;
      },
      { cash: 0, upi: 0, bank: 0 },
    );
  }
  return {
    cash: Number(record.cashAmount ?? record.cash_amount ?? 0),
    upi: Number(record.upiAmount ?? record.upi_amount ?? 0),
    bank: Number(record.bankAmount ?? record.bank_amount ?? 0),
  };
}

export function getLocalDashboardSnapshot(date = new Date()): LocalDashboardSnapshot {
  const yyyyMmDd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const bills = dedupeBillsForDisplay(readInstantCache<Bill[]>(CACHE_KEYS.bills, []).map(withBillAliases)) as unknown as Bill[];
  const customers = readInstantCache<Customer[]>(CACHE_KEYS.customers, []).map(normaliseCustomerForCache);
  const ledger = dedupeLedgerEntries(readInstantCache<CustomerLedgerEntry[]>("customer_ledger", []));
  const todayBills = bills.filter((bill) => bill.status !== "cancelled" && sameLocalDate(bill.createdAt, yyyyMmDd));

  let cash = 0;
  let upi = 0;
  let bank = 0;
  let credit = 0;
  let revenue = 0;
  let grossProfit = 0;

  for (const bill of todayBills) {
    revenue += Number(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0);
    grossProfit += Number(bill.grossProfit ?? 0);
    const payments = Array.isArray(bill.payments) ? bill.payments : [];
    let legacyCreditFromPaymentRows = 0;
    for (const payment of payments as Array<{ mode?: string; amount?: number }>) {
      const amount = Number(payment.amount ?? 0);
      if (String(payment.mode ?? "").toLowerCase() === BillPaymentMode.credit) legacyCreditFromPaymentRows += amount;
    }
    const tender = billTenderFromCacheBill(bill);
    cash += tender.cash;
    upi += tender.upi;
    bank += tender.bank;

    // Credit/udhar is debt, not a real tender payment. Count it from the
    // normalized bill amount even for partial bills with cash/UPI rows.
    const explicitCreditAmount = Number(bill.creditAmount ?? (bill as unknown as Record<string, unknown>).dueAmount ?? 0);
    credit += explicitCreditAmount > 0 ? explicitCreditAmount : legacyCreditFromPaymentRows;

    if (payments.length === 0 && tender.cash === 0 && tender.upi === 0 && tender.bank === 0) {
      const paid = Number(bill.paidAmount ?? bill.buyerPaidAmount ?? 0);
      if (paid > 0) cash += paid;
    }
  }

  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const ledgerByCustomer = new Map<string, CustomerLedgerEntry[]>();
  for (const entry of ledger) {
    const customerId = getLedgerCustomerId(entry);
    if (!customerId) continue;
    const group = ledgerByCustomer.get(customerId) ?? [];
    group.push(entry);
    ledgerByCustomer.set(customerId, group);
  }

  const outstandingCustomers = (ledgerByCustomer.size > 0
    ? Array.from(ledgerByCustomer.entries())
        .map(([customerId, rows]) => {
          const customer = customersById.get(customerId);
          const firstLedgerRow = rows[0] as Record<string, unknown> | undefined;
          const ledgerCustomerName = typeof firstLedgerRow?.customerName === "string" ? firstLedgerRow.customerName : undefined;
          const outstanding = roundMoney(Math.max(0, calculateLedgerBalance(rows)));
          return {
            customerId,
            customerName: customer?.name ?? ledgerCustomerName ?? "Customer",
            mobile: customer?.mobile ?? undefined,
            amount: outstanding,
            outstanding,
          };
        })
        .filter((row) => row.outstanding > 0)
    : customers
        .filter((customer) => Number(customer.udharAmount ?? customer.totalUdhar ?? 0) > 0)
        .map((customer) => ({
          customerId: customer.id,
          customerName: customer.name,
          mobile: customer.mobile ?? undefined,
          amount: roundMoney(Number(customer.udharAmount ?? customer.totalUdhar ?? 0)),
          outstanding: roundMoney(Number(customer.udharAmount ?? customer.totalUdhar ?? 0)),
        })))
    .slice(0, 50);

  const totalOutstanding = roundMoney(outstandingCustomers.reduce((sum, customer) => sum + customer.outstanding, 0));
  revenue = roundMoney(revenue);
  grossProfit = roundMoney(grossProfit);
  cash = roundMoney(cash);
  upi = roundMoney(upi);
  bank = roundMoney(bank);
  credit = roundMoney(credit);

  return {
    source: "local_cache",
    hasCache: bills.length > 0 || customers.length > 0,
    updatedAt: new Date().toISOString(),
    revenue,
    grossProfit,
    grossMarginPct: revenue > 0 ? roundMoney((grossProfit / revenue) * 100) : 0,
    billCount: todayBills.length,
    cash,
    upi,
    bank,
    credit,
    paymentTotal: roundMoney(cash + upi + bank + credit),
    totalOutstanding,
    outstandingCustomers,
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
