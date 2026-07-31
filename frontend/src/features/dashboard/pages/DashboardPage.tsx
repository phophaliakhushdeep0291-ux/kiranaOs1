import { roundMoney } from "@/lib/money";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  ShoppingCart, AlertTriangle, TrendingUp, Minus,
  Wallet, CreditCard, Smartphone, CalendarCheck, Sparkles, HandCoins,
  ReceiptText, Truck, PackagePlus, Layers, BarChart3, Building2, Landmark,
  ChefHat, Wrench, Pill, ClipboardList, Package, ArrowUpRight,
  ArrowDownRight, RefreshCw, CheckCircle2, XCircle, ChevronRight, ChevronDown, Users,
  Wifi, Cloud, MonitorSmartphone,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { useAuth } from "@/features/auth/useAuth";
import { getLocalDashboardSnapshot, useGetPaymentSummary, useGetPnL, useGetUdharSummary, useListBills, warmRecentLocalCache, type LocalDashboardSnapshot } from "@/lib/api/client";
import { buildLocalReportSnapshot, type LocalReportSnapshot } from "@/features/reports/local-reporting";
import { FinancialAggregationService, type FinancialAggregationSnapshot } from "@/features/finance/services/FinancialAggregationService";
import { offlineDB } from "@/lib/offline/db";
import { seedDemoShopData } from "@/features/demo/demo-shop-data";
import { useAppLanguage } from "@/features/settings/i18n";
import { useFeature } from "@/features/subscription";
import { useToast } from "@/hooks/use-toast";
import { useOfflineStatus } from "@/features/sync";
import { dedupeBillsForDisplay } from "@/features/sync/bill-reconciliation";
import { fromBaseQty, productDisplayUnit } from "@/features/products/pages/product-pricing";
import { DataTableCard, EmptyState, MoneyBadge, PageHeader, PageShell, StatCard, StatsGrid, SyncBadge } from "@/components/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBusinessType, type BusinessType, type BusinessTypeDefinition, type QuickActionIconKey, type QuickActionColorKey } from "@/features/settings/business-types";
import { getShopWorkflow } from "@/features/settings/shop-workflows";
import { cn } from "@/lib/utils";
import type { Bill, Product } from "@/types/api";

const DASH_CARD = "min-w-0 rounded-[12px] border border-[#e2e8f1] bg-white shadow-[0_4px_16px_rgba(32,55,92,0.045),0_1px_2px_rgba(32,55,92,0.025)] ring-1 ring-white transition-[border-color,box-shadow,transform] duration-300 ease-out dark:border-slate-800 dark:bg-card dark:ring-slate-800";
const DASH_CARD_INTERACTIVE = "hover:-translate-y-0.5 hover:border-[#cbd8e8] hover:shadow-[0_10px_26px_rgba(32,55,92,0.075)] active:translate-y-0";
const DASH_TITLE = "font-sans text-[14px] font-semibold leading-5 text-[#13223f] dark:text-card-foreground";
const DASH_MUTED = "text-[#62708a] dark:text-muted-foreground";

// Recent-bills payment label: derive the real tender/credit mode from the saved
// bill instead of assuming cash. A bill with any outstanding credit must read
// "Udhar" (not "Cash") so the owner can tell collected sales from money owed.
function recentBillPaymentMode(bill: Record<string, unknown>): string {
  const num = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const outstanding = Math.max(
    num(bill.creditAmount ?? bill.credit_amount),
    num(bill.udharAmount ?? bill.udhar_amount),
    num(bill.dueAmount ?? bill.due_amount),
    num(bill.outstandingAmount ?? bill.outstanding_amount),
  );
  const status = String(bill.paymentStatus ?? bill.payment_status ?? "").toLowerCase();
  if (outstanding > 0 || ["credit", "partial", "unpaid", "due"].includes(status)) return "udhar";

  const explicit = String(bill.paymentMode ?? bill.payment_mode ?? "").toLowerCase();
  if (explicit && explicit !== "credit") return explicit;

  const payments = Array.isArray(bill.payments) ? (bill.payments as Array<Record<string, unknown>>) : [];
  const tenderModes = [...new Set(
    payments
      .filter((payment) => String(payment.mode ?? "").toLowerCase() !== "credit" && num(payment.amount) > 0)
      .map((payment) => String(payment.mode ?? "").toLowerCase()),
  )];
  if (tenderModes.length > 1) return "split";
  if (tenderModes.length === 1) return tenderModes[0];
  return "cash";
}

function compactBillNumber(value: unknown): string {
  const billNumber = String(value ?? "").trim();
  const numericSuffix = billNumber.match(/(\d+)(?!.*\d)/)?.[1];
  if (!numericSuffix) return billNumber || "—";
  return String(Number.parseInt(numericSuffix, 10));
}

function RecentBillPaymentBadge({ mode }: { mode: string }) {
  const normalized = mode.trim().toLowerCase();
  const style = normalized === "cash"
    ? "border-[#c7efd4] bg-[#e8f9ee] text-[#159447]"
    : normalized === "upi" || normalized === "bank" || normalized === "bank_transfer"
      ? "border-[#ccdcff] bg-[#eaf1ff] text-[#2864e8]"
      : normalized === "udhar" || normalized === "credit"
        ? "border-[#ffdda8] bg-[#fff3e1] text-[#e98400]"
        : normalized === "split" || normalized === "card"
          ? "border-[#ded3ff] bg-[#f1edff] text-[#6e4ce1]"
          : "border-[#dce4ef] bg-[#f4f7fb] text-[#5d6d84]";
  const label = normalized === "upi"
    ? "UPI"
    : normalized === "bank_transfer"
      ? "Bank"
      : normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return (
    <span className={cn("inline-flex min-w-[44px] items-center justify-center rounded-[6px] border px-2 py-1 text-[10px] font-black leading-none", style)}>
      {label}
    </span>
  );
}

// ─── icon / color maps ───────────────────────────────────────────────────────

const ACTION_ICON: Record<QuickActionIconKey, ReactNode> = {
  billing:   <ShoppingCart  size={22} aria-hidden="true" />,
  payment:   <HandCoins     size={22} aria-hidden="true" />,
  purchase:  <Truck         size={22} aria-hidden="true" />,
  closing:   <CalendarCheck size={22} aria-hidden="true" />,
  inventory: <PackagePlus   size={22} aria-hidden="true" />,
  products:  <Layers        size={22} aria-hidden="true" />,
  reports:   <BarChart3     size={22} aria-hidden="true" />,
  suppliers: <Building2     size={22} aria-hidden="true" />,
};

const ACTION_ICON_BG: Record<QuickActionColorKey, string> = {
  primary: "bg-primary/10 text-primary",
  sky:     "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  amber:   "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  violet:  "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rose:    "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  orange:  "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  teal:    "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function money(n: number | undefined | null) {
  const value = Number(n ?? 0);
  return Number.isFinite(value) ? value : 0;
}



function fmt(n: number | undefined | null) {
  return `Rs ${money(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pctChange(current: number, previous: number): number | null {
  const prev = money(previous);
  if (prev <= 0) return null;
  return Math.round(((money(current) - prev) / prev) * 1000) / 10;
}

function sortTime(value: unknown): number {
  if (typeof value !== "string") return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function activeProduct(product: Product & Record<string, unknown>): boolean {
  if (product.deletedAt || product.deleted_at) return false;
  if (product.isActive === false) return false;
  return String(product.status ?? "active").toLowerCase() !== "deleted";
}

type DashboardPeriod = "today" | "week" | "month";

const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
};

function dashboardPeriodRange(period: DashboardPeriod) {
  const now = new Date();
  const to = format(now, "yyyy-MM-dd");
  if (period === "today") return { from: to, to };
  if (period === "month") return { from: format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd"), to };
  return { from: format(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), "yyyy-MM-dd"), to };
}

function previousDashboardRange(range: { from: string; to: string }) {
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousTo = new Date(start);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - dayCount + 1);
  return { from: format(previousFrom, "yyyy-MM-dd"), to: format(previousTo, "yyyy-MM-dd") };
}

function billDateKey(bill: Bill): string {
  const record = bill as Bill & { created_at?: string; billDate?: string; date?: string };
  return String(bill.createdAt ?? record.created_at ?? record.billDate ?? record.date ?? "").slice(0, 10);
}

function dashboardBillAmount(bill: Bill): number {
  return roundMoney(money(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount));
}

function isDashboardSaleBill(bill: Bill): boolean {
  // Estimates (kacha bills) count as sales — same money/stock effects, only the EST- series differs.
  const status = String(bill.status ?? "").toLowerCase();
  return !status.includes("cancel");
}

function billsInsideRange(bills: Bill[], range: { from: string; to: string }): Bill[] {
  return bills.filter((bill) => {
    const date = billDateKey(bill);
    return isDashboardSaleBill(bill) && date >= range.from && date <= range.to;
  });
}

function buildDashboardSalesChart(period: DashboardPeriod, range: { from: string; to: string }, bills: Bill[]) {
  if (period === "today") {
    const points = Array.from({ length: 6 }, (_, index) => ({ key: index, date: `${String(index * 4).padStart(2, "0")}:00`, sales: 0 }));
    for (const bill of bills) {
      const record = bill as Bill & { created_at?: string };
      const raw = String(bill.createdAt ?? record.created_at ?? "");
      const parsed = new Date(raw);
      const hour = Number.isFinite(parsed.getTime()) ? parsed.getHours() : 0;
      points[Math.min(5, Math.floor(hour / 4))].sales += dashboardBillAmount(bill);
    }
    return points.map(({ date, sales }) => ({ date, sales: roundMoney(sales) }));
  }

  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  const points: Array<{ dateKey: string; date: string; sales: number }> = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    points.push({ dateKey: format(cursor, "yyyy-MM-dd"), date: format(cursor, "d MMM"), sales: 0 });
  }
  const byDate = new Map(points.map((point) => [point.dateKey, point]));
  for (const bill of bills) {
    const point = byDate.get(billDateKey(bill));
    if (point) point.sales += dashboardBillAmount(bill);
  }
  return points.map(({ date, sales }) => ({ date, sales: roundMoney(sales) }));
}

function summariseDashboardPayments(bills: Bill[]) {
  const summary = { cash: 0, upi: 0, bank: 0, credit: 0, other: 0, total: 0 };
  for (const bill of bills) {
    const record = bill as Bill & Record<string, unknown>;
    const total = dashboardBillAmount(bill);
    const paid = Math.max(0, money(bill.paidAmount ?? bill.buyerPaidAmount));
    const explicitCredit = money(Number(bill.creditAmount ?? record.credit_amount ?? record.dueAmount ?? record.due_amount ?? 0));
    const mode = recentBillPaymentMode(record);
    const credit = Math.max(0, Math.min(total, explicitCredit || (mode === "udhar" ? total - paid : 0)));
    const payments = Array.isArray(bill.payments) ? bill.payments as Array<Record<string, unknown>> : [];
    let tenderAccounted = 0;
    for (const payment of payments) {
      const amount = Math.max(0, money(payment.amount as number));
      const paymentMode = String(payment.mode ?? "").toLowerCase();
      if (paymentMode === "cash") summary.cash += amount;
      else if (paymentMode === "upi") summary.upi += amount;
      else if (["bank", "bank_transfer", "card"].includes(paymentMode)) summary.bank += amount;
      else if (paymentMode !== "credit") summary.other += amount;
      if (paymentMode !== "credit") tenderAccounted += amount;
    }
    const remainingPaid = Math.max(0, Math.min(total - credit, paid || total - credit) - tenderAccounted);
    if (remainingPaid > 0) {
      if (mode === "cash") summary.cash += remainingPaid;
      else if (mode === "upi") summary.upi += remainingPaid;
      else if (["bank", "bank_transfer", "card"].includes(mode)) summary.bank += remainingPaid;
      else summary.other += remainingPaid;
    }
    summary.credit += credit;
    summary.total += total;
  }
  return Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, roundMoney(value)])) as typeof summary;
}

// ─── shared prop types ────────────────────────────────────────────────────────

type DrilldownType = "revenue" | "profit" | "collection";

interface DashboardStats {
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

interface LayoutProps {
  businessType: BusinessType;
  btDef: BusinessTypeDefinition;
  dashboard: DashboardStats;
  ownerReport: LocalReportSnapshot | null;
  financialSnapshot: FinancialAggregationSnapshot | null;
  isLoading: boolean;
  cashInDrawer: number;
  lowStockCount: number;
  pendingSyncCount: number;
  hasUnsyncedOperations: boolean;
  seedingDemo: boolean;
  userName: string;
  onLoadDemo: () => void;
  openDrilldown: (t: DrilldownType) => void;
  drilldownKeyHandler: (t: DrilldownType) => (e: KeyboardEvent<HTMLDivElement>) => void;
}

// ─── main data-loading shell ─────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const { businessType, def: btDef } = useBusinessType();
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(new Date(Date.now() - 86_400_000), "yyyy-MM-dd");
  const [localSnapshot, setLocalSnapshot] = useState<LocalDashboardSnapshot>(() => getLocalDashboardSnapshot());
  const [ownerReport, setOwnerReport] = useState<LocalReportSnapshot | null>(null);
  const [financialSnapshot, setFinancialSnapshot] = useState<FinancialAggregationSnapshot | null>(null);
  const [previousFinancialSnapshot, setPreviousFinancialSnapshot] = useState<FinancialAggregationSnapshot | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownType | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const profitEstimateFeature = useFeature("profit_loss_estimate");
  const canFetchBackendPnL = profitEstimateFeature.allowed;

  useEffect(() => {
    const refreshLocal = () => setLocalSnapshot(getLocalDashboardSnapshot());
    refreshLocal();
    window.addEventListener("kirana:local-data-changed", refreshLocal);
    void warmRecentLocalCache(30).then(setLocalSnapshot).catch(() => refreshLocal());
    const refreshReport = () => {
      void buildLocalReportSnapshot({ from: format(new Date(Date.now() - 6 * 86_400_000), "yyyy-MM-dd"), to: today }).then(setOwnerReport).catch(() => undefined);
      void Promise.all([
        FinancialAggregationService.buildSnapshot(today),
        FinancialAggregationService.buildSnapshot(yesterday),
      ]).then(([current, previous]) => {
        setFinancialSnapshot(current);
        setPreviousFinancialSnapshot(previous);
      }).catch(() => undefined);
    };
    refreshReport();
    window.addEventListener("kirana:sync-queue-updated", refreshReport);
    window.addEventListener("kirana:local-data-changed", refreshReport);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refreshLocal);
      window.removeEventListener("kirana:local-data-changed", refreshReport);
      window.removeEventListener("kirana:sync-queue-updated", refreshReport);
    };
  }, [today, yesterday]);

  const pnl = useGetPnL({ from: today, to: today }, { query: { enabled: canFetchBackendPnL, staleTime: 2 * 60_000, retry: 0 } });
  const udharSummary = useGetUdharSummary({ query: { staleTime: 2 * 60_000, retry: 1 } });
  const paymentSummary = useGetPaymentSummary(undefined, { query: { staleTime: 2 * 60_000, retry: 1 } });
  const billsToday = useListBills({ from: today, to: today, limit: 1 }, { query: { staleTime: 2 * 60_000, retry: 1 } });
  const backendPnL = canFetchBackendPnL ? pnl.data : undefined;

  const dashboard = useMemo((): DashboardStats => {
    const reportToday = ownerReport?.today;
    const reportPayments = ownerReport?.paymentBreakdown;
    const finance = financialSnapshot;
    const revenue = roundMoney(money(finance?.revenueToday ?? reportToday?.sales ?? localSnapshot.revenue ?? backendPnL?.revenue));
    const grossProfit = roundMoney(money(finance?.profitToday ?? reportToday?.profitEstimate ?? localSnapshot.grossProfit ?? backendPnL?.grossProfit));
    const cash = finance?.cashSalesToday ?? reportToday?.cashSales ?? localSnapshot.cash ?? paymentSummary.data?.cash;
    const upi = finance?.upiSalesToday ?? reportToday?.upiSales ?? localSnapshot.upi ?? paymentSummary.data?.upi;
    const bank = finance?.bankSalesToday ?? reportToday?.bankSales ?? localSnapshot.bank ?? paymentSummary.data?.bank;
    const credit = finance?.udharSalesToday ?? reportToday?.udharSales ?? localSnapshot.credit ?? paymentSummary.data?.credit;
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
      : roundMoney(money(localSnapshot.grossMarginPct ?? backendPnL?.grossMarginPct));
    const totalOutstanding = roundMoney(money(finance?.totalOutstandingUdhar ?? ownerReport?.pendingUdhar ?? localSnapshot.totalOutstanding ?? udharSummary.data?.totalOutstanding));
    const recoveredToday = roundMoney(money(finance?.cashUdharRecoveryToday) + money(finance?.upiUdharRecoveryToday) + money(finance?.bankUdharRecoveryToday));
    const previousOutstanding = roundMoney(Math.max(0, totalOutstanding - todayUdhar + recoveredToday));
    const outstandingCustomers = finance?.outstandingCustomers?.length
      ? finance.outstandingCustomers
      : localSnapshot.outstandingCustomers.length > 0
        ? localSnapshot.outstandingCustomers
        : udharSummary.data?.customers ?? [];
    const useLocal = finance?.hasLocalData || ownerReport?.hasLocalData || localSnapshot.hasCache;
    return {
      revenue, grossProfit, grossMarginPct,
      billCount: finance?.totalBillsToday ?? reportToday?.bills ?? localSnapshot.billCount ?? billsToday.data?.total ?? 0,
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
      hasBusinessData: Boolean(useLocal || revenue > 0 || totalOutstanding > 0 || billsToday.data?.total),
    };
  }, [financialSnapshot, previousFinancialSnapshot, ownerReport, localSnapshot, backendPnL, billsToday.data, udharSummary.data, paymentSummary.data]);

  const isLoading = !financialSnapshot && !ownerReport && !localSnapshot.hasCache && (pnl.isLoading || udharSummary.isLoading || paymentSummary.isLoading);
  const cashInDrawer = Math.max(
    0,
    roundMoney(money(financialSnapshot?.cashDrawer.expectedClosingCash ?? ownerReport?.paymentBreakdown.netCashInHand ?? dashboard.cashCollected - dashboard.supplierCashPaid)),
  );
  const lowStockCount = ownerReport?.lowStock.length ?? 0;
  const pendingSyncCount = ownerReport?.pendingSyncCount ?? 0;
  const hasUnsyncedOperations = Boolean(ownerReport?.hasUnsyncedOperations);

  const openDrilldown = (next: DrilldownType) => setDrilldown(next);
  const drilldownKeyHandler = (next: DrilldownType) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDrilldown(next); }
  };

  const loadDemoShop = async () => {
    setSeedingDemo(true);
    try {
      const result = await seedDemoShopData();
      toast({
        title: result.created ? "Demo shop loaded" : "Demo shop already loaded",
        description: "The dashboard now has sample products, sales, udhar, and supplier due.",
      });
    } catch {
      toast({ title: "Could not load demo shop", description: "Please try again after local storage is available.", variant: "destructive" });
    } finally {
      setSeedingDemo(false);
    }
  };

  const layoutProps: LayoutProps = {
    businessType, btDef, dashboard, ownerReport, financialSnapshot, isLoading,
    cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations,
    seedingDemo, userName: user?.name ?? "Owner",
    onLoadDemo: () => void loadDemoShop(),
    openDrilldown, drilldownKeyHandler,
  };

  const variant = btDef.dashboardVariant;

  return (
    <>
      {variant === "restaurant" ? <RestaurantLayout {...layoutProps} /> :
       variant === "technical"  ? <TechnicalLayout  {...layoutProps} /> :
       variant === "medical"    ? <MedicalLayout    {...layoutProps} /> :
                                  <GeneralLayout     {...layoutProps} />}
      <DashboardDrilldownDialog
        type={drilldown}
        snapshot={financialSnapshot}
        cashInDrawer={cashInDrawer}
        onOpenChange={(open) => { if (!open) setDrilldown(null); }}
      />
    </>
  );
}

// ─── GENERAL layout (kirana, clothing, footwear, electronics, etc.) ───────────

type PaymentSlice = { label: string; value: number; color: string; dot: string };

function GeneralLayout({ businessType, dashboard, ownerReport, isLoading, lowStockCount, seedingDemo, onLoadDemo, openDrilldown }: LayoutProps) {
  const { isOnline, isSyncing, pendingCount, failedCount } = useOfflineStatus();
  const [, navigate] = useLocation();
  const [period, setPeriod] = useState<DashboardPeriod>("week");
  const periodRange = useMemo(() => dashboardPeriodRange(period), [period]);
  const previousPeriodRange = useMemo(() => previousDashboardRange(periodRange), [periodRange]);
  const [periodReport, setPeriodReport] = useState<LocalReportSnapshot | null>(null);
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [productsById, setProductsById] = useState<Record<string, Product>>({});
  const [localRecentBills, setLocalRecentBills] = useState<Bill[]>([]);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
    typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches,
  );

  const recentBillsQuery = useListBills({ limit: 10 }, { query: { staleTime: 60_000 } });
  const periodBillsQuery = useListBills({ ...periodRange, limit: 1000 }, { query: { staleTime: 60_000 } });
  const previousPeriodBillsQuery = useListBills({ ...previousPeriodRange, limit: 1000 }, { query: { staleTime: 60_000 } });

  const lowStockItems = ownerReport?.lowStock ?? [];

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const updateViewport = () => setIsDesktopViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshPeriodReport = () => {
      void buildLocalReportSnapshot(periodRange).then((next) => {
        if (!cancelled) setPeriodReport(next);
      }).catch(() => undefined);
    };
    refreshPeriodReport();
    window.addEventListener("kirana:local-data-changed", refreshPeriodReport);
    window.addEventListener("kirana:sync-queue-updated", refreshPeriodReport);
    return () => {
      cancelled = true;
      window.removeEventListener("kirana:local-data-changed", refreshPeriodReport);
      window.removeEventListener("kirana:sync-queue-updated", refreshPeriodReport);
    };
  }, [periodRange]);

  useEffect(() => {
    let cancelled = false;
    const refreshProducts = () => {
      void offlineDB.getAll<Product & Record<string, unknown>>("products")
        .then((rows) => {
          if (cancelled) return;
          const activeRows = rows.filter(activeProduct);
          setProductsById(Object.fromEntries(activeRows.map((product) => [product.id, product])));
          setRecentProducts(
            activeRows
              .sort((a, b) => sortTime(b.updatedAt ?? b.updated_at ?? b.createdAt ?? b.created_at) - sortTime(a.updatedAt ?? a.updated_at ?? a.createdAt ?? a.created_at))
              .slice(0, 8),
          );
        })
        .catch(() => {
          if (!cancelled) {
            setProductsById({});
            setRecentProducts([]);
          }
        });
    };
    refreshProducts();
    window.addEventListener("kirana:local-data-changed", refreshProducts);
    window.addEventListener("kirana:sync-queue-updated", refreshProducts);
    return () => {
      cancelled = true;
      window.removeEventListener("kirana:local-data-changed", refreshProducts);
      window.removeEventListener("kirana:sync-queue-updated", refreshProducts);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshBills = () => {
      void Promise.all([
        offlineDB.getAll<Bill>("bills"),
        offlineDB.getAll<Record<string, unknown>>("bill_items"),
        offlineDB.getAll<Record<string, unknown>>("payments"),
      ]).then(([rows, items, payments]) => {
        const itemsByBill = new Map<string, Record<string, unknown>[]>();
        const paymentsByBill = new Map<string, Record<string, unknown>[]>();
        for (const item of items) {
          const billId = String(item.billId ?? item.bill_id ?? "");
          if (billId) itemsByBill.set(billId, [...(itemsByBill.get(billId) ?? []), item]);
        }
        for (const payment of payments) {
          const billId = String(payment.billId ?? payment.bill_id ?? "");
          if (billId) paymentsByBill.set(billId, [...(paymentsByBill.get(billId) ?? []), payment]);
        }
        if (!cancelled) {
          setLocalRecentBills(rows.filter(isDashboardSaleBill).map((bill) => ({
            ...bill,
            items: Array.isArray(bill.items) ? bill.items : itemsByBill.get(bill.id) ?? [],
            payments: Array.isArray(bill.payments) ? bill.payments : paymentsByBill.get(bill.id) ?? [],
          })));
        }
      }).catch(() => {
        if (!cancelled) setLocalRecentBills([]);
      });
    };
    refreshBills();
    window.addEventListener("kirana:local-data-changed", refreshBills);
    window.addEventListener("kirana:sync-queue-updated", refreshBills);
    return () => {
      cancelled = true;
      window.removeEventListener("kirana:local-data-changed", refreshBills);
      window.removeEventListener("kirana:sync-queue-updated", refreshBills);
    };
  }, []);

  const periodBills = useMemo(
    () => billsInsideRange(periodBillsQuery.data?.bills ?? [], periodRange),
    [periodBillsQuery.data?.bills, periodRange],
  );
  const previousPeriodBills = useMemo(
    () => billsInsideRange(previousPeriodBillsQuery.data?.bills ?? [], previousPeriodRange),
    [previousPeriodBillsQuery.data?.bills, previousPeriodRange],
  );
  const periodPaymentSummary = useMemo(() => summariseDashboardPayments(periodBills), [periodBills]);
  const previousPeriodSales = useMemo(
    () => previousPeriodBills.reduce((sum, bill) => sum + dashboardBillAmount(bill), 0),
    [previousPeriodBills],
  );
  const activePeriodReport = periodReport?.range.from === periodRange.from && periodReport.range.to === periodRange.to
    ? periodReport
    : null;
  const periodSales = activePeriodReport
    ? activePeriodReport.selected.sales
    : periodBills.length > 0
      ? periodPaymentSummary.total
    : period === "today"
      ? dashboard.revenue
      : period === "week"
        ? ownerReport?.selected.sales ?? 0
        : 0;
  const periodSalesDelta = pctChange(periodSales, activePeriodReport?.previousSelected.sales ?? previousPeriodSales);

  // Build chart points from the selected period. The query may initially paint
  // from the offline cache, so bills are filtered locally as well as by the API.
  const salesChartData = useMemo(() => {
    if (activePeriodReport) {
      if (period === "today") {
        return Array.from({ length: 6 }, (_, index) => ({
          date: `${String(index * 4).padStart(2, "0")}:00`,
          sales: index === 5 ? activePeriodReport.selected.sales : 0,
        }));
      }
      return activePeriodReport.dailyTrend.map((point) => ({ date: point.label, sales: point.sales }));
    }
    const points = buildDashboardSalesChart(period, periodRange, periodBills);
    if (period === "today" && periodBills.length === 0 && dashboard.revenue > 0 && points.length > 0) {
      points[points.length - 1].sales = dashboard.revenue;
    }
    return points;
  }, [activePeriodReport, period, periodRange, periodBills, dashboard.revenue]);

  const paymentBreakdown = useMemo<PaymentSlice[]>(() => {
    const useDailyFallback = !activePeriodReport && periodBills.length === 0 && period === "today";
    const cash = activePeriodReport?.selected.cashSales ?? (useDailyFallback ? dashboard.cash : periodPaymentSummary.cash);
    const upi = activePeriodReport?.selected.upiSales ?? (useDailyFallback ? dashboard.upi : periodPaymentSummary.upi);
    const bank = activePeriodReport?.selected.bankSales ?? (useDailyFallback ? dashboard.bank : periodPaymentSummary.bank);
    const credit = activePeriodReport?.selected.udharSales ?? (useDailyFallback ? dashboard.credit : periodPaymentSummary.credit);
    const other = useDailyFallback
      ? Math.max(0, roundMoney(dashboard.revenue - cash - upi - bank - credit))
      : activePeriodReport
        ? Math.max(0, roundMoney(periodSales - cash - upi - bank - credit))
        : periodPaymentSummary.other;
    return [
      { label: "Cash", value: cash, color: "#2fc45a", dot: "bg-[#2fc45a]" },
      { label: "UPI", value: upi, color: "#316df4", dot: "bg-[#316df4]" },
      { label: "Bank", value: bank, color: "#06a4d9", dot: "bg-[#06a4d9]" },
      { label: "Udhar", value: credit, color: "#f2a20b", dot: "bg-[#f2a20b]" },
      { label: "Other", value: other, color: "#7557e8", dot: "bg-[#7557e8]" },
    ].filter((row) => row.value > 0);
  }, [activePeriodReport, dashboard.bank, dashboard.cash, dashboard.credit, dashboard.revenue, dashboard.upi, period, periodBills.length, periodPaymentSummary, periodSales]);

  const recentBills = useMemo(
    () => (dedupeBillsForDisplay([...(recentBillsQuery.data?.bills ?? []), ...localRecentBills]) as unknown as Bill[])
      .sort((a, b) => sortTime(b.createdAt) - sortTime(a.createdAt)),
    [recentBillsQuery.data?.bills, localRecentBills],
  );
  const yesterdaySales = dashboard.previousRevenue || salesChartData[5]?.sales || 0;
  // null = no prior-day baseline to compare against → shown as "—" rather than a misleading 0%.
  const salesDelta = pctChange(dashboard.revenue, yesterdaySales);
  const cashDelta = pctChange(dashboard.cashCollected, dashboard.previousCashCollected);
  const upiDelta = pctChange(dashboard.upiCollected, dashboard.previousUpiCollected);
  const bankDelta = pctChange(dashboard.bankCollected, dashboard.previousBankCollected);
  const outstandingDelta = pctChange(dashboard.totalOutstanding, dashboard.previousOutstanding);
  const profitDelta = pctChange(dashboard.grossProfit, dashboard.previousGrossProfit);
  const expenseDelta = pctChange(dashboard.expensesToday, dashboard.previousExpenses);
  const avgBillValue = dashboard.billCount > 0 ? Math.round(dashboard.revenue / dashboard.billCount) : 0;
  const syncStatusValue = failedCount > 0 ? "Review needed" : pendingCount > 0 ? `${pendingCount} pending` : "Up to date";
  const syncHealthGood = failedCount === 0 && pendingCount === 0;

  return (
    <>
      {!isDesktopViewport && <MobileGeneralDashboard
        businessType={businessType}
        dashboard={dashboard}
        ownerReport={ownerReport}
        salesChartData={salesChartData}
        recentBills={recentBills}
        recentProducts={recentProducts}
        isOnline={isOnline}
        isSyncing={isSyncing}
        pendingCount={pendingCount}
        failedCount={failedCount}
        salesDelta={salesDelta}
        outstandingDelta={outstandingDelta}
        profitDelta={profitDelta}
        expenseDelta={expenseDelta}
        lowStockCount={lowStockCount}
        period={period}
        onPeriodChange={setPeriod}
        periodSales={periodSales}
        periodSalesDelta={periodSalesDelta}
      />}
      {isDesktopViewport && <div className="w-full min-w-0 space-y-4 overflow-x-hidden bg-white p-4 font-sans sm:p-5 lg:p-5 2xl:p-6">

      {!dashboard.hasBusinessData && (
        <section className="overflow-hidden rounded-[18px] border border-[var(--brand-border)] bg-[linear-gradient(135deg,#f3f7ff_0%,#ffffff_62%)] p-5 shadow-[0_14px_36px_rgba(7,95,255,0.08)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-xl">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand)]">Quick start</p>
              <h2 className="mt-1 font-display text-[22px] font-black text-[#071333]">Open your counter in three simple steps</h2>
              <p className="mt-1 text-[13px] font-medium text-[#52627e]">Set up one product, complete a test bill, and check your receipt before serving customers.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 xl:w-[650px]">
              <QuickStartLink href="/products?add=1" step="1" icon={<PackagePlus size={17} />} title="Add products" detail="Name, price and stock" />
              <QuickStartLink href="/billing" step="2" icon={<ShoppingCart size={17} />} title="Create a test bill" detail="Try cash or UPI" />
              <QuickStartLink href="/settings/printer" step="3" icon={<Wrench size={17} />} title="Test your receipt" detail="Printer and shop details" />
            </div>
          </div>
        </section>
      )}

      <ShopWorkflowPanel businessType={businessType} compact />

      {/* Counter focus */}
      <div className="grid min-w-0 auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <KpiCard
          label="Today's Sales"
          value={fmtRs(dashboard.revenue)}
          delta={salesDelta}
          deltaLabel="vs yesterday"
          icon={<ShoppingCart size={18} />}
          iconBg="border border-[var(--brand-border)] bg-[#eaf2ff] text-[var(--brand)] shadow-[0_0_0_4px_rgba(7,95,255,0.035),0_10px_26px_rgba(7,95,255,0.22)]"
          color="var(--brand)"
          spark={mobileSparkline(yesterdaySales, dashboard.revenue)}
          loading={isLoading}
          onClick={() => openDrilldown("revenue")}
        />
        <KpiCard
          label="Cash Collected"
          value={fmtRs(dashboard.cashCollected)}
          delta={cashDelta}
          deltaLabel="vs yesterday"
          icon={<Wallet size={18} />}
          iconBg="border border-[#c8f1d5] bg-[#e7faee] text-[#11a84b] shadow-[0_0_0_4px_rgba(17,168,75,0.035),0_10px_26px_rgba(17,168,75,0.20)]"
          color="#18ad50"
          spark={mobileSparkline(dashboard.previousCashCollected, dashboard.cashCollected)}
          loading={isLoading}
          onClick={() => openDrilldown("collection")}
        />
        <KpiCard
          label="UPI Collected"
          value={fmtRs(dashboard.upiCollected)}
          delta={upiDelta}
          deltaLabel="vs yesterday"
          icon={<Smartphone size={18} />}
          iconBg="border border-[#ddd3ff] bg-[#f0ebff] text-[#7047eb] shadow-[0_0_0_4px_rgba(112,71,235,0.035),0_10px_26px_rgba(112,71,235,0.20)]"
          color="#7047eb"
          spark={mobileSparkline(dashboard.previousUpiCollected, dashboard.upiCollected)}
          loading={isLoading}
          onClick={() => openDrilldown("collection")}
        />
        <Link href="/money-statement?mode=bank" className="block h-full min-w-0">
          <KpiCard
            label="Bank Collected"
            value={fmtRs(dashboard.bankCollected)}
            delta={bankDelta}
            deltaLabel="vs yesterday"
            icon={<Landmark size={18} />}
            iconBg="border border-[var(--brand-border)] bg-[#eaf2ff] text-[var(--brand)] shadow-[0_0_0_4px_rgba(7,95,255,0.035),0_10px_26px_rgba(7,95,255,0.20)]"
            color="var(--brand)"
            spark={mobileSparkline(dashboard.previousBankCollected, dashboard.bankCollected)}
            loading={isLoading}
          />
        </Link>
        <Link href="/customers?filter=udhar" className="block h-full min-w-0">
          <KpiCard
            label="Outstanding Udhar"
            value={fmtRs(dashboard.totalOutstanding)}
            delta={outstandingDelta}
            deltaLabel="vs yesterday"
            deltaPositiveIsBad
            icon={<AlertTriangle size={18} />}
            iconBg="border border-[#ffcfd7] bg-[#ffecef] text-[#ff2748] shadow-[0_0_0_4px_rgba(255,39,72,0.035),0_10px_26px_rgba(255,39,72,0.20)]"
            color="#ff304f"
            spark={mobileSparkline(dashboard.previousOutstanding, dashboard.totalOutstanding)}
            loading={isLoading}
          />
        </Link>
        <KpiCard
          label="Profit (Est.)"
          value={fmtRs(dashboard.grossProfit)}
          delta={profitDelta}
          deltaLabel="vs yesterday"
          icon={<TrendingUp size={18} />}
          iconBg="border border-[#c8f1d5] bg-[#e7faee] text-[#11a84b] shadow-[0_0_0_4px_rgba(17,168,75,0.035),0_10px_26px_rgba(17,168,75,0.20)]"
          color="#18ad50"
          spark={mobileSparkline(dashboard.previousGrossProfit, dashboard.grossProfit)}
          loading={isLoading}
          onClick={() => openDrilldown("profit")}
        />
        <Link href="/inventory" className="block h-full min-w-0">
          <KpiCard
            label="Low Stock Items"
            value={String(lowStockCount)}
            delta={null}
            footer={<span className="text-xs font-semibold text-primary">View all</span>}
            icon={<Package size={18} />}
            iconBg={lowStockCount > 0 ? "border border-[#ffdca8] bg-[#fff2df] text-[#ff8500] shadow-[0_0_0_4px_rgba(255,133,0,0.035),0_10px_26px_rgba(255,133,0,0.22)]" : "border border-[#c8f1d5] bg-[#e7faee] text-[#11a84b] shadow-[0_0_0_4px_rgba(17,168,75,0.035),0_10px_26px_rgba(17,168,75,0.20)]"}
            loading={isLoading}
          />
        </Link>
      </div>

      {/* Sales, payments, and stock */}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2 2xl:auto-rows-[clamp(270px,29dvh,390px)] 2xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.68fr)_minmax(320px,0.9fr)]">

        {/* Sales Overview */}
        <section className={cn(DASH_CARD, "flex h-full min-h-[320px] flex-col overflow-hidden p-4 lg:col-span-2 2xl:col-span-1 2xl:min-h-0 2xl:p-5")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className={DASH_TITLE}>Sales Overview</p>
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full border border-[#b9c7dc] text-[10px] font-black text-[#60708a]">i</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                <p className="font-sans text-[24px] font-bold leading-none text-[var(--brand-ink)] dark:text-card-foreground">{fmtRs(periodSales)}</p>
                <DashboardPeriodSelect value={period} onChange={setPeriod} />
                {periodSalesDelta !== null && (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                    <span className={cn("inline-flex items-center gap-0.5 font-bold", periodSalesDelta === 0 ? "text-[#62708a]" : periodSalesDelta > 0 ? "text-[#16a34a]" : "text-[#ff304f]")}>
                      {periodSalesDelta === 0 ? <Minus size={11} /> : periodSalesDelta > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                      {Math.abs(periodSalesDelta)}%
                    </span>
                    <span className="text-[#7a879b]">vs previous period</span>
                  </span>
                )}
              </div>
            </div>
            <Link href="/reports" className="rounded-[9px] border border-[#bfd3ff] bg-[var(--brand-soft)] px-4 py-2 text-[12px] font-black text-[var(--brand)] shadow-[0_6px_14px_rgba(0,87,255,0.06)] transition-colors hover:bg-[#e2edff]">
              View Report
            </Link>
          </div>
          <div className="mt-3 min-h-0 flex-1 2xl:mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesChartData} margin={{ top: 12, right: 10, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesOverviewFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.30} />
                    <stop offset="46%" stopColor="#2f7dff" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                  </linearGradient>
                  <filter id="salesOverviewGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="var(--brand)" floodOpacity="0.18" />
                  </filter>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="#dbe5f1" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#63718a", fontWeight: 600 }} tickLine={false} axisLine={false} tickMargin={12} />
                <YAxis
                  domain={[0, (dataMax: number) => Math.max(1_000, Math.ceil((dataMax * 1.2) / 1_000) * 1_000)]}
                  tickCount={5}
                  tick={{ fontSize: 11, fill: "#63718a", fontWeight: 600 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  tickFormatter={v => v >= 1000 ? `₹${Math.round(v / 1000)}K` : `₹${v}`}
                />
                <Tooltip
                  cursor={{ stroke: "#9bb7ff", strokeWidth: 1, strokeDasharray: "4 4" }}
                  contentStyle={{ background: "#071735", border: "0", borderRadius: "10px", boxShadow: "0 14px 30px rgba(15,35,80,0.20)", color: "#fff", fontSize: 12, fontWeight: 700 }}
                  labelStyle={{ color: "#dce7ff", fontSize: 11, marginBottom: 4 }}
                  formatter={(v: number) => [fmtRs(v), "Sales"]}
                />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="var(--brand)"
                  strokeWidth={3}
                  fill="url(#salesOverviewFill)"
                  filter="url(#salesOverviewGlow)"
                  dot={{ r: 3.5, fill: "#ffffff", stroke: "var(--brand)", strokeWidth: 2.25 }}
                  activeDot={{ r: 5, fill: "#ffffff", stroke: "var(--brand)", strokeWidth: 2.5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <PaymentModeBreakdown rows={paymentBreakdown} total={periodSales} period={period} onPeriodChange={setPeriod} />
        <LowStockAlerts items={lowStockItems} productsById={productsById} />

      </div>

      {/* ── Recent Bills + Quick Insights ── */}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2 2xl:auto-rows-[clamp(292px,30dvh,380px)] 2xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.72fr)_minmax(320px,0.9fr)]">

        {/* Recent Bills */}
        <section className={cn(DASH_CARD, "flex h-full min-h-[320px] flex-col overflow-hidden lg:col-span-2 2xl:col-span-1 2xl:min-h-0")}>
          <div className="flex min-h-[46px] items-center justify-between gap-3 border-b border-[#e8edf4] px-4 py-3">
            <p className={DASH_TITLE}>Recent Bills</p>
            <Link href="/bills" className="text-[11px] font-bold text-[var(--brand)] hover:underline">View all</Link>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="h-full w-full text-xs">
              <thead>
                <tr className="border-b border-[#e8edf4] bg-[#f7f9fc]">
                  {["Bill No.", "Time", "Customer", "Items", "Amount", "Payment"].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.02em] text-[#66758d]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading || recentBillsQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-2"><div className="h-3 animate-pulse rounded bg-[#edf2f8]" style={{ width: `${50 + j * 10}%` }} /></td>
                      ))}
                    </tr>
                  ))
                ) : recentBills.length === 0 ? (
                  <tr><td colSpan={6} className={cn("px-5 py-8 text-center text-sm", DASH_MUTED)}>No recent bills yet</td></tr>
                ) : (
                  recentBills.slice(0, 5).map(bill => {
                    const href = `/bills/${bill.id ?? ""}`;
                    return (
                      <tr
                        key={bill.id ?? bill.billNo}
                        role="link"
                        tabIndex={0}
                        onClick={() => navigate(href)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(href);
                          }
                        }}
                        className="cursor-pointer border-b border-[#edf2f8] text-[var(--brand-ink)] transition-colors last:border-0 hover:bg-[#f8fbff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 dark:text-card-foreground"
                      >
                        <td className="whitespace-nowrap px-4 py-1.5 font-semibold text-[#152744] dark:text-card-foreground">{compactBillNumber(bill.billNo ?? bill.billNumber)}</td>
                        <td className={cn("whitespace-nowrap px-4 py-1.5 font-medium", DASH_MUTED)}>{bill.createdAt ? format(new Date(bill.createdAt), "hh:mm a") : "—"}</td>
                        <td className="max-w-32 truncate px-4 py-1.5 font-medium">{bill.customerName ?? "Walk-in"}</td>
                        <td className={cn("px-4 py-1.5 font-medium", DASH_MUTED)}>{Array.isArray(bill.items) ? bill.items.length : "—"}</td>
                        <td className="whitespace-nowrap px-4 py-1.5 font-semibold">{fmtRs(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0)}</td>
                        <td className="px-4 py-1.5">
                          <RecentBillPaymentBadge mode={recentBillPaymentMode(bill as unknown as Record<string, unknown>)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="grid min-h-[50px] border-t border-[#e8edf4] bg-[#fbfcfe] text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#eef4ff] text-[var(--brand)]">
                <ReceiptText size={14} />
              </span>
              <div>
                <p className={cn("text-[10px] font-medium", DASH_MUTED)}>Bills today</p>
                <p className="text-[15px] font-extrabold text-[#13223f] dark:text-card-foreground">{dashboard.billCount}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:border-l sm:border-[#e8edf4]">
              <p className={cn("text-[10px] font-medium", DASH_MUTED)}>Sales today</p>
              <p className="text-[15px] font-extrabold text-[#13223f] dark:text-card-foreground">{fmtRs(dashboard.revenue)}</p>
            </div>
          </div>
        </section>

        {/* Right column: Quick Insights + Sync & Health */}
        <div className="contents 2xl:contents">

          {/* Quick Insights */}
          <div className={cn(DASH_CARD, "flex h-full min-h-[320px] flex-col p-4 2xl:min-h-0")}>
            <p className={cn(DASH_TITLE, "mb-3")}>Quick Insights</p>
            <div className="grid min-h-0 flex-1 grid-rows-4 gap-2">
              <InsightRow tone="emerald" icon={<Package size={16} />} label="Sales by Category" value={ownerReport?.topProducts[0]?.name ? "View breakdown" : "No sales yet"} href="/reports" />
              <InsightRow tone="blue" icon={<PackagePlus size={16} />} label="Top Selling Product" value={ownerReport?.topProducts[0]?.name ?? "No product yet"} href="/reports" />
              <InsightRow tone="violet" icon={<CreditCard size={16} />} label="Average Bill Value" value={avgBillValue > 0 ? fmtRs(avgBillValue) : fmtRs(0)} href="/bills" />
              <InsightRow tone="orange" icon={<Users size={16} />} label="Active Customers" value={String(ownerReport?.topCustomers.length ?? 0)} href="/customers" />
            </div>
          </div>

          {/* Sync & Health */}
          <div className={cn(DASH_CARD, "flex h-full min-h-[320px] flex-col overflow-hidden p-4 2xl:min-h-0")}>
            <p className={cn(DASH_TITLE, "mb-2")}>Sync & Health</p>
            <div className="border-b border-[#edf2f8] pb-2.5">
              <div className="flex items-center gap-2 text-[13px] font-bold text-[#11a84b] dark:text-emerald-300">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e7faee]">
                  <CheckCircle2 className="h-3 w-3" />
                </span>
                {syncHealthGood ? "All systems operational" : "Backup needs attention"}
              </div>
              <p className={cn("ml-7 mt-0.5 text-[10px] font-medium", DASH_MUTED)}>
                {isSyncing ? "Sync running now" : syncHealthGood ? "Last synced just now" : "Local data is safe"}
              </p>
            </div>
            <div className="mt-2.5 flex min-h-0 flex-1 flex-col justify-evenly gap-2">
              <HealthRow icon={<Wifi size={13} />} label="Internet Connection" status={isOnline ? "ok" : "warn"} value={isOnline ? "Online" : "Offline"} />
              <HealthRow icon={<RefreshCw size={13} />} label="Data Sync" status={failedCount > 0 ? "error" : pendingCount > 0 ? "warn" : "ok"} value={syncStatusValue} />
              <HealthRow icon={<Cloud size={13} />} label="Backup Status" status={pendingCount > 0 || failedCount > 0 ? "warn" : "ok"} value={isSyncing ? "Syncing" : pendingCount > 0 ? "Queued" : "Secure"} />
              <HealthRow icon={<MonitorSmartphone size={13} />} label="Device Status" status="ok" value="Active" />
            </div>
            <Link href="/sync-status">
              <button type="button" className="mt-3 flex w-full items-center justify-center gap-2 rounded-[9px] bg-[var(--brand)] py-2.5 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(7,95,255,0.18)] transition-colors duration-200 hover:bg-[#0054e8]">
                <RefreshCw size={13} aria-hidden="true" /> Sync Now
              </button>
            </Link>
            <p className={cn("mt-1.5 text-center text-[10px] font-medium", DASH_MUTED)}>
              <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full", syncHealthGood ? "bg-emerald-500" : "bg-amber-500")} /> Auto sync is enabled
            </p>
          </div>

          {/* Demo seed */}
          {!dashboard.hasBusinessData && (
            <button type="button" onClick={onLoadDemo} disabled={seedingDemo}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#cbd8ea] py-3 text-sm font-bold text-[#62708a] transition-colors hover:border-[var(--brand)]/40 hover:text-[var(--brand)]">
              <Sparkles size={15} aria-hidden="true" />
              {seedingDemo ? "Loading demo…" : "Load demo shop data"}
            </button>
          )}
        </div>
      </div>

      <RecentProductsRail products={recentProducts} />

      </div>}
    </>
  );
}

// ─── General layout sub-components ────────────────────────────────────────────

interface MobileGeneralDashboardProps {
  businessType: BusinessType;
  dashboard: DashboardStats;
  ownerReport: LocalReportSnapshot | null;
  salesChartData: Array<{ date: string; sales: number }>;
  recentBills: Bill[];
  recentProducts: Product[];
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  salesDelta: number | null;
  outstandingDelta: number | null;
  profitDelta: number | null;
  expenseDelta: number | null;
  lowStockCount: number;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  periodSales: number;
  periodSalesDelta: number | null;
}

function MobileGeneralDashboard({
  businessType,
  dashboard,
  ownerReport,
  salesChartData,
  recentBills,
  recentProducts,
  isOnline,
  isSyncing,
  pendingCount,
  failedCount,
  salesDelta,
  outstandingDelta,
  profitDelta,
  expenseDelta,
  lowStockCount,
  period,
  onPeriodChange,
  periodSales,
  periodSalesDelta,
}: MobileGeneralDashboardProps) {
  const syncHealthy = failedCount === 0 && pendingCount === 0;
  const topRows = ownerReport?.topProducts.slice(0, 5) ?? [];
  const productsById = new Map(recentProducts.map((product) => [product.id, product]));

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 bg-transparent px-3.5 pb-5 pt-3 lg:hidden">
      <section className="relative overflow-hidden rounded-[24px] bg-[#0b1f46] p-5 text-white shadow-[0_20px_44px_rgba(8,27,66,0.20)]">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[var(--brand)]/35 blur-2xl" aria-hidden="true" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-blue-100/75">Today’s net sales</p>
            <p className="mt-2 font-display text-[34px] font-black leading-none tracking-[-0.04em]">{fmtCompactRs(dashboard.revenue)}</p>
            <div className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-blue-100/75">
              <MobileDelta delta={salesDelta} inverse />
              <span>·</span>
              <span>{dashboard.billCount.toLocaleString("en-IN")} bills</span>
            </div>
          </div>
          <Link href="/sync-status" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 text-[11px] font-extrabold text-white backdrop-blur">
            <span className={cn("h-2 w-2 rounded-full", syncHealthy && isOnline ? "bg-emerald-400" : failedCount > 0 ? "bg-rose-400" : "bg-amber-400")} />
            {isSyncing ? "Syncing" : !isOnline ? "Offline safe" : syncHealthy ? "Synced" : failedCount > 0 ? "Review" : `${pendingCount} pending`}
          </Link>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
          <MobileHeroStat label="Cash" value={dashboard.cashCollected} />
          <MobileHeroStat label="UPI" value={dashboard.upiCollected} />
          <MobileHeroStat label="Bank" value={dashboard.bankCollected} />
        </div>

        <div className="relative mt-4 grid grid-cols-[1.35fr_1fr] gap-2.5">
          <Link href="/billing" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[15px] bg-white px-4 text-[13px] font-black text-[#0b1f46] shadow-[0_10px_24px_rgba(0,0,0,0.12)] active:scale-[0.98]">
            <ShoppingCart size={18} /> New sale
          </Link>
          <Link href="/customers" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[15px] border border-white/15 bg-white/10 px-3 text-[12px] font-black text-white backdrop-blur active:scale-[0.98]">
            <HandCoins size={17} /> Collect due
          </Link>
        </div>
      </section>

      {!dashboard.hasBusinessData && (
        <section className="rounded-[18px] border border-[var(--brand-border)] bg-[linear-gradient(145deg,#f1f6ff,#ffffff)] p-4 shadow-[0_12px_30px_rgba(7,95,255,0.08)]">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--brand)]">Quick start</p>
          <h2 className="mt-1 font-display text-[19px] font-black text-[#071333]">Get ready for your first customer</h2>
          <p className="mt-1 text-[12px] font-medium leading-5 text-[#52627e]">Complete these once, then billing stays fast every day.</p>
          <div className="mt-3 grid gap-2">
            <QuickStartLink href="/products?add=1" step="1" icon={<PackagePlus size={17} />} title="Add your first product" detail="Set price and opening stock" />
            <QuickStartLink href="/billing" step="2" icon={<ShoppingCart size={17} />} title="Create a test bill" detail="Practice checkout without pressure" />
            <QuickStartLink href="/settings/printer" step="3" icon={<Wrench size={17} />} title="Check your receipt" detail="Store name, GST and printer" />
          </div>
        </section>
      )}

      <ShopWorkflowPanel businessType={businessType} compact />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3 px-0.5">
          <div>
            <h2 className="font-display text-[19px] font-black text-[#071333]">Shop health</h2>
            <p className="mt-0.5 text-[11px] font-semibold text-[#718096]">The numbers that need your attention</p>
          </div>
          <Link href="/reports" className="inline-flex min-h-11 items-center gap-1 rounded-[12px] px-3 text-[12px] font-black text-[var(--brand)]">All reports <ChevronRight size={15} /></Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <MobileHealthCard href="/reports" label="Gross profit" value={fmtCompactRs(dashboard.grossProfit)} detail="Estimated today" delta={profitDelta} icon={<TrendingUp size={18} />} tone="green" />
          <MobileHealthCard href="/customers" label="Udhar due" value={fmtCompactRs(dashboard.totalOutstanding)} detail={`${dashboard.outstandingCustomers.length} customers`} delta={outstandingDelta} positiveIsBad icon={<AlertTriangle size={18} />} tone="red" />
          <MobileHealthCard href="/expenses" label="Expenses" value={fmtCompactRs(dashboard.expensesToday)} detail="Recorded today" delta={expenseDelta} positiveIsBad icon={<Wallet size={18} />} tone="amber" />
          <MobileHealthCard href="/inventory" label="Low stock" value={lowStockCount.toLocaleString("en-IN")} detail={lowStockCount > 0 ? "Items to reorder" : "Stock is healthy"} icon={<Package size={18} />} tone={lowStockCount > 0 ? "violet" : "green"} />
        </div>
      </section>

      <section className="rounded-[18px] border border-[#e4ebf4] bg-white p-4 shadow-[0_10px_28px_rgba(26,57,112,0.055)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[20px] font-black text-[#071333]">Sales Trend</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-[#33456b]">Total Sales</span>
              <span className="text-[15px] font-black text-[#071333]">{fmtCompactRs(periodSales)}</span>
              <MobileDelta delta={periodSalesDelta} />
            </div>
          </div>
          <DashboardPeriodSelect value={period} onChange={onPeriodChange} compact />
        </div>
        <div className="mt-2 h-[185px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesChartData} margin={{ top: 10, right: 8, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="mobileSalesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="4 6" stroke="#dbe6f4" />
              <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#64748b", fontWeight: 600 }} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b", fontWeight: 600 }} tickLine={false} axisLine={false} width={38} tickFormatter={(value) => value >= 1000 ? `₹${Math.round(value / 1000)}K` : `₹${value}`} />
              <Tooltip formatter={(value: number) => [fmtCompactRs(value), "Sales"]} />
              <Area type="monotone" dataKey="sales" stroke="var(--brand)" strokeWidth={2.5} fill="url(#mobileSalesFill)" dot={{ r: 3, fill: "white", stroke: "var(--brand)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-[20px] font-black text-[#071333]">Quick Insights</h2>
        <div className="overflow-hidden rounded-[18px] border border-[#e1e9f3] bg-white shadow-[0_10px_28px_rgba(26,57,112,0.055)]">
          <MobileInsight tone="emerald" icon={<TrendingUp size={15} />} title={salesDelta == null ? "No sales yesterday to compare against yet." : `Sales ${salesDelta >= 0 ? "increased" : "decreased"} by ${Math.abs(salesDelta)}% compared with yesterday.`} subtitle="Review the sales trend and payment mix." />
          <MobileInsight tone="orange" icon={<Package size={15} />} title={`${ownerReport?.topProducts[0]?.name ?? "Your top product"} is leading sales.`} subtitle="Keep the best sellers available in stock." />
          <MobileInsight tone="rose" icon={<Users size={15} />} title={`${dashboard.outstandingCustomers.length} customers have outstanding dues.`} subtitle="Follow up to improve cash flow." />
          <Link href="/reports" className="flex min-h-12 items-center justify-center gap-2 border-t border-[#e7edf5] text-[12px] font-black text-[var(--brand)]">View detailed insights <ArrowUpRight size={14} /></Link>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="overflow-hidden rounded-[20px] border border-[#e1e9f3] bg-white shadow-[0_10px_28px_rgba(26,57,112,0.055)]">
          <div className="flex items-center justify-between border-b border-[#edf2f8] px-4 py-3.5">
            <h2 className="text-[14px] font-black text-[var(--brand-ink)]">Top products</h2>
            <Link href="/products" className="inline-flex min-h-10 items-center px-2 text-[11px] font-black text-[var(--brand)]">View all</Link>
          </div>
          <div className="divide-y divide-[#edf2f8] px-3.5">
            {(topRows.length > 0 ? topRows : recentProducts.slice(0, 5).map((product) => ({ productId: product.id, name: product.name, quantitySold: Number(product.stockQuantity ?? 0), revenue: productPrice(product), profitEstimate: 0 }))).map((row) => (
              <Link key={row.productId} href="/products" className="flex min-h-[60px] items-center gap-3 py-2.5">
                <ProductAvatar product={productsById.get(row.productId) ?? ({ id: row.productId, name: row.name } as Product)} compact />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-[var(--brand-ink)]">{row.name}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-[#718096]">{row.quantitySold.toLocaleString("en-IN")} sold</p>
                </div>
                <span className="whitespace-nowrap text-[13px] font-black text-[var(--brand-ink)]">{fmtCompactRs(row.revenue)}</span>
                <ChevronRight size={16} className="text-[#a2adbd]" />
              </Link>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[20px] border border-[#e1e9f3] bg-white shadow-[0_10px_28px_rgba(26,57,112,0.055)]">
          <div className="flex items-center justify-between border-b border-[#edf2f8] px-4 py-3.5">
            <h2 className="text-[14px] font-black text-[var(--brand-ink)]">Recent bills</h2>
            <Link href="/bills" className="inline-flex min-h-10 items-center px-2 text-[11px] font-black text-[var(--brand)]">View all</Link>
          </div>
          <div className="divide-y divide-[#edf2f8] px-3.5">
            {recentBills.slice(0, 5).map((bill) => (
              <Link key={bill.id ?? bill.billNo} href={`/bills/${bill.id ?? ""}`} className="flex min-h-[64px] items-center gap-3 py-2.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-[#eef4ff] text-[var(--brand)]"><ReceiptText size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-black text-[var(--brand-ink)]">Bill #{compactBillNumber(bill.billNo ?? bill.billNumber)}</span>
                    <RecentBillPaymentBadge mode={recentBillPaymentMode(bill as unknown as Record<string, unknown>)} />
                  </div>
                  <span className="mt-1 block truncate text-[11px] font-semibold text-[#718096]">{bill.customerName ?? "Walk-in customer"}</span>
                </div>
                <span className="whitespace-nowrap text-[13px] font-black text-[var(--brand-ink)]">{fmtCompactRs(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0)}</span>
                <ChevronRight size={16} className="text-[#a2adbd]" />
              </Link>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}

function MobileHeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-blue-100/60">{label}</p>
      <p className="mt-1 truncate font-display text-[15px] font-black text-white">{fmtCompactRs(value)}</p>
    </div>
  );
}

function MobileHealthCard({ href, label, value, detail, delta, positiveIsBad = false, icon, tone }: {
  href: string;
  label: string;
  value: string;
  detail: string;
  delta?: number | null;
  positiveIsBad?: boolean;
  icon: ReactNode;
  tone: "green" | "red" | "amber" | "violet";
}) {
  const iconTone = tone === "green" ? "bg-[#e8f9ee] text-[#159447]" : tone === "red" ? "bg-[#ffedf0] text-[#e63c51]" : tone === "amber" ? "bg-[#fff3e1] text-[#d98200]" : "bg-[#f0ebff] text-[#7047eb]";
  const bad = delta != null && (positiveIsBad ? delta > 0 : delta < 0);
  const deltaTone = delta == null ? "text-[#7b8799]" : bad ? "text-[#df3347]" : "text-[#159447]";
  return (
    <Link href={href} className="flex min-h-[142px] min-w-0 flex-col rounded-[19px] border border-[#e1e9f3] bg-white p-3.5 shadow-[0_10px_26px_rgba(26,57,112,0.055)] transition-transform active:scale-[0.98]">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[13px]", iconTone)}>{icon}</span>
        <ChevronRight size={16} className="mt-1 text-[#a2adbd]" />
      </div>
      <p className="mt-3 text-[11px] font-bold text-[#62708a]">{label}</p>
      <p className="mt-1 truncate font-display text-[22px] font-black tracking-tight text-[#071333]">{value}</p>
      <div className="mt-auto flex min-w-0 items-center gap-1 pt-2 text-[10.5px] font-bold">
        {delta != null ? <span className={deltaTone}>{delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${delta}%`}</span> : null}
        <span className="truncate text-[#7b8799]">{delta != null ? "· " : ""}{detail}</span>
      </div>
    </Link>
  );
}

function MobileDelta({ delta, inverse = false }: { delta: number | null; inverse?: boolean }) {
  const color = inverse
    ? delta == null || delta === 0 ? "text-blue-100/70" : delta > 0 ? "text-emerald-300" : "text-rose-300"
    : delta == null ? "text-[#94a3b8]" : delta === 0 ? "text-[#718096]" : delta > 0 ? "text-[#16a34a]" : "text-[#ef3340]";
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-semibold">
      <span className={cn("inline-flex items-center gap-0.5 font-bold", color)}>{delta == null ? <span>—</span> : <>{delta === 0 ? <Minus size={9} /> : delta > 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}{Math.abs(delta)}%</>}</span>
      <span className={inverse ? "text-blue-100/70" : "text-[#7b8799]"}>vs yesterday</span>
    </span>
  );
}

function MobileInsight({ tone, icon, title, subtitle }: { tone: "emerald" | "orange" | "rose"; icon: ReactNode; title: string; subtitle: string }) {
  const toneClass = tone === "emerald" ? "bg-[#e8f9ee] text-[#159447]" : tone === "orange" ? "bg-[#fff3e1] text-[#e98400]" : "bg-[#ffecef] text-[#ef3340]";
  return (
    <div className="flex min-h-[68px] gap-3 border-b border-[#edf2f8] px-3.5 py-3">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[13px]", toneClass)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[12px] font-black leading-snug text-[#253854]">{title}</p>
        <p className="mt-1 text-[11px] font-medium leading-snug text-[#718096]">{subtitle}</p>
      </div>
    </div>
  );
}

function mobileSparkline(previous: number, current: number): Array<{ value: number }> {
  const start = previous > 0 ? previous : current > 0 ? current * 0.72 : 1;
  const end = current > 0 ? current : start;
  const spread = Math.max(start, end) * 0.08;
  return [start, start + spread, start - spread * 0.35, start + spread * 1.35, start + spread * 0.2, end + spread * 0.55, end].map((value) => ({ value: Math.max(0, value) }));
}

function fmtCompactRs(n: number | undefined | null): string {
  return `₹${money(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function DashboardPeriodSelect({ value, onChange, compact = false }: { value: DashboardPeriod; onChange: (period: DashboardPeriod) => void; compact?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 items-center justify-between gap-2 rounded-[7px] border border-[#d5deeb] bg-white font-bold text-[#314766] transition-colors hover:border-[#bdcbe0] hover:bg-[#fbfcfe] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
            compact ? "h-7 min-w-[88px] px-2 text-[9px]" : "h-8 min-w-[104px] px-2.5 text-[10px]",
          )}
        >
          {DASHBOARD_PERIOD_LABELS[value]}
          <ChevronDown size={compact ? 10 : 11} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={5} className="w-36 rounded-[8px] border-[#dfe7f2] p-1.5">
        {(Object.keys(DASHBOARD_PERIOD_LABELS) as DashboardPeriod[]).map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => onChange(period)}
            className={cn("w-full rounded-[6px] px-2.5 py-2 text-left text-[11px] font-semibold text-[#405273] hover:bg-[#f2f6fc]", value === period && "bg-[var(--brand-soft)] text-[var(--brand)]")}
          >
            {DASHBOARD_PERIOD_LABELS[period]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function KpiCard({ label, value, delta, deltaLabel, deltaPositiveIsBad, icon, iconBg, color, spark, loading, footer, onClick }: {
  label: string; value: string; delta?: number | null; deltaLabel?: string; deltaPositiveIsBad?: boolean;
  icon: ReactNode; iconBg: string; color?: string; spark?: Array<{ value: number }>; loading?: boolean; footer?: ReactNode; onClick?: () => void;
}) {
  const isPositive = (delta ?? 0) > 0;
  const isNegative = (delta ?? 0) < 0;
  const isBad = deltaPositiveIsBad ? isPositive : isNegative;
  const DeltaIcon = delta === null || delta === undefined || delta === 0 ? Minus : isPositive ? ArrowUpRight : ArrowDownRight;
  const gradientId = `dashboard-kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        DASH_CARD,
        "flex h-full min-h-[154px] min-w-0 flex-col overflow-hidden p-4 2xl:min-h-[166px] 2xl:p-5",
        onClick && ["cursor-pointer", DASH_CARD_INTERACTIVE],
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] 2xl:h-10 2xl:w-10", iconBg)}>{icon}</div>
      </div>
      <div className="mt-2.5 min-h-0 2xl:mt-3">
        <p className={cn("line-clamp-2 text-[12px] font-medium leading-tight 2xl:text-[13px]", DASH_MUTED)}>{label}</p>
        {loading ? (
          <div className="mt-2 h-7 w-3/4 animate-pulse rounded bg-[#edf2f8]" />
        ) : (
          <p className="mt-1.5 break-words font-sans text-[20px] font-bold leading-none text-[var(--brand-ink)] dark:text-card-foreground 2xl:mt-2 2xl:text-[22px]">{value}</p>
        )}
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-medium 2xl:mt-3 2xl:text-[11px]">
          {delta === null || delta === undefined ? (
            <span className="font-bold text-[#94a3b8]">—</span>
          ) : (
            <span className={cn("inline-flex items-center gap-0.5 font-bold", delta === 0 ? "text-[#62708a]" : isBad ? "text-[#ff304f]" : "text-[#16a34a]")}>
              <DeltaIcon size={11} aria-hidden="true" />
              {Math.abs(delta)}%
            </span>
          )}
          <span className="min-w-0 truncate text-[#7a879b]">{deltaLabel}</span>
        </div>
        {footer && <div className="mt-2 leading-none">{footer}</div>}
      </div>
      {spark && color ? (
        <div className="mt-auto h-8 w-full shrink-0 pt-2 2xl:h-9">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 1, left: 1, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="72%" stopColor={color} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

function ShopWorkflowPanel({ businessType, compact = false }: { businessType: BusinessType; compact?: boolean }) {
  const workflow = getShopWorkflow(businessType);
  const tones = ["primary", "amber", "teal", "violet"] as const;
  return (
    <section className={cn("overflow-hidden rounded-[18px] border border-[#dfe8f5] bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_64%)] shadow-[0_10px_28px_rgba(26,57,112,0.055)]", !compact && "mb-6")} data-testid="shop-workflow-panel">
      <div className="flex flex-col gap-3 border-b border-[#e8eef6] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[var(--brand)]">Tools for your shop type</p>
          <h2 className="mt-1 font-display text-[18px] font-black text-[var(--brand-ink)]">{workflow.title}</h2>
          <p className="mt-1 max-w-3xl text-[11.5px] font-semibold leading-5 text-[#65748f]">{workflow.subtitle}</p>
        </div>
        <Link href="/settings/store-profile" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 self-start rounded-[10px] border border-[var(--brand-border)] bg-white px-3 text-[11px] font-black text-[var(--brand)] hover:bg-[var(--brand-softer)]">
          Change shop type <ChevronRight size={14} />
        </Link>
      </div>
      <div className="grid gap-2.5 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-4">
        {workflow.actions.map((action, index) => (
          <Link key={`${action.href}-${action.label}`} href={action.href} className="group flex min-h-[86px] items-center gap-3 rounded-[14px] border border-[#e4ebf4] bg-white p-3.5 shadow-[0_5px_14px_rgba(26,57,112,0.04)] transition hover:-translate-y-0.5 hover:border-[var(--brand-border)] hover:shadow-[0_10px_22px_rgba(26,57,112,0.08)]">
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[11px]", ACTION_ICON_BG[tones[index]])}>{ACTION_ICON[action.icon]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-black text-[#13274d]">{action.label}</span>
              <span className="mt-1 block text-[10.5px] font-semibold leading-4 text-[#718096]">{action.detail}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-[#9ca9bb] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function QuickStartLink({ href, step, icon, title, detail }: { href: string; step: string; icon: ReactNode; title: string; detail: string }) {
  return (
    <Link href={href} className="group flex min-h-[64px] items-center gap-3 rounded-[14px] border border-[#dbe6f5] bg-white p-3 text-left shadow-[0_8px_20px_rgba(15,35,80,0.04)] transition-all hover:-translate-y-0.5 hover:border-[#9fc0ff] hover:shadow-[0_12px_28px_rgba(7,95,255,0.10)]">
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-[var(--brand-soft)] text-[var(--brand)]">
        {icon}
        <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--brand)] text-[9px] font-black text-white ring-2 ring-white">{step}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-black text-[var(--brand-ink)] group-hover:text-[var(--brand)]">{title}</span>
        <span className="mt-0.5 block text-[10px] font-semibold text-[#718096]">{detail}</span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-[#9aa8bc] group-hover:text-[var(--brand)]" />
    </Link>
  );
}

function PaymentModeBreakdown({ rows, total, period, onPeriodChange }: { rows: PaymentSlice[]; total: number; period: DashboardPeriod; onPeriodChange: (period: DashboardPeriod) => void }) {
  const realTotal = rows.reduce((sum, row) => sum + row.value, 0);
  const displayTotal = total > 0 ? total : realTotal;
  const chartRows = rows.length > 0 ? rows : [{ label: "No sales", value: 1, color: "#e5e7eb", dot: "bg-muted" }];
  const chartAnimationKey = chartRows.map((row) => `${row.label}:${row.value}`).join("|");

  return (
    <section className={cn(DASH_CARD, "flex h-full min-h-[320px] flex-col overflow-hidden p-4 2xl:min-h-0 2xl:p-5")}>
      <div className="flex min-h-7 min-w-0 items-center justify-between gap-2">
        <p className={cn(DASH_TITLE, "min-w-0 truncate")}>Payment Mode Breakdown</p>
        <DashboardPeriodSelect value={period} onChange={onPeriodChange} compact />
      </div>
      <div className="relative mt-2 min-h-[150px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              key={chartAnimationKey}
              data={chartRows}
              dataKey="value"
              nameKey="label"
              innerRadius={50}
              outerRadius={76}
              paddingAngle={3}
              stroke="hsl(var(--card))"
              strokeWidth={3}
              isAnimationActive
              animationBegin={80}
              animationDuration={850}
              animationEasing="ease-out"
            >
              {chartRows.map((entry) => (
                <Cell key={entry.label} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-sans text-[17px] font-extrabold leading-none text-[var(--brand-ink)] dark:text-card-foreground">{fmtRs(displayTotal)}</p>
            <p className={cn("mt-1 text-[11px] font-semibold", DASH_MUTED)}>Total Sales</p>
          </div>
        </div>
      </div>
      <div className="mt-1 min-h-0 space-y-1.5 overflow-y-auto pr-1">
        {(rows.length > 0 ? rows : chartRows).map((row) => {
          const pct = realTotal > 0 ? Math.round((row.value / realTotal) * 1000) / 10 : 0;
          return (
            <div key={row.label} className="flex min-w-0 items-center justify-between gap-3 text-xs">
              <span className={cn("flex min-w-0 items-center gap-2 font-semibold", DASH_MUTED)}>
                <span className={cn("h-2 w-2 rounded-full", row.dot)} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap font-black text-[var(--brand-ink)] dark:text-card-foreground">{fmtRs(row.value)} {realTotal > 0 ? `(${pct}%)` : ""}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LowStockAlerts({ items, productsById }: { items: LocalReportSnapshot["lowStock"]; productsById: Record<string, Product> }) {
  return (
    <section className={cn(DASH_CARD, "flex h-full min-h-[320px] flex-col overflow-hidden p-4 2xl:min-h-0 2xl:p-5")}>
      <div className="flex items-center justify-between gap-3">
        <p className={DASH_TITLE}>Low Stock Alerts</p>
        <Link href="/inventory" className="text-[12px] font-black text-[var(--brand)] hover:underline">View all</Link>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 2xl:justify-evenly">
        {items.length === 0 ? (
          <div className={cn("rounded-[10px] border border-dashed border-[#dce7f5] px-3 py-8 text-center text-sm font-semibold", DASH_MUTED)}>
            All stock healthy
          </div>
        ) : (
          items.slice(0, 5).map((item, i) => {
            const threshold = item.threshold || 5;
            const isCritical = item.stock <= Math.max(1, Math.round(threshold * 0.4));
            const product = productsById[item.productId];
            return (
              <Link key={item.productId ?? i} href="/inventory">
                <div className="flex min-h-[48px] items-center gap-3 rounded-[10px] px-2 py-1 transition-colors hover:bg-[#f8fbff]">
                  <ProductAvatar product={product ?? { id: item.productId, name: item.name } as Product} compact />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black leading-tight text-[var(--brand-ink)] dark:text-card-foreground">{item.name}</p>
                    <p className={cn("text-xs font-semibold", DASH_MUTED)}>Stock: {item.stock} {item.unit ?? "pcs"}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-[7px] px-2 py-1 text-[11px] font-black", isCritical ? "bg-[#fff0f2] text-[#ff304f]" : "bg-[#fff4e6] text-[#ff8a00]")}>
                    {isCritical ? "Critical" : "Low"}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

function InsightRow({ icon, label, value, href, tone }: {
  icon: ReactNode;
  label: string;
  value: string;
  href?: string;
  tone: "emerald" | "blue" | "violet" | "orange";
}) {
  const toneClass = {
    emerald: "border-[#c8f1d5] bg-[#e7faee] text-[#11a84b] shadow-[0_6px_16px_rgba(17,168,75,0.14)]",
    blue: "border-[var(--brand-border)] bg-[#eaf2ff] text-[var(--brand)] shadow-[0_6px_16px_rgba(7,95,255,0.14)]",
    violet: "border-[#ddd3ff] bg-[#f0ebff] text-[#7047eb] shadow-[0_6px_16px_rgba(112,71,235,0.14)]",
    orange: "border-[#ffdca8] bg-[#fff2df] text-[#ff8500] shadow-[0_6px_16px_rgba(255,133,0,0.14)]",
  }[tone];
  const content = (
    <div className="flex h-full min-h-[57px] items-center justify-between gap-3 border-b border-[#edf2f8] px-1 py-2 transition-colors hover:bg-[#f8fbff]">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border", toneClass)}>{icon}</span>
        <span className="min-w-0">
          <span className={cn("block truncate text-[11px] font-semibold", DASH_MUTED)}>{label}</span>
          <span className="block truncate text-[12px] font-black text-[var(--brand-ink)] dark:text-card-foreground">{value}</span>
        </span>
      </div>
      {href ? <ChevronRight size={14} className="shrink-0 text-[#5f6f88]" aria-hidden="true" /> : null}
    </div>
  );
  return href ? <Link href={href} className="block last:[&>div]:border-b-0">{content}</Link> : content;
}

function HealthRow({ icon, label, status, value }: {
  icon: ReactNode;
  label: string;
  status: "ok" | "warn" | "error";
  value: string;
}) {
  const color = status === "ok" ? "text-emerald-600" : status === "warn" ? "text-amber-600" : "text-red-600";
  const Icon = status === "ok" ? CheckCircle2 : status === "warn" ? RefreshCw : XCircle;
  return (
    <div className="flex min-h-[23px] items-center justify-between gap-3 text-[11px]">
      <span className={cn("flex items-center gap-2 font-medium", DASH_MUTED)}>
        <span className={cn("grid h-5 w-5 place-items-center rounded-[6px] bg-[#f4f7fb]", color)}>{icon}</span>
        {label}
      </span>
      <span className={cn("flex items-center gap-1 font-medium", color)}>
        <Icon size={10} aria-hidden="true" /> {value}
      </span>
    </div>
  );
}

function RecentProductsRail({ products }: { products: Product[] }) {
  return (
    <section className={cn(DASH_CARD, "overflow-hidden")}>
      <div className="flex items-center justify-between gap-3 border-b border-[#edf2f8] px-5 py-3">
        <p className={DASH_TITLE}>Recently Added Products</p>
        <Link href="/products" className="text-[12px] font-black text-[var(--brand)] hover:underline">View all</Link>
      </div>
      {products.length === 0 ? (
        <div className={cn("m-4 rounded-[10px] border border-dashed border-[#dce7f5] px-4 py-7 text-center text-sm font-semibold", DASH_MUTED)}>
          Products will appear here after you add stock.
        </div>
      ) : (
        <div className="flex min-h-[78px] items-stretch overflow-x-auto px-2 2xl:min-h-[88px]">
          {products.slice(0, 8).map((product) => (
            <Link key={product.id} href={`/products?highlight=${encodeURIComponent(product.id)}`} className="group min-w-[190px] flex-1 border-r border-[#edf2f8] last:border-r-0">
              <div className="flex h-full items-center gap-3 px-4 py-3 transition-colors group-hover:bg-[#f8fbff]">
                <ProductAvatar product={product} compact />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-black text-[var(--brand-ink)]">{product.name}</p>
                  <p className={cn("mt-0.5 text-[11px] font-semibold", DASH_MUTED)}>{productUnitLabel(product)}</p>
                  <p className="mt-1 text-[12px] font-black text-[var(--brand-ink)]">{fmtRs(productPrice(product))}</p>
                </div>
              </div>
            </Link>
          ))}
          <Link href="/products" className="grid min-w-[72px] place-items-center px-3">
            <div className="grid h-10 w-10 place-items-center rounded-full border border-[#cfdaea] bg-white text-[#5f6f88] shadow-[0_7px_18px_rgba(26,57,112,0.10)] transition-all hover:border-[var(--brand)]/40 hover:text-[var(--brand)] hover:shadow-[0_9px_22px_rgba(7,95,255,0.16)]">
              <ChevronRight size={18} />
            </div>
          </Link>
        </div>
      )}
    </section>
  );
}

function ProductAvatar({ product, compact = false }: { product: Product; compact?: boolean }) {
  const size = compact ? "h-10 w-10" : "h-14 w-14";
  const radius = compact ? "rounded-[9px]" : "rounded-[10px]";
  if (product.imageUrl) {
    return (
      <div className={cn(size, radius, "shrink-0 overflow-hidden border border-[#e6ecf4] bg-white shadow-[0_6px_14px_rgba(15,35,80,0.04)]")}>
        <img src={product.imageUrl} alt="" className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={cn(size, radius, "grid shrink-0 place-items-center bg-[var(--brand-soft)] text-sm font-black text-[var(--brand)] shadow-[0_6px_14px_rgba(0,87,255,0.08)]")}>
      {product.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function productPrice(product: Product): number {
  return money(product.sellingPrice ?? product.defaultPricePerRateUnit ?? product.retailPrice ?? 0);
}

function productUnitLabel(product: Product): string {
  const unit = productDisplayUnit(product);
  // stockBaseQty is in base units (g/ml); convert to the display unit. Falling back to the raw
  // base value (the old behaviour) showed e.g. 20000 litre instead of 20 litre.
  const stock = product.stockBaseQty != null
    ? fromBaseQty(product.stockBaseQty, unit)
    : Number(product.stockQuantity ?? 0);
  // Negative stock is real and worth seeing: the counter lets a sale through when
  // a stock-in has not been recorded yet, and the deficit is what tells the owner
  // to reconcile. Hiding it left the tile showing a bare unit ("kg") with no number.
  if (Number.isFinite(stock)) return `${stock.toLocaleString("en-IN")} ${unit}`;
  return unit;
}

function fmtRs(n: number | undefined | null) {
  const value = Number(n ?? 0);
  const safe = Number.isFinite(value) ? value : 0;
  return `₹${safe.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── RESTAURANT layout ────────────────────────────────────────────────────────

function RestaurantLayout({ businessType, btDef, dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations, seedingDemo, userName, onLoadDemo, openDrilldown, drilldownKeyHandler }: LayoutProps) {
  const { t } = useAppLanguage();
  const dbCfg = btDef.dashboard;
  const avgOrder = dashboard.billCount > 0 ? Math.round(dashboard.revenue / dashboard.billCount) : 0;
  const topDishes = ownerReport?.topProducts ?? [];
  const attentionCount = [lowStockCount > 0, hasUnsyncedOperations].filter(Boolean).length;

  return (
    <PageShell>
      <PageHeader
        title={`${btDef.emoji} ${dbCfg.heroTitle}`}
        description={`${format(new Date(), "EEEE, d MMMM yyyy")} — ${userName}`}
        eyebrow={(
          <div className="flex flex-wrap items-center gap-2">
            <SyncBadge status="local" label={`Local-first numbers (${dashboard.source})`} />
          </div>
        )}
      />

      {/* Restaurant hero — full-width, order-count centred */}
      <section className="premium-hero mb-6 overflow-hidden">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary ring-1 ring-primary/20">● Kitchen active</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
              {dashboard.billCount} orders today
            </span>
            {avgOrder > 0 && (
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900">
                Avg order {fmt(avgOrder)}
              </span>
            )}
            {attentionCount > 0 && (
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 ring-1 ring-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900">
                {attentionCount} alert{attentionCount > 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Revenue today</p>
              <p className="mt-1 font-display text-5xl font-black tracking-tight text-foreground sm:text-6xl">
                {fmt(dashboard.revenue)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{dbCfg.heroSubtitle}</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-muted/60 px-3 py-1.5 font-medium text-muted-foreground ring-1 ring-black/[0.06]">
                  Drawer {fmt(cashInDrawer)}
                </span>
                {!dashboard.hasBusinessData && (
                  <button type="button" onClick={onLoadDemo} disabled={seedingDemo} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                    <Sparkles size={13} aria-hidden="true" /> {seedingDemo ? "Loading..." : "Load demo"}
                  </button>
                )}
              </div>
            </div>

            {/* Quick actions — horizontal in restaurant */}
            <div className="flex flex-row flex-wrap gap-2.5 lg:flex-col lg:justify-end">
              {dbCfg.quickActions.map((action) => (
                <Link key={action.href + action.label} href={action.href}>
                  <div className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 lg:min-w-[152px]">
                    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ACTION_ICON_BG[action.color]}`}>{ACTION_ICON[action.icon]}</div>
                    <span className="text-sm font-bold">{action.label}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <ShopWorkflowPanel businessType={businessType} />

      <StatsGrid className="mb-6">
        <StatCard label={dbCfg.kpi.revenue} value={fmt(dashboard.revenue)} description={`${dashboard.billCount} orders`} icon={<ChefHat size={20} aria-hidden="true" />} loading={isLoading} tone="green" data-testid="metric-revenue" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("revenue")} onKeyDown={drilldownKeyHandler("revenue")} />
        <StatCard label="Orders Today" value={String(dashboard.billCount)} description={avgOrder > 0 ? `Avg ${fmt(avgOrder)} per order` : "No orders yet"} icon={<ReceiptText size={20} aria-hidden="true" />} loading={isLoading} tone="blue" />
        <StatCard label={dbCfg.kpi.profit} value={fmt(dashboard.grossProfit)} description={`${Math.round(dashboard.grossMarginPct)}% margin`} icon={<TrendingUp size={20} aria-hidden="true" />} loading={isLoading} tone="amber" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("profit")} onKeyDown={drilldownKeyHandler("profit")} />
        <StatCard label={dbCfg.kpi.cash} value={fmt(dashboard.cashCollected)} description={`Drawer ${fmt(cashInDrawer)}`} icon={<Wallet size={20} aria-hidden="true" />} loading={isLoading} tone="violet" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("collection")} onKeyDown={drilldownKeyHandler("collection")} />
      </StatsGrid>

      <AttentionStrip supplierDue={dashboard.supplierDue} purchaseDue={dashboard.purchaseDue} lowStockCount={lowStockCount} pendingSyncCount={pendingSyncCount} hasUnsyncedOperations={hasUnsyncedOperations} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTableCard title="Cash & UPI Collection" description="Today's payment breakdown by mode." loading={isLoading} actions={(
          <button type="button" onClick={() => openDrilldown("collection")} className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">Breakdown</button>
        )}>
          <div className="space-y-2">
            <CollectionRow label="Cash collected" value={fmt(dashboard.cashCollected)} icon={<Wallet size={16} aria-hidden="true" />} />
            <CollectionRow label="UPI collected" value={fmt(dashboard.upiCollected)} icon={<Smartphone size={16} aria-hidden="true" />} />
            {dashboard.credit > 0 && (
              <CollectionRow label="Pending tabs (credit)" value={fmt(dashboard.credit)} icon={<CreditCard size={16} aria-hidden="true" />} muted />
            )}
            <div className="mt-3 rounded-lg bg-primary/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-muted-foreground">Expected cash in drawer</span>
                <span className="text-lg font-black text-foreground">{fmt(cashInDrawer)}</span>
              </div>
            </div>
          </div>
        </DataTableCard>

        <DataTableCard
          title="Top Menu Items"
          description="Best-selling dishes by quantity this week."
          loading={isLoading}
          empty={topDishes.length === 0}
          emptyState={<EmptyState title="No sales data yet" description="Top dishes will appear once orders are saved." icon={<ChefHat size={24} className="text-muted-foreground" />} />}
          actions={<Link href="/reports"><span className="cursor-pointer text-sm text-primary hover:underline">{t("dashboard.viewAll")}</span></Link>}
        >
          <div className="space-y-2">
            {topDishes.slice(0, 6).map((dish, i) => (
              <div key={dish.productId ?? i} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-black text-primary">{i + 1}</span>
                  <p className="truncate text-sm font-medium">{dish.name}</p>
                </div>
                <span className="shrink-0 text-xs font-bold text-muted-foreground">{dish.quantitySold} sold</span>
              </div>
            ))}
          </div>
        </DataTableCard>
      </div>
    </PageShell>
  );
}

// ─── TECHNICAL layout (auto_parts) ───────────────────────────────────────────

function TechnicalLayout({ businessType, btDef, dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations, seedingDemo, userName, onLoadDemo, openDrilldown, drilldownKeyHandler }: LayoutProps) {
  const { t } = useAppLanguage();
  const dbCfg = btDef.dashboard;
  const lowStockItems = ownerReport?.lowStock ?? [];

  return (
    <PageShell>
      <PageHeader
        title={`${btDef.emoji} ${dbCfg.heroTitle}`}
        description={`${format(new Date(), "EEEE, d MMMM yyyy")} — ${userName}`}
        eyebrow={(
          <div className="flex flex-wrap items-center gap-2">
            <SyncBadge status="local" label={`Local-first numbers (${dashboard.source})`} />
          </div>
        )}
      />

      {/* Technical hero — supplier dues prominent left, quick actions right */}
      <section className="premium-hero mb-6">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary ring-1 ring-primary/20">● Counter live</span>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900">
                {dashboard.billCount} bills today
              </span>
              {lowStockCount > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                  {lowStockCount} parts low stock
                </span>
              )}
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Sales today</p>
                <p className="mt-1 font-display text-4xl font-black tracking-tight text-foreground">{fmt(dashboard.revenue)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{Math.round(dashboard.grossMarginPct)}% gross margin</p>
              </div>
              <div className={`rounded-xl p-4 ring-1 ${dashboard.supplierDue > 0 ? "bg-rose-50 ring-rose-200/60 dark:bg-rose-950/30 dark:ring-rose-900" : "bg-muted/40 ring-black/[0.06]"}`}>
                <p className={`text-xs font-bold uppercase tracking-widest ${dashboard.supplierDue > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>Supplier balance due</p>
                <p className={`mt-1 font-display text-3xl font-black ${dashboard.supplierDue > 0 ? "text-rose-700 dark:text-rose-300" : "text-foreground"}`}>
                  {dashboard.supplierDue > 0 ? fmt(dashboard.supplierDue) : "Clear"}
                </p>
                {dashboard.purchaseDue > 0 && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">Today due: {fmt(dashboard.purchaseDue)}</p>
                )}
                {dashboard.supplierDue === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">No outstanding to suppliers</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="rounded-full bg-muted/60 px-3 py-1.5 font-medium text-muted-foreground ring-1 ring-black/[0.06]">Drawer {fmt(cashInDrawer)}</span>
              {!dashboard.hasBusinessData && (
                <button type="button" onClick={onLoadDemo} disabled={seedingDemo} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                  <Sparkles size={13} aria-hidden="true" /> {seedingDemo ? "Loading..." : "Load demo"}
                </button>
              )}
            </div>
          </div>
          <div className="border-t bg-background/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
            <p className="app-muted-label">Quick actions</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5">
              {dbCfg.quickActions.map((action) => (
                <Link key={action.href + action.label} href={action.href}>
                  <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
                    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ACTION_ICON_BG[action.color]}`}>{ACTION_ICON[action.icon]}</div>
                    <span className="text-sm font-bold">{action.label}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <ShopWorkflowPanel businessType={businessType} />

      <StatsGrid className="mb-6">
        <StatCard label={dbCfg.kpi.revenue} value={fmt(dashboard.revenue)} description={`${dashboard.billCount} bills · tap for details`} icon={<Wrench size={20} aria-hidden="true" />} loading={isLoading} tone="green" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("revenue")} onKeyDown={drilldownKeyHandler("revenue")} />
        <StatCard label="Supplier Dues" value={dashboard.supplierDue > 0 ? fmt(dashboard.supplierDue) : "Clear"} description={dashboard.purchaseDue > 0 ? `Today due ${fmt(dashboard.purchaseDue)}` : "No urgent due"} icon={<Truck size={20} aria-hidden="true" />} loading={isLoading} tone={dashboard.supplierDue > 0 ? "red" : "green"} />
        <Link href="/customers?filter=udhar">
          <StatCard label={dbCfg.kpi.credit} value={fmt(dashboard.totalOutstanding)} description={`${dashboard.outstandingCustomers.length} party accounts`} icon={<AlertTriangle size={20} aria-hidden="true" />} loading={isLoading} tone="amber" className="h-full cursor-pointer" />
        </Link>
        <StatCard label={dbCfg.kpi.cash} value={fmt(dashboard.cashCollected)} description={`Drawer ${fmt(cashInDrawer)}`} icon={<Wallet size={20} aria-hidden="true" />} loading={isLoading} tone="violet" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("collection")} onKeyDown={drilldownKeyHandler("collection")} />
      </StatsGrid>

      <AttentionStrip supplierDue={dashboard.supplierDue} purchaseDue={dashboard.purchaseDue} lowStockCount={lowStockCount} pendingSyncCount={pendingSyncCount} hasUnsyncedOperations={hasUnsyncedOperations} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTableCard title="Party Credit (Khata)" description="Customers with outstanding balance." loading={isLoading} empty={dashboard.outstandingCustomers.length === 0} emptyState={<EmptyState title="No outstanding khata" description="All customer accounts are clear." />} actions={<Link href="/customers?filter=udhar"><span className="cursor-pointer text-sm text-primary hover:underline">{t("dashboard.viewAll")}</span></Link>}>
          <div className="space-y-2">
            {dashboard.outstandingCustomers.slice(0, 5).map((c) => (
              <div key={c.customerId} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.customerName}</p>
                  {c.mobile ? <p className="truncate text-xs text-muted-foreground">{c.mobile}</p> : null}
                </div>
                <MoneyBadge amount={c.outstanding} tone="danger" compact />
              </div>
            ))}
          </div>
        </DataTableCard>

        <DataTableCard title="Low Stock Parts" description="Parts below minimum stock — order soon." loading={isLoading} empty={lowStockItems.length === 0} emptyState={<EmptyState title="Parts stock healthy" description="No parts are below minimum stock level." icon={<Package size={24} className="text-muted-foreground" />} />} actions={<Link href="/inventory"><span className="cursor-pointer text-sm text-primary hover:underline">Godown view</span></Link>}>
          <div className="space-y-2">
            {lowStockItems.slice(0, 6).map((item, i) => (
              <div key={item.productId ?? i} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  {item.category ? <p className="text-xs text-muted-foreground capitalize">{String(item.category).replace(/_/g, " ")}</p> : null}
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-amber-600 dark:text-amber-400">
                    {item.stock} {item.unit ?? "pc"} left
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DataTableCard>
      </div>
    </PageShell>
  );
}

// ─── MEDICAL layout (pharmacy) ────────────────────────────────────────────────

function MedicalLayout({ businessType, btDef, dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations, seedingDemo, userName, onLoadDemo, openDrilldown, drilldownKeyHandler }: LayoutProps) {
  const { t } = useAppLanguage();
  const dbCfg = btDef.dashboard;
  const lowStockItems = ownerReport?.lowStock ?? [];

  return (
    <PageShell>
      {/* Low stock alert strip — pharmacy-critical */}
      {lowStockCount > 0 && (
        <Link href="/inventory">
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm dark:border-rose-900 dark:bg-rose-950/40">
            <Pill size={18} className="shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <p className="font-semibold text-rose-800 dark:text-rose-200">
              {lowStockCount} medicine{lowStockCount > 1 ? "s" : ""} below minimum stock — reorder required
            </p>
            <span className="ml-auto shrink-0 text-xs font-bold text-rose-600 hover:underline dark:text-rose-400">View stock →</span>
          </div>
        </Link>
      )}

      <PageHeader
        title={`${btDef.emoji} ${dbCfg.heroTitle}`}
        description={`${format(new Date(), "EEEE, d MMMM yyyy")} — ${userName}`}
        eyebrow={(
          <div className="flex flex-wrap items-center gap-2">
            <SyncBadge status="local" label={`Local-first numbers (${dashboard.source})`} />
          </div>
        )}
      />

      {/* Medical hero */}
      <section className="premium-hero mb-6">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary ring-1 ring-primary/20">● Dispensing active</span>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900">
                {dashboard.billCount} counters today
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${lowStockCount > 0 ? "bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900" : "bg-teal-50 text-teal-700 ring-teal-200/60 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900"}`}>
                {lowStockCount > 0 ? `${lowStockCount} low stock` : "Stock healthy"}
              </span>
            </div>
            <h2 className="mt-5 max-w-2xl font-display text-3xl font-black tracking-tight text-foreground sm:text-4xl">{dbCfg.heroTitle}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Safe dispensing begins with accurate stock. Review low stock before close of day.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="rounded-full bg-muted/60 px-3 py-1.5 font-medium text-muted-foreground ring-1 ring-black/[0.06]">Drawer {fmt(cashInDrawer)}</span>
              {!dashboard.hasBusinessData && (
                <button type="button" onClick={onLoadDemo} disabled={seedingDemo} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                  <Sparkles size={13} aria-hidden="true" /> {seedingDemo ? "Loading..." : "Load demo"}
                </button>
              )}
            </div>
          </div>
          <div className="border-t bg-background/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
            <p className="app-muted-label">Quick actions</p>
            <div className="mt-3 grid grid-cols-1 gap-2.5">
              {dbCfg.quickActions.map((action) => (
                <Link key={action.href + action.label} href={action.href}>
                  <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
                    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ACTION_ICON_BG[action.color]}`}>{ACTION_ICON[action.icon]}</div>
                    <span className="text-sm font-bold">{action.label}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <ShopWorkflowPanel businessType={businessType} />

      <StatsGrid className="mb-6">
        <StatCard label={dbCfg.kpi.revenue} value={fmt(dashboard.revenue)} description={`${dashboard.billCount} dispensing counters`} icon={<ClipboardList size={20} aria-hidden="true" />} loading={isLoading} tone="green" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("revenue")} onKeyDown={drilldownKeyHandler("revenue")} />
        <StatCard label="Low Stock" value={lowStockCount > 0 ? `${lowStockCount} items` : "Healthy"} description={lowStockCount > 0 ? "Reorder required" : "All medicines stocked"} icon={<Pill size={20} aria-hidden="true" />} loading={isLoading} tone={lowStockCount > 0 ? "red" : "green"} />
        <Link href="/customers?filter=udhar">
          <StatCard label={dbCfg.kpi.credit} value={fmt(dashboard.totalOutstanding)} description={`${dashboard.outstandingCustomers.length} patient accounts`} icon={<AlertTriangle size={20} aria-hidden="true" />} loading={isLoading} tone="amber" className="h-full cursor-pointer" />
        </Link>
        <StatCard label={dbCfg.kpi.cash} value={fmt(dashboard.cashCollected)} description={`Drawer ${fmt(cashInDrawer)}`} icon={<Wallet size={20} aria-hidden="true" />} loading={isLoading} tone="violet" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("collection")} onKeyDown={drilldownKeyHandler("collection")} />
      </StatsGrid>

      <AttentionStrip supplierDue={dashboard.supplierDue} purchaseDue={dashboard.purchaseDue} lowStockCount={lowStockCount} pendingSyncCount={pendingSyncCount} hasUnsyncedOperations={hasUnsyncedOperations} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Low stock medicines — LEFT and prominent for pharmacy */}
        <DataTableCard title="Low Stock Medicines" description="Medicines below minimum level — reorder immediately." loading={isLoading} empty={lowStockItems.length === 0} emptyState={<EmptyState title="All medicines in stock" description="No medicines are below minimum stock level." icon={<Pill size={24} className="text-muted-foreground" />} />} actions={<Link href="/inventory"><span className="cursor-pointer text-sm text-primary hover:underline">Full stock view</span></Link>}>
          <div className="space-y-2">
            {lowStockItems.slice(0, 7).map((item, i) => (
              <div key={item.productId ?? i} className="flex items-center justify-between gap-3 rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2 dark:border-rose-900/40 dark:bg-rose-950/20">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                  {item.category ? <p className="text-xs text-muted-foreground capitalize">{String(item.category).replace(/_/g, " ")}</p> : null}
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-rose-600 dark:text-rose-400">{item.stock} {item.unit ?? "pc"}</p>
                  <p className="text-[10px] text-muted-foreground">min: {item.threshold}</p>
                </div>
              </div>
            ))}
          </div>
        </DataTableCard>

        {/* Patient accounts — RIGHT */}
        <DataTableCard title="Patient Accounts" description="Outstanding credit by patient." loading={isLoading} empty={dashboard.outstandingCustomers.length === 0} emptyState={<EmptyState title="No outstanding accounts" description="All patient accounts are settled." />} actions={<Link href="/customers?filter=udhar"><span className="cursor-pointer text-sm text-primary hover:underline">{t("dashboard.viewAll")}</span></Link>}>
          <div className="space-y-2">
            {dashboard.outstandingCustomers.slice(0, 5).map((c) => (
              <div key={c.customerId} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.customerName}</p>
                  {c.mobile ? <p className="truncate text-xs text-muted-foreground">{c.mobile}</p> : null}
                </div>
                <MoneyBadge amount={c.outstanding} tone="danger" compact />
              </div>
            ))}
          </div>
        </DataTableCard>
      </div>
    </PageShell>
  );
}

// ─── drilldown dialog ─────────────────────────────────────────────────────────

function DashboardDrilldownDialog({
  type, snapshot, cashInDrawer, onOpenChange,
}: {
  type: DrilldownType | null;
  snapshot: FinancialAggregationSnapshot | null;
  cashInDrawer: number;
  onOpenChange: (open: boolean) => void;
}) {
  const title = type === "revenue" ? "Revenue Breakdown" : type === "profit" ? "Profit Breakdown" : "Cash Collection";
  const description = type === "revenue" ? "Bills included in today's revenue." : type === "profit" ? "Product-level profit from saved bill items." : "Cash, UPI, and bank collection split for today.";

  return (
    <Dialog open={type !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {!snapshot ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Financial snapshot is still loading.</div>
        ) : type === "revenue" ? (
          <div className="space-y-2">
            {snapshot.revenueBreakdown.length === 0 ? (
              <EmptyState title="No revenue today" description="No saved sale bills are included yet." />
            ) : snapshot.revenueBreakdown.slice(0, 30).map((row) => (
              <div key={row.billId} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{row.billNo} - {row.customerName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Cash {fmt(row.cash)} - UPI {fmt(row.upi)} - Bank {fmt(row.bank)} - Udhar {fmt(row.udhar)}</p>
                </div>
                <MoneyBadge amount={row.amount} tone="success" compact />
              </div>
            ))}
          </div>
        ) : type === "profit" ? (
          <div className="space-y-2">
            {snapshot.profitByProduct.length === 0 ? (
              <EmptyState title="No product profit yet" description="Saved bill items with cost are needed for product profit." />
            ) : snapshot.profitByProduct.slice(0, 30).map((row) => (
              <div key={row.productId} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{row.productName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Qty {row.quantity.toLocaleString("en-IN")} - Revenue {fmt(row.revenue)} - Cost {fmt(row.cost)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-700">{fmt(row.profit)}</p>
                    <p className="text-xs text-muted-foreground">{row.marginPct}% margin</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <CollectionTile label="Cash sales"     value={fmt(snapshot.cashSalesToday)}          icon={<Wallet    size={16} aria-hidden="true" />} />
            <CollectionTile label="Old udhar cash" value={fmt(snapshot.cashUdharRecoveryToday)}  icon={<HandCoins size={16} aria-hidden="true" />} />
            <CollectionTile label="UPI sales"      value={fmt(snapshot.upiSalesToday)}           icon={<Smartphone size={16} aria-hidden="true" />} />
            <CollectionTile label="Old udhar UPI"  value={fmt(snapshot.upiUdharRecoveryToday)}   icon={<CreditCard size={16} aria-hidden="true" />} />
            <CollectionTile label="Bank sales"     value={fmt(snapshot.bankSalesToday)}          icon={<Landmark size={16} aria-hidden="true" />} />
            <CollectionTile label="Old udhar bank" value={fmt(snapshot.bankUdharRecoveryToday)}  icon={<Landmark size={16} aria-hidden="true" />} />
            <div className="rounded-lg border bg-muted/35 p-3 sm:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash drawer</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Expected closing cash</span>
                <span className="text-lg font-black">{fmt(cashInDrawer)}</span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── shared sub-components ────────────────────────────────────────────────────

function AttentionStrip({ supplierDue, purchaseDue, lowStockCount, pendingSyncCount, hasUnsyncedOperations }: {
  supplierDue: number; purchaseDue: number; lowStockCount: number; pendingSyncCount: number; hasUnsyncedOperations: boolean;
}) {
  return (
    <section className="premium-panel-muted mb-5 p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <Link href="/purchase-bills">
          <CompactSignal label="Supplier" value={supplierDue > 0 ? fmt(supplierDue) : "Clear"} detail={purchaseDue > 0 ? `Today due ${fmt(purchaseDue)}` : "No urgent due"} icon={<Truck size={18} aria-hidden="true" />} tone={supplierDue > 0 ? "danger" : "good"} />
        </Link>
        <Link href="/inventory">
          <CompactSignal label="Stock" value={lowStockCount > 0 ? `${lowStockCount} low` : "Healthy"} detail={lowStockCount > 0 ? "Purchase attention" : "No urgent items"} icon={<ReceiptText size={18} aria-hidden="true" />} tone={lowStockCount > 0 ? "warn" : "good"} />
        </Link>
        <Link href="/sync-status">
          <CompactSignal label="Backup" value={pendingSyncCount > 0 ? `${pendingSyncCount} pending` : "Synced"} detail={hasUnsyncedOperations ? "Review before close" : "All clear"} icon={<Sparkles size={18} aria-hidden="true" />} tone={hasUnsyncedOperations ? "warn" : "good"} />
        </Link>
        <Link href="/reports">
          <CompactSignal label="Reports" value="Owner view" detail="Weekly and monthly" icon={<TrendingUp size={18} aria-hidden="true" />} tone="neutral" />
        </Link>
      </div>
    </section>
  );
}

function CompactSignal({ label, value, detail, icon, tone = "neutral" }: { label: string; value: string; detail: string; icon: ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }) {
  const toneClass = { neutral: "bg-muted text-muted-foreground", good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", danger: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" }[tone];
  return (
    <div className="flex h-full min-h-16 items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-background/70">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneClass}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-black text-foreground">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function CollectionRow({ label, value, icon, muted }: { label: string; value: string; icon: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/25 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className={muted ? "text-muted-foreground" : "text-primary"}>{icon}</span>
        <span className="truncate text-sm text-muted-foreground">{label}</span>
      </div>
      <span className={`shrink-0 text-sm font-black ${muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function CollectionTile({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      </div>
      <p className="mt-2 break-words text-lg font-black text-foreground">{value}</p>
    </div>
  );
}
