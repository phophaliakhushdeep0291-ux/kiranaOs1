import { roundMoney } from "@/lib/money";
import { aggregateFinancialRows, type FinancialAggregationSnapshot } from "@/features/core/finance/services/FinancialAggregationService";
import type { LocalDashboardSnapshot } from "@/features/core/reports/queries";
import type { LocalReportSnapshot, ReportHourlySalesRow } from "@/features/core/reports/local-reporting";
import type { Bill, PaymentSummary, PnLReport, UdharSummary } from "@/types/api";

function money(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export interface DashboardStats {
  date: string;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number;
  billCount: number;
  totalOutstanding: number;
  outstandingCustomers: { customerId: string; customerName: string; mobile?: string | null; outstanding: number; }[];
  cash: number;
  upi: number;
  bank: number;
  credit: number;
  cashCollected: number;
  upiCollected: number;
  bankCollected: number;
  supplierCashPaid: number;
  supplierUpiPaid: number;
  supplierBankPaid: number;
  supplierDue: number;
  purchaseDue: number;
  previousRevenue: number;
  previousGrossProfit: number;
  previousCashCollected: number;
  previousUpiCollected: number;
  previousBankCollected: number;
  previousOutstanding: number;
  expensesToday: number;
  previousExpenses: number;
  source: string;
  hasBusinessData: boolean;
}

interface DashboardSources {
  date: string;
  financialSnapshot?: FinancialAggregationSnapshot | null;
  previousFinancialSnapshot?: FinancialAggregationSnapshot | null;
  ownerReport?: LocalReportSnapshot | null;
  localSnapshot: LocalDashboardSnapshot;
  backendPnL?: PnLReport;
  paymentSummary?: PaymentSummary;
  billsToday?: { total?: number };
  udharSummary?: UdharSummary;
}

/** Keep all dashboard layouts on the same source precedence and paise values. */
export function buildDashboardStats({ date, financialSnapshot, previousFinancialSnapshot, ownerReport, localSnapshot, backendPnL, paymentSummary, billsToday, udharSummary }: DashboardSources): DashboardStats {
  const reportToday = ownerReport?.today;
  const reportPayments = ownerReport?.range.from === date && ownerReport.range.to === date ? ownerReport.paymentBreakdown : undefined;
  const cached = localSnapshot.hasCache ? localSnapshot : undefined;
  const finance = financialSnapshot;
  const revenue = roundMoney(money(finance?.revenueToday ?? reportToday?.sales ?? cached?.revenue ?? backendPnL?.revenue));
  const grossProfit = roundMoney(money(finance?.profitToday ?? reportToday?.profitEstimate ?? cached?.grossProfit ?? backendPnL?.grossProfit));
  const cash = finance?.cashSalesToday ?? reportToday?.cashSales ?? cached?.cash ?? paymentSummary?.cash;
  const upi = finance?.upiSalesToday ?? reportToday?.upiSales ?? cached?.upi ?? paymentSummary?.upi;
  const bank = finance?.bankSalesToday ?? reportToday?.bankSales ?? cached?.bank ?? paymentSummary?.bank;
  const credit = finance?.udharSalesToday ?? reportToday?.udharSales ?? cached?.credit ?? paymentSummary?.credit;
  const todayUdhar = roundMoney(money(credit));
  const cashIn = roundMoney(money(cash));
  const upiIn = roundMoney(money(upi));
  const bankIn = roundMoney(money(bank));
  const supplierCashPaid = roundMoney(money(finance?.supplierCashPaidToday ?? reportPayments?.purchaseCashPaid));
  const supplierUpiPaid = roundMoney(money(finance?.supplierUpiPaidToday ?? reportPayments?.purchaseUpiPaid));
  const supplierBankPaid = roundMoney(money(finance?.supplierBankPaidToday ?? reportPayments?.purchaseBankPaid));
  const purchaseDue = roundMoney(money(finance?.purchaseDueToday ?? reportPayments?.purchaseDue));
  const supplierDue = roundMoney(money(finance?.supplierDue ?? reportPayments?.purchaseDue));
  const cashCollected = roundMoney(money(finance?.totalCashCollectedToday ?? reportPayments?.cashIn ?? cashIn));
  const upiCollected = roundMoney(money(finance?.totalUpiCollectedToday ?? reportPayments?.upiIn ?? upiIn));
  const bankCollected = roundMoney(money(finance?.totalBankCollectedToday ?? reportPayments?.bankIn ?? bankIn));
  const grossMarginPct = revenue > 0
    ? Math.round((grossProfit / revenue) * 100)
    : 0;
  const totalOutstanding = roundMoney(money(finance?.totalOutstandingUdhar ?? ownerReport?.pendingUdhar ?? cached?.totalOutstanding ?? udharSummary?.totalOutstanding));
  const recoveredToday = roundMoney(money(finance?.cashUdharRecoveryToday) + money(finance?.upiUdharRecoveryToday) + money(finance?.bankUdharRecoveryToday));
  const previousOutstanding = roundMoney(Math.max(0, totalOutstanding - todayUdhar + recoveredToday));
  // An empty result from IndexedDB is authoritative after the last debt is paid.
  const outstandingCustomers = finance?.outstandingCustomers
    ?? (ownerReport?.pendingUdhar === 0 ? [] : cached?.outstandingCustomers ?? udharSummary?.customers ?? []);
  const useLocal = Boolean(finance || ownerReport || cached);
  return {
    date, revenue, grossProfit, grossMarginPct,
    billCount: finance?.totalBillsToday ?? reportToday?.bills ?? cached?.billCount ?? billsToday?.total ?? 0,
    totalOutstanding, outstandingCustomers,
    cash: cashIn, upi: upiIn, bank: bankIn, credit: todayUdhar,
    cashCollected, upiCollected, bankCollected, supplierCashPaid, supplierUpiPaid, supplierBankPaid, supplierDue, purchaseDue,
    previousRevenue: roundMoney(money(previousFinancialSnapshot?.revenueToday)),
    previousGrossProfit: roundMoney(money(previousFinancialSnapshot?.profitToday)),
    previousCashCollected: roundMoney(money(previousFinancialSnapshot?.totalCashCollectedToday)),
    previousUpiCollected: roundMoney(money(previousFinancialSnapshot?.totalUpiCollectedToday)),
    previousBankCollected: roundMoney(money(previousFinancialSnapshot?.totalBankCollectedToday)),
    previousOutstanding,
    expensesToday: roundMoney(money(finance?.expensesToday)),
    previousExpenses: roundMoney(money(previousFinancialSnapshot?.expensesToday)),
    source: useLocal ? "IndexedDB" : "backend refresh",
    hasBusinessData: Boolean(finance?.hasLocalData || ownerReport?.hasLocalData || cached || revenue !== 0 || totalOutstanding > 0 || (!useLocal && billsToday?.total)),
  };
}

export function dashboardCashInDrawer(financialSnapshot: FinancialAggregationSnapshot | null, ownerReport: LocalReportSnapshot | null, dashboard: DashboardStats): number {
  const reportedCash = ownerReport?.range.from === dashboard.date && ownerReport.range.to === dashboard.date
    ? ownerReport.paymentBreakdown.netCashInHand : undefined;
  return roundMoney(money(financialSnapshot?.cashDrawer.expectedClosingCash ?? reportedCash ?? dashboard.cashCollected - dashboard.supplierCashPaid));
}

/** Refunds, split tenders and sync echoes use the same rules as the report. */
export function summariseDashboardPayments(bills: Bill[], range: { from: string; to: string }) {
  const result = aggregateFinancialRows({ bills: bills as (Bill & Record<string, unknown>)[], date: range.to, range });
  const { cashSalesToday: cash, upiSalesToday: upi, bankSalesToday: bank, udharSalesToday: credit, revenueToday: total } = result;
  return { cash, upi, bank, credit, total, other: roundMoney(total - cash - upi - bank - credit) };
}

export function dashboardHourlyChart(hours: ReportHourlySalesRow[]) {
  const buckets = Array.from({ length: 6 }, (_, index) => ({ date: `${String(index * 4).padStart(2, "0")}:00`, sales: 0 }));
  for (const row of hours) {
    const bucket = buckets[Math.floor(row.hour / 4)];
    if (bucket) bucket.sales = roundMoney(bucket.sales + row.sales);
  }
  return buckets;
}
