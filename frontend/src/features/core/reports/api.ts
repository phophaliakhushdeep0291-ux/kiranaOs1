import { apiRequest, buildQuery, ApiClientError } from "@/lib/api/http";
import type { MonthlyBreakdownRow, PaymentSummary, PnLReport, QueryParams, TopProductRow } from "@/types/api";

type RawReportRecord = Record<string, unknown>;

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function emptyPnLReport(reason = "profit_report_unavailable"): PnLReport & { unavailableReason?: string } {
  return {
    revenue: 0,
    cost: 0,
    grossProfit: 0,
    grossMarginPct: 0,
    totalBills: 0,
    cashSales: 0,
    upiSales: 0,
    udharSales: 0,
    unavailableReason: reason,
  };
}

function normalisePnL(data: RawReportRecord): PnLReport {
  const revenue = asNumber(data.revenue ?? data.grossSales);
  const grossProfit = asNumber(data.grossProfit);
  const cost = asNumber(data.cost, Math.max(0, revenue - grossProfit));
  return {
    ...data,
    revenue,
    cost,
    grossProfit,
    grossMarginPct: asNumber(data.grossMarginPct, revenue ? (grossProfit / revenue) * 100 : 0),
    totalBills: asNumber(data.totalBills),
    cashSales: asNumber(data.cashSales ?? data.cashCollected),
    upiSales: asNumber(data.upiSales ?? data.upiCollected),
    udharSales: asNumber(data.udharSales ?? data.udharGivenThisPeriod),
  };
}

function normaliseMonthly(data: unknown): MonthlyBreakdownRow[] {
  const maybeRecord = typeof data === "object" && data !== null ? data as { months?: unknown } : {};
  const rows = Array.isArray(data) ? data : Array.isArray(maybeRecord.months) ? maybeRecord.months : [];
  return rows.map((row) => {
    const record = row as RawReportRecord;
    const revenue = asNumber(record.revenue ?? record.grossSales);
    const profit = asNumber(record.profit ?? record.netProfit ?? record.grossProfit);
    return {
      month: String(record.monthName ?? record.month ?? ""),
      revenue,
      cost: asNumber(record.cost, Math.max(0, revenue - asNumber(record.grossProfit, profit))),
      profit,
      bills: asNumber(record.bills ?? record.totalBills),
    };
  });
}

function normaliseTopProducts(data: unknown): TopProductRow[] {
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const record = row as RawReportRecord;
    return {
      productId: String(record.productId ?? record.name),
      name: String(record.name ?? record.productName ?? "Product"),
      quantitySold: asNumber(record.quantitySold ?? record.qty ?? record.quantityInBaseUnit),
      revenue: asNumber(record.revenue),
      profit: asNumber(record.profit),
    };
  });
}

export async function getPnL(params?: QueryParams) {
  try {
    return normalisePnL(await apiRequest<RawReportRecord>(`/reports/pnl${buildQuery(params)}`));
  } catch (error) {
    // Starter plan can legitimately receive 403 for profit-sensitive P&L.
    // Dashboard already has local/offline report fallbacks, so do not turn this
    // expected plan gate into a visible app/sync error.
    if (error instanceof ApiClientError && error.status === 403) {
      return emptyPnLReport(error.data.code ?? "profit_report_not_included");
    }
    throw error;
  }
}

export async function getMonthlyBreakdown(params?: QueryParams) {
  const now = new Date();
  const backendParams = {
    year: params?.year ?? now.getFullYear(),
    untilMonth: params?.untilMonth ?? now.getMonth() + 1,
  };
  return normaliseMonthly(await apiRequest<unknown>(`/reports/monthly-breakdown${buildQuery(backendParams)}`)).slice(-Number(params?.months ?? 12));
}

export async function getTopProducts(params?: QueryParams) {
  return normaliseTopProducts(await apiRequest<unknown>(`/reports/top-products${buildQuery(params)}`));
}

export function getPaymentSummary(params?: QueryParams) {
  return apiRequest<PaymentSummary>(`/reports/payment-summary${buildQuery(params)}`);
}

export interface ServerDrawerCount {
  date: string;
  openingCashPaise: number;
  manualCashInPaise: number;
  manualCashOutPaise: number;
  expectedCashPaise: number;
  countedCashPaise: number;
  variancePaise: number;
  countedAt: string;
  countedByUserId: string | null;
  countedByDeviceId: string | null;
  revision: number;
}

export function getDailyClosingDrawerCounts(params?: { from?: string; to?: string }) {
  return apiRequest<ServerDrawerCount[]>(`/reports/daily-closing/drawer-counts${buildQuery(params)}`, { background: true });
}

export interface AccountingMoneyEvidence {
  paise: number;
  amount: number;
}

export interface AccountingControlAccount {
  code: string;
  name: string;
  category: "asset" | "liability" | "income" | "expense";
  debitActivity: AccountingMoneyEvidence;
  creditActivity: AccountingMoneyEvidence;
  debitBalance: AccountingMoneyEvidence;
  creditBalance: AccountingMoneyEvidence;
}

export interface AccountingControlReport {
  status: "balanced" | "attention_required" | "no_data";
  calculationVersion: string;
  scope: "shop";
  periodActivity: { debit: AccountingMoneyEvidence; credit: AccountingMoneyEvidence; difference: AccountingMoneyEvidence };
  trialBalance: {
    debit: AccountingMoneyEvidence;
    credit: AccountingMoneyEvidence;
    difference: AccountingMoneyEvidence;
    accounts: AccountingControlAccount[];
  };
  coverage: {
    ledgerRows: number;
    mappedRows: number;
    unmappedRows: number;
    sourceGroups: number;
    balancedGroups: number;
    exceptionGroups: number;
  };
  exceptions: Array<{
    sourceType: string;
    sourceId: string | null;
    businessDate: string | null;
    debit: AccountingMoneyEvidence;
    credit: AccountingMoneyEvidence;
    difference: AccountingMoneyEvidence;
    unmappedEntryTypes: string[];
  }>;
  unmapped: Array<{
    id: string | null;
    sourceType: string;
    sourceId: string | null;
    entryType: string;
    amount: AccountingMoneyEvidence;
  }>;
  limitations: string[];
}

export function getAccountingControl(params: { from: string; to: string }) {
  return apiRequest<AccountingControlReport>(`/accounting/control${buildQuery(params)}`);
}
