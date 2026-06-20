import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  ShoppingCart, AlertTriangle, TrendingUp, Minus,
  Wallet, CreditCard, Smartphone, CalendarCheck, Sparkles, HandCoins,
  ReceiptText, Truck, PackagePlus, Layers, BarChart3, Building2,
  ChefHat, Wrench, Pill, ClipboardList, Package, ArrowUpRight,
  ArrowDownRight, RefreshCw, CheckCircle2, XCircle, ChevronRight, ChevronDown, Users,
  Wifi, Cloud, MonitorSmartphone,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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
import { DataTableCard, EmptyState, MoneyBadge, PageHeader, PageShell, StatCard, StatsGrid, SyncBadge } from "@/components/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBusinessType, type BusinessTypeDefinition, type QuickActionIconKey, type QuickActionColorKey } from "@/features/settings/business-types";
import { cn } from "@/lib/utils";
import type { Bill, Product } from "@/types/api";

const DASH_CARD = "rounded-[14px] border border-[#dfe8f4] bg-white shadow-[0_10px_30px_rgba(26,57,112,0.075),0_2px_7px_rgba(26,57,112,0.035)] ring-1 ring-[#edf3fa] dark:border-slate-800 dark:bg-card dark:ring-slate-800";
const DASH_CARD_INTERACTIVE = "transition-all duration-200 hover:-translate-y-0.5 hover:border-[#c7d8ee] hover:shadow-[0_14px_34px_rgba(15,35,80,0.075)] active:translate-y-0";
const DASH_TITLE = "font-display text-[15px] font-black tracking-tight text-[#102347] dark:text-card-foreground";
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

function roundMoney(n: number) {
  return Math.round(money(n) * 100) / 100;
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
  credit: number;
  cashCollected: number;
  upiCollected: number;
  supplierCashPaid: number;
  supplierUpiPaid: number;
  supplierDue: number;
  purchaseDue: number;
  previousRevenue: number;
  previousGrossProfit: number;
  previousCashCollected: number;
  previousUpiCollected: number;
  previousOutstanding: number;
  expensesToday: number;
  previousExpenses: number;
  source: string;
  hasBusinessData: boolean;
}

interface LayoutProps {
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
  const { t } = useAppLanguage();
  const { def: btDef } = useBusinessType();
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
    const credit = finance?.udharSalesToday ?? reportToday?.udharSales ?? localSnapshot.credit ?? paymentSummary.data?.credit;
    const todayUdhar = roundMoney(money(credit));
    const cashIn = roundMoney(money(cash));
    const upiIn = roundMoney(money(upi));
    const supplierCashPaid = roundMoney(money(finance?.supplierCashPaidToday ?? reportPayments?.purchaseCashPaid));
    const supplierUpiPaid = roundMoney(money(finance?.supplierUpiPaidToday ?? reportPayments?.purchaseUpiPaid));
    const purchaseDue = roundMoney(money(finance?.purchaseDueToday ?? reportPayments?.purchaseDue));
    const supplierDue = roundMoney(money(finance?.supplierDue ?? reportPayments?.purchaseDue));
    const cashCollected = roundMoney(money(finance?.totalCashCollectedToday ?? reportPayments?.cashIn ?? cashIn));
    const upiCollected = roundMoney(money(finance?.totalUpiCollectedToday ?? reportPayments?.upiIn ?? upiIn));
    const grossMarginPct = revenue > 0
      ? Math.round((grossProfit / revenue) * 100)
      : roundMoney(money(localSnapshot.grossMarginPct ?? backendPnL?.grossMarginPct));
    const totalOutstanding = roundMoney(money(finance?.totalOutstandingUdhar ?? ownerReport?.pendingUdhar ?? localSnapshot.totalOutstanding ?? udharSummary.data?.totalOutstanding));
    const recoveredToday = roundMoney(money(finance?.cashUdharRecoveryToday) + money(finance?.upiUdharRecoveryToday));
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
      cash: cashIn, upi: upiIn, credit: todayUdhar,
      cashCollected, upiCollected, supplierCashPaid, supplierUpiPaid, supplierDue, purchaseDue,
      previousRevenue: roundMoney(money(previousFinancialSnapshot?.revenueToday)),
      previousGrossProfit: roundMoney(money(previousFinancialSnapshot?.profitToday)),
      previousCashCollected: roundMoney(money(previousFinancialSnapshot?.totalCashCollectedToday)),
      previousUpiCollected: roundMoney(money(previousFinancialSnapshot?.totalUpiCollectedToday)),
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
    btDef, dashboard, ownerReport, financialSnapshot, isLoading,
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

function GeneralLayout({ dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, seedingDemo, onLoadDemo, openDrilldown }: LayoutProps) {
  const { isOnline, isSyncing, pendingCount, failedCount } = useOfflineStatus();
  const [, navigate] = useLocation();
  const today = format(new Date(), "yyyy-MM-dd");
  const weekAgo = format(new Date(Date.now() - 6 * 86_400_000), "yyyy-MM-dd");
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [productsById, setProductsById] = useState<Record<string, Product>>({});

  const recentBillsQuery = useListBills({ limit: 10 }, { query: { staleTime: 60_000 } });
  const weeklyBillsQuery = useListBills({ from: weekAgo, to: today, limit: 500 }, { query: { staleTime: 5 * 60_000 } });

  const lowStockItems = ownerReport?.lowStock ?? [];

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

  // Build weekly sales chart data
  const salesChartData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86_400_000);
      return { dateKey: format(d, "yyyy-MM-dd"), label: format(d, "d MMM"), value: 0 };
    });
    const bills = weeklyBillsQuery.data?.bills ?? [];
    for (const bill of bills) {
      const dateStr = bill.createdAt?.slice(0, 10);
      const slot = days.find(d => d.dateKey === dateStr);
      if (slot) slot.value += Number(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0);
    }
    // Use today's known revenue for today's slot
    if (days[6]) days[6].value = Math.max(days[6].value, dashboard.revenue);
    return days.map(d => ({ date: d.label, sales: Math.round(d.value) }));
  }, [weeklyBillsQuery.data, dashboard.revenue]);

  const paymentBreakdown = useMemo<PaymentSlice[]>(() => {
    const other = Math.max(0, roundMoney(dashboard.revenue - dashboard.cash - dashboard.upi - dashboard.credit));
    return [
      { label: "Cash", value: dashboard.cash, color: "#2fc45a", dot: "bg-[#2fc45a]" },
      { label: "UPI", value: dashboard.upi, color: "#316df4", dot: "bg-[#316df4]" },
      { label: "Udhar", value: dashboard.credit, color: "#f2a20b", dot: "bg-[#f2a20b]" },
      { label: "Other", value: other, color: "#7557e8", dot: "bg-[#7557e8]" },
    ].filter((row) => row.value > 0);
  }, [dashboard.cash, dashboard.credit, dashboard.revenue, dashboard.upi]);

  const recentBills = useMemo(
    () => [...(recentBillsQuery.data?.bills ?? [])]
      .sort((a, b) => sortTime(b.createdAt) - sortTime(a.createdAt)),
    [recentBillsQuery.data?.bills],
  );
  const yesterdaySales = dashboard.previousRevenue || salesChartData[5]?.sales || 0;
  const salesDelta = pctChange(dashboard.revenue, yesterdaySales) ?? 0;
  const cashDelta = pctChange(dashboard.cashCollected, dashboard.previousCashCollected) ?? 0;
  const upiDelta = pctChange(dashboard.upiCollected, dashboard.previousUpiCollected) ?? 0;
  const outstandingDelta = pctChange(dashboard.totalOutstanding, dashboard.previousOutstanding) ?? 0;
  const profitDelta = pctChange(dashboard.grossProfit, dashboard.previousGrossProfit) ?? 0;
  const expenseDelta = pctChange(dashboard.expensesToday, dashboard.previousExpenses) ?? 0;
  const avgBillValue = dashboard.billCount > 0 ? Math.round(dashboard.revenue / dashboard.billCount) : 0;
  const syncStatusValue = failedCount > 0 ? "Review needed" : pendingCount > 0 ? `${pendingCount} pending` : "Up to date";
  const syncHealthGood = failedCount === 0 && pendingCount === 0;

  return (
    <>
      <MobileGeneralDashboard
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
        cashDelta={cashDelta}
        upiDelta={upiDelta}
        outstandingDelta={outstandingDelta}
        profitDelta={profitDelta}
        expenseDelta={expenseDelta}
      />
      <div className="mx-auto hidden w-full max-w-[1440px] space-y-4 p-4 sm:p-5 lg:block lg:space-y-5 lg:p-6">

      {/* Counter focus */}
      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Today's Sales"
          value={fmtRs(dashboard.revenue)}
          delta={salesDelta}
          deltaLabel="vs yesterday"
          icon={<ShoppingCart size={18} />}
          iconBg="border border-[#cfe0ff] bg-[#eaf2ff] text-[#075fff] shadow-[0_0_0_4px_rgba(7,95,255,0.035),0_10px_26px_rgba(7,95,255,0.22)]"
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
          loading={isLoading}
          onClick={() => openDrilldown("collection")}
        />
        <Link href="/udhar?filter=outstanding" className="block h-full">
          <KpiCard
            label="Outstanding Udhar"
            value={fmtRs(dashboard.totalOutstanding)}
            delta={outstandingDelta}
            deltaLabel="vs yesterday"
            deltaPositiveIsBad
            icon={<AlertTriangle size={18} />}
            iconBg="border border-[#ffcfd7] bg-[#ffecef] text-[#ff2748] shadow-[0_0_0_4px_rgba(255,39,72,0.035),0_10px_26px_rgba(255,39,72,0.20)]"
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
          loading={isLoading}
          onClick={() => openDrilldown("profit")}
        />
        <Link href="/inventory" className="block h-full">
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
      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.9fr)_minmax(220px,0.78fr)_minmax(280px,1fr)]">

        {/* Sales Overview */}
        <section className={cn(DASH_CARD, "h-full min-h-[316px] overflow-hidden p-5 lg:col-span-2 xl:col-span-1 xl:h-[316px]")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className={DASH_TITLE}>Sales Overview</p>
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full border border-[#b9c7dc] text-[10px] font-black text-[#60708a]">i</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                <p className="font-display text-[27px] font-black leading-none tracking-tight text-[#102347] dark:text-card-foreground">{fmtRs(dashboard.revenue)}</p>
                <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#d5deeb] bg-white px-2 py-1 text-[10px] font-bold text-[#314766] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  This Week <ChevronDown size={11} aria-hidden="true" />
                </span>
                {salesDelta !== null && (
                  <span className={cn("flex items-center gap-1 text-[12px] font-bold", salesDelta === 0 ? "text-[#62708a]" : salesDelta > 0 ? "text-[#16a34a]" : "text-[#ff304f]")}>
                    {salesDelta === 0 ? <Minus size={12} /> : salesDelta > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {Math.abs(salesDelta)}% vs yesterday
                  </span>
                )}
              </div>
            </div>
            <Link href="/reports" className="rounded-[9px] border border-[#bfd3ff] bg-[#eef5ff] px-4 py-2 text-[12px] font-black text-[#0057ff] shadow-[0_6px_14px_rgba(0,87,255,0.06)] transition-colors hover:bg-[#e2edff]">
              View Report
            </Link>
          </div>
          <div className="mt-4 h-[205px] min-h-[205px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesChartData} margin={{ top: 12, right: 10, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesOverviewFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#075fff" stopOpacity={0.30} />
                    <stop offset="46%" stopColor="#2f7dff" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="#075fff" stopOpacity={0.02} />
                  </linearGradient>
                  <filter id="salesOverviewGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#075fff" floodOpacity="0.30" />
                  </filter>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="4 7" stroke="#d7e3f2" />
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
                  stroke="#075fff"
                  strokeWidth={3.25}
                  fill="url(#salesOverviewFill)"
                  filter="url(#salesOverviewGlow)"
                  dot={{ r: 4, fill: "#ffffff", stroke: "#075fff", strokeWidth: 2.75 }}
                  activeDot={{ r: 6, fill: "#ffffff", stroke: "#075fff", strokeWidth: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <PaymentModeBreakdown rows={paymentBreakdown} total={dashboard.revenue} />
        <LowStockAlerts items={lowStockItems} productsById={productsById} />

      </div>

      {/* ── Recent Bills + Quick Insights ── */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.9fr)_minmax(220px,0.78fr)_minmax(280px,1fr)]">

        {/* Recent Bills */}
        <section className={cn(DASH_CARD, "flex h-full min-h-[316px] flex-col overflow-hidden lg:col-span-2 xl:col-span-1 xl:h-[318px]")}>
          <div className="flex items-center justify-between gap-3 border-b border-[#e6ecf4] px-5 py-4">
            <p className={DASH_TITLE}>Recent Bills</p>
            <Link href="/bills" className="text-[12px] font-black text-[#0057ff] hover:underline">View all</Link>
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#e6ecf4] bg-[#f8fbff]">
                  {["Bill No.", "Time", "Customer", "Items", "Amount", "Payment"].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.02em] text-[#6b7890]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading || recentBillsQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-5 py-2"><div className="h-3 animate-pulse rounded bg-[#edf2f8]" style={{ width: `${50 + j * 10}%` }} /></td>
                      ))}
                    </tr>
                  ))
                ) : recentBills.length === 0 ? (
                  <tr><td colSpan={6} className={cn("px-5 py-8 text-center text-sm", DASH_MUTED)}>No bills today yet</td></tr>
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
                        className="cursor-pointer border-b border-[#edf2f8] text-[#102347] transition-colors last:border-0 hover:bg-[#f8fbff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0057ff]/40 dark:text-card-foreground"
                      >
                        <td className="whitespace-nowrap px-5 py-2 font-black text-[#102347] dark:text-card-foreground">{bill.billNo ?? "—"}</td>
                        <td className={cn("whitespace-nowrap px-5 py-2 font-medium", DASH_MUTED)}>{bill.createdAt ? format(new Date(bill.createdAt), "hh:mm a") : "—"}</td>
                        <td className="max-w-32 truncate px-5 py-2 font-semibold">{bill.customerName ?? "Walk-in"}</td>
                        <td className={cn("px-5 py-2 font-semibold", DASH_MUTED)}>{Array.isArray(bill.items) ? bill.items.length : "—"}</td>
                        <td className="whitespace-nowrap px-5 py-2 font-black">{fmtRs(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0)}</td>
                        <td className="px-5 py-2">
                          <RecentBillPaymentBadge mode={recentBillPaymentMode(bill as unknown as Record<string, unknown>)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="grid border-t border-[#e6ecf4] bg-[#fbfdff] text-sm sm:grid-cols-2">
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#eef5ff] text-[#0057ff]">
                <ReceiptText size={16} />
              </span>
              <div>
                <p className={cn("text-xs font-semibold", DASH_MUTED)}>Total Bills</p>
                <p className="font-display text-[18px] font-black text-[#102347] dark:text-card-foreground">{dashboard.billCount}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 px-5 py-4 sm:border-l sm:border-[#e6ecf4]">
              <p className={cn("text-xs font-semibold", DASH_MUTED)}>Total Amount</p>
              <p className="font-display text-[19px] font-black text-[#102347] dark:text-card-foreground">{fmtRs(dashboard.revenue)}</p>
            </div>
          </div>
        </section>

        {/* Right column: Quick Insights + Sync & Health */}
        <div className="contents">

          {/* Quick Insights */}
          <div className={cn(DASH_CARD, "h-full min-h-[316px] p-4 xl:h-[318px]")}>
            <p className={cn(DASH_TITLE, "mb-3")}>Quick Insights</p>
            <div className="space-y-2">
              <InsightRow tone="emerald" icon={<Package size={16} />} label="Best Selling Category" value={ownerReport?.topProducts[0]?.name ? "Sales leaders" : "No sales yet"} href="/reports" />
              <InsightRow tone="blue" icon={<PackagePlus size={16} />} label="Top Selling Product" value={ownerReport?.topProducts[0]?.name ?? "No product yet"} href="/reports" />
              <InsightRow tone="violet" icon={<CreditCard size={16} />} label="Average Bill Value" value={avgBillValue > 0 ? fmtRs(avgBillValue) : fmtRs(0)} href="/bills" />
              <InsightRow tone="orange" icon={<Users size={16} />} label="New Customers Today" value={String(ownerReport?.topCustomers.length ?? 0)} href="/customers" />
            </div>
          </div>

          {/* Sync & Health */}
          <div className={cn(DASH_CARD, "h-full min-h-[316px] p-4 xl:h-[318px]")}>
            <p className={cn(DASH_TITLE, "mb-3")}>Sync & Health</p>
            <div className="border-b border-[#edf2f8] pb-3">
              <div className="flex items-center gap-2 text-sm font-black text-[#11a84b] dark:text-emerald-300">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e7faee] shadow-[0_4px_12px_rgba(17,168,75,0.16)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
                {syncHealthGood ? "All systems operational" : "Backup needs attention"}
              </div>
              <p className={cn("ml-7 mt-1 text-[11px] font-semibold", DASH_MUTED)}>
                {isSyncing ? "Sync running now" : syncHealthGood ? "Last synced just now" : "Local data is safe"}
              </p>
            </div>
            <div className="mt-3 space-y-3.5">
              <HealthRow icon={<Wifi size={13} />} label="Internet Connection" status={isOnline ? "ok" : "warn"} value={isOnline ? "Online" : "Offline"} />
              <HealthRow icon={<RefreshCw size={13} />} label="Data Sync" status={failedCount > 0 ? "error" : pendingCount > 0 ? "warn" : "ok"} value={syncStatusValue} />
              <HealthRow icon={<Cloud size={13} />} label="Backup Status" status={pendingCount > 0 || failedCount > 0 ? "warn" : "ok"} value={isSyncing ? "Syncing" : pendingCount > 0 ? "Queued" : "Secure"} />
              <HealthRow icon={<MonitorSmartphone size={13} />} label="Device Status" status="ok" value="Active" />
            </div>
            <Link href="/sync-status">
              <button type="button" className="mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#0057ff] py-3 text-sm font-black text-white shadow-[0_12px_24px_rgba(0,87,255,0.22)] transition-all hover:-translate-y-0.5 hover:bg-[#004de0] active:translate-y-0">
                <RefreshCw size={15} aria-hidden="true" /> Sync Now
              </button>
            </Link>
            <p className={cn("mt-2 text-center text-[11px] font-semibold", DASH_MUTED)}>
              <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full", syncHealthGood ? "bg-emerald-500" : "bg-amber-500")} /> Auto sync is enabled
            </p>
          </div>

          {/* Demo seed */}
          {!dashboard.hasBusinessData && (
            <button type="button" onClick={onLoadDemo} disabled={seedingDemo}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#cbd8ea] py-3 text-sm font-bold text-[#62708a] transition-colors hover:border-[#0057ff]/40 hover:text-[#0057ff]">
              <Sparkles size={15} aria-hidden="true" />
              {seedingDemo ? "Loading demo…" : "Load demo shop data"}
            </button>
          )}
        </div>
      </div>

      <RecentProductsRail products={recentProducts} />

      </div>
    </>
  );
}

// ─── General layout sub-components ────────────────────────────────────────────

interface MobileGeneralDashboardProps {
  dashboard: DashboardStats;
  ownerReport: LocalReportSnapshot | null;
  salesChartData: Array<{ date: string; sales: number }>;
  recentBills: Bill[];
  recentProducts: Product[];
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  salesDelta: number;
  cashDelta: number;
  upiDelta: number;
  outstandingDelta: number;
  profitDelta: number;
  expenseDelta: number;
}

function MobileGeneralDashboard({
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
  cashDelta,
  upiDelta,
  outstandingDelta,
  profitDelta,
  expenseDelta,
}: MobileGeneralDashboardProps) {
  const syncHealthy = failedCount === 0 && pendingCount === 0;
  const topRows = ownerReport?.topProducts.slice(0, 5) ?? [];
  const productsById = new Map(recentProducts.map((product) => [product.id, product]));
  const dateRange = `${format(new Date(Date.now() - 6 * 86_400_000), "d MMM")} - ${format(new Date(), "d MMM yyyy")}`;

  return (
    <div className="mx-auto w-full max-w-[520px] space-y-4 bg-[#f8fbff] px-3 pb-24 pt-3 lg:hidden">
      <section className="flex items-center justify-between rounded-[12px] border border-[#d7eadf] bg-white px-3 py-2.5 shadow-[0_6px_18px_rgba(26,57,112,0.05)]">
        <div className="flex items-center gap-2.5">
          <span className={cn("grid h-8 w-8 place-items-center rounded-full text-white shadow-[0_6px_16px_rgba(17,168,75,0.22)]", syncHealthy && isOnline ? "bg-[#18b957]" : "bg-[#f59e0b]") }>
            {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={17} />}
          </span>
          <div>
            <p className={cn("text-[12px] font-black", syncHealthy && isOnline ? "text-[#159447]" : "text-[#b96d00]")}>
              {isSyncing ? "Syncing" : !isOnline ? "Offline safe" : syncHealthy ? "Synced" : failedCount > 0 ? "Review needed" : `${pendingCount} pending`}
            </p>
            <p className="text-[10px] font-semibold text-[#6a7890]">{isOnline ? "Just now" : "Offline safe"}</p>
          </div>
        </div>
        <Link href="/sync-status" className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#cfe0ff] bg-white px-3 py-2 text-[11px] font-black text-[#075fff]">
          <RefreshCw size={13} /> Sync Now
        </Link>
      </section>

      <section>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h2 className="font-display text-[14px] font-black text-[#102347]">Business Overview</h2>
          <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#d7e0ec] bg-white px-2 py-1.5 text-[9px] font-bold text-[#344865]">
            <CalendarCheck size={11} /> {dateRange} <ChevronDown size={10} />
          </span>
        </div>
        <div className="grid auto-rows-fr grid-cols-3 gap-2">
          <MobileMetricCard label="Total Sales" value={dashboard.revenue} previous={dashboard.previousRevenue} delta={salesDelta} color="#075fff" icon={<ShoppingCart size={13} />} iconClass="border-[#cfe0ff] bg-[#eaf2ff] text-[#075fff]" />
          <MobileMetricCard label="Cash Collection" value={dashboard.cashCollected} previous={dashboard.previousCashCollected} delta={cashDelta} color="#18ad50" icon={<Wallet size={13} />} iconClass="border-[#c8f1d5] bg-[#e7faee] text-[#159447]" />
          <MobileMetricCard label="UPI Collection" value={dashboard.upiCollected} previous={dashboard.previousUpiCollected} delta={upiDelta} color="#7447eb" icon={<Smartphone size={13} />} iconClass="border-[#ddd3ff] bg-[#f0ebff] text-[#7047eb]" />
          <MobileMetricCard label="Profit (Est.)" value={dashboard.grossProfit} previous={dashboard.previousGrossProfit} delta={profitDelta} color="#18ad50" icon={<TrendingUp size={13} />} iconClass="border-[#c8f1d5] bg-[#e7faee] text-[#159447]" />
          <MobileMetricCard label="Outstanding Udhar" value={dashboard.totalOutstanding} previous={dashboard.previousOutstanding} delta={outstandingDelta} color="#ff304f" icon={<AlertTriangle size={13} />} iconClass="border-[#ffcfd7] bg-[#ffecef] text-[#ff304f]" positiveIsBad />
          <MobileMetricCard label="Expense Total" value={dashboard.expensesToday} previous={dashboard.previousExpenses} delta={expenseDelta} color="#f39a0b" icon={<Wallet size={13} />} iconClass="border-[#ffdca8] bg-[#fff2df] text-[#f39a0b]" positiveIsBad />
        </div>
      </section>

      <section className="border-y border-[#e7edf5] bg-white px-1 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[14px] font-black text-[#102347]">Sales Trend</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold text-[#64748b]">Total Sales</span>
              <span className="text-[12px] font-black text-[#102347]">{fmtCompactRs(dashboard.revenue)}</span>
              <MobileDelta delta={salesDelta} />
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-[7px] border border-[#d5deeb] px-2 py-1 text-[9px] font-bold text-[#314766]">This Week <ChevronDown size={10} /></span>
        </div>
        <div className="mt-2 h-[185px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesChartData} margin={{ top: 10, right: 8, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="mobileSalesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#075fff" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="#075fff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="4 6" stroke="#dbe6f4" />
              <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#64748b", fontWeight: 600 }} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tick={{ fontSize: 8, fill: "#64748b", fontWeight: 600 }} tickLine={false} axisLine={false} width={38} tickFormatter={(value) => value >= 1000 ? `₹${Math.round(value / 1000)}K` : `₹${value}`} />
              <Tooltip formatter={(value: number) => [fmtCompactRs(value), "Sales"]} />
              <Area type="monotone" dataKey="sales" stroke="#075fff" strokeWidth={2.5} fill="url(#mobileSalesFill)" dot={{ r: 3, fill: "white", stroke: "#075fff", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h2 className="mb-2.5 font-display text-[14px] font-black text-[#102347]">Quick Insights</h2>
        <div className="overflow-hidden rounded-[12px] border border-[#e1e9f3] bg-white shadow-[0_7px_22px_rgba(26,57,112,0.05)]">
          <MobileInsight tone="emerald" icon={<TrendingUp size={15} />} title={`Sales ${salesDelta >= 0 ? "increased" : "changed"} by ${Math.abs(salesDelta)}% compared with yesterday.`} subtitle="Review the sales trend and payment mix." />
          <MobileInsight tone="orange" icon={<Package size={15} />} title={`${ownerReport?.topProducts[0]?.name ?? "Your top product"} is leading sales.`} subtitle="Keep the best sellers available in stock." />
          <MobileInsight tone="rose" icon={<Users size={15} />} title={`${dashboard.outstandingCustomers.length} customers have outstanding dues.`} subtitle="Follow up to improve cash flow." />
          <Link href="/reports" className="flex items-center justify-center gap-2 border-t border-[#e7edf5] py-2.5 text-[11px] font-black text-[#075fff]">View Detailed Insights <ArrowUpRight size={12} /></Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <div className="overflow-hidden rounded-[12px] border border-[#e1e9f3] bg-white">
          <div className="flex items-center justify-between border-b border-[#edf2f8] px-2.5 py-2.5">
            <h2 className="text-[11px] font-black text-[#102347]">Top Products</h2>
            <Link href="/products" className="text-[9px] font-black text-[#075fff]">View all</Link>
          </div>
          <div className="divide-y divide-[#edf2f8] px-2">
            {(topRows.length > 0 ? topRows : recentProducts.slice(0, 5).map((product) => ({ productId: product.id, name: product.name, quantitySold: Number(product.stockQuantity ?? 0), revenue: productPrice(product), profitEstimate: 0 }))).map((row) => (
              <Link key={row.productId} href="/products" className="flex items-center gap-1.5 py-2">
                <ProductAvatar product={productsById.get(row.productId) ?? ({ id: row.productId, name: row.name } as Product)} compact />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[9px] font-black text-[#102347]">{row.name}</p>
                  <p className="text-[8px] font-semibold text-[#718096]">{row.quantitySold.toLocaleString("en-IN")} qty</p>
                </div>
                <span className="whitespace-nowrap text-[9px] font-black text-[#102347]">{fmtCompactRs(row.revenue)}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[12px] border border-[#e1e9f3] bg-white">
          <div className="flex items-center justify-between border-b border-[#edf2f8] px-2.5 py-2.5">
            <h2 className="text-[11px] font-black text-[#102347]">Recent Bills</h2>
            <Link href="/bills" className="text-[9px] font-black text-[#075fff]">View all</Link>
          </div>
          <div className="divide-y divide-[#edf2f8] px-2">
            {recentBills.slice(0, 5).map((bill) => (
              <Link key={bill.id ?? bill.billNo} href={`/bills/${bill.id ?? ""}`} className="block py-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[9px] font-black text-[#102347]">{bill.billNo ?? "Bill"}</span>
                  <span className="whitespace-nowrap text-[9px] font-black text-[#102347]">{fmtCompactRs(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? 0)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="truncate text-[8px] font-semibold text-[#718096]">{bill.customerName ?? "Walk-in"}</span>
                  <RecentBillPaymentBadge mode={recentBillPaymentMode(bill as unknown as Record<string, unknown>)} />
                </div>
              </Link>
            ))}
          </div>
          <Link href="/bills" className="flex items-center justify-center gap-1 border-t border-[#edf2f8] py-2.5 text-[9px] font-black text-[#075fff]">View All Bills <ArrowUpRight size={10} /></Link>
        </div>
      </section>

      <Link href="/billing" aria-label="Create new bill" className="fixed left-1/2 z-50 grid h-12 w-12 -translate-x-1/2 place-items-center rounded-full bg-[#075fff] text-white shadow-[0_12px_28px_rgba(7,95,255,0.34)] lg:hidden" style={{ bottom: "calc(var(--app-mobile-nav-height) + env(safe-area-inset-bottom) + 10px)" }}>
        <PackagePlus size={22} />
      </Link>
    </div>
  );
}

function MobileMetricCard({ label, value, previous, delta, color, icon, iconClass, positiveIsBad = false }: {
  label: string;
  value: number;
  previous: number;
  delta: number;
  color: string;
  icon: ReactNode;
  iconClass: string;
  positiveIsBad?: boolean;
}) {
  const spark = mobileSparkline(previous, value);
  const bad = positiveIsBad ? delta > 0 : delta < 0;
  const deltaColor = delta === 0 ? "text-[#718096]" : bad ? "text-[#ef3340]" : "text-[#16a34a]";
  return (
    <div className="flex min-w-0 flex-col rounded-[11px] border border-[#e2eaf4] bg-white p-2.5 shadow-[0_7px_20px_rgba(26,57,112,0.055)]">
      <div className="flex min-h-[28px] items-center gap-1.5">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border", iconClass)}>{icon}</span>
        <span className="min-w-0 text-[9px] font-bold leading-tight text-[#3f506b]">{label}</span>
      </div>
      <p className="mt-2 truncate font-display text-[16px] font-black tracking-tight text-[#102347]">{fmtCompactRs(value)}</p>
      <div className={cn("mt-1 flex items-center gap-0.5 text-[8px] font-black", deltaColor)}>
        {delta === 0 ? <Minus size={9} /> : delta > 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
        {Math.abs(delta)}% <span className="font-semibold text-[#7b8799]">vs yesterday</span>
      </div>
      <div className="mt-auto h-7 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={spark}>
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MobileDelta({ delta }: { delta: number }) {
  const color = delta === 0 ? "text-[#718096]" : delta > 0 ? "text-[#16a34a]" : "text-[#ef3340]";
  return <span className={cn("inline-flex items-center gap-0.5 text-[9px] font-black", color)}>{delta === 0 ? <Minus size={9} /> : delta > 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}{Math.abs(delta)}% vs yesterday</span>;
}

function MobileInsight({ tone, icon, title, subtitle }: { tone: "emerald" | "orange" | "rose"; icon: ReactNode; title: string; subtitle: string }) {
  const toneClass = tone === "emerald" ? "bg-[#e8f9ee] text-[#159447]" : tone === "orange" ? "bg-[#fff3e1] text-[#e98400]" : "bg-[#ffecef] text-[#ef3340]";
  return (
    <div className="flex gap-2.5 border-b border-[#edf2f8] px-3 py-2.5">
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", toneClass)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-black leading-snug text-[#253854]">{title}</p>
        <p className="mt-0.5 text-[9px] font-medium leading-snug text-[#718096]">{subtitle}</p>
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

function KpiCard({ label, value, delta, deltaLabel, deltaPositiveIsBad, icon, iconBg, loading, footer, onClick }: {
  label: string; value: string; delta?: number | null; deltaLabel?: string; deltaPositiveIsBad?: boolean;
  icon: ReactNode; iconBg: string; loading?: boolean; footer?: ReactNode; onClick?: () => void;
}) {
  const isPositive = (delta ?? 0) > 0;
  const isNegative = (delta ?? 0) < 0;
  const isBad = deltaPositiveIsBad ? isPositive : isNegative;
  const DeltaIcon = delta === null || delta === undefined || delta === 0 ? Minus : isPositive ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={cn(DASH_CARD, "h-full min-h-[142px] overflow-hidden p-5", onClick && ["cursor-pointer", DASH_CARD_INTERACTIVE])}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]", iconBg)}>{icon}</div>
      </div>
      <div className="mt-3">
        <p className={cn("text-[13px] font-bold leading-tight", DASH_MUTED)}>{label}</p>
        {loading ? (
          <div className="mt-2 h-7 w-3/4 animate-pulse rounded bg-[#edf2f8]" />
        ) : (
          <p className="mt-2 break-words font-display text-[23px] font-black leading-none tracking-tight text-[#102347] dark:text-card-foreground">{value}</p>
        )}
        {delta !== null && delta !== undefined && (
          <div className={cn("mt-3 flex items-center gap-1 text-[12px] font-black", delta === 0 ? "text-[#62708a]" : isBad ? "text-[#ff304f]" : "text-[#16a34a]")}>
            <DeltaIcon size={12} aria-hidden="true" />
            {Math.abs(delta)}% {deltaLabel}
          </div>
        )}
        {footer && <div className="mt-3 leading-none">{footer}</div>}
      </div>
    </div>
  );
}

function PaymentModeBreakdown({ rows, total }: { rows: PaymentSlice[]; total: number }) {
  const realTotal = rows.reduce((sum, row) => sum + row.value, 0);
  const displayTotal = total > 0 ? total : realTotal;
  const chartRows = rows.length > 0 ? rows : [{ label: "No sales", value: 1, color: "#e5e7eb", dot: "bg-muted" }];

  return (
    <section className={cn(DASH_CARD, "h-full min-h-[316px] p-5 xl:h-[316px]")}>
      <div>
        <p className={cn(DASH_TITLE, "text-[14px]")}>Payment Mode Breakdown</p>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-[7px] border border-[#d5deeb] bg-white px-2 py-1 text-[10px] font-bold text-[#314766] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          This Week <ChevronDown size={11} aria-hidden="true" />
        </span>
      </div>
      <div className="relative mt-2 h-[132px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartRows}
              dataKey="value"
              nameKey="label"
              innerRadius={45}
              outerRadius={68}
              paddingAngle={3}
              stroke="hsl(var(--card))"
              strokeWidth={3}
            >
              {chartRows.map((entry) => (
                <Cell key={entry.label} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-display text-[17px] font-black leading-none text-[#102347] dark:text-card-foreground">{fmtRs(displayTotal)}</p>
            <p className={cn("mt-1 text-[11px] font-semibold", DASH_MUTED)}>Total Sales</p>
          </div>
        </div>
      </div>
      <div className="mt-1 space-y-1.5">
        {(rows.length > 0 ? rows : chartRows).map((row) => {
          const pct = realTotal > 0 ? Math.round((row.value / realTotal) * 1000) / 10 : 0;
          return (
            <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
              <span className={cn("flex items-center gap-2 font-semibold", DASH_MUTED)}>
                <span className={cn("h-2 w-2 rounded-full", row.dot)} />
                {row.label}
              </span>
              <span className="font-black text-[#102347] dark:text-card-foreground">{fmtRs(row.value)} {realTotal > 0 ? `(${pct}%)` : ""}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LowStockAlerts({ items, productsById }: { items: LocalReportSnapshot["lowStock"]; productsById: Record<string, Product> }) {
  return (
    <section className={cn(DASH_CARD, "h-full min-h-[316px] p-5 xl:h-[316px]")}>
      <div className="flex items-center justify-between gap-3">
        <p className={DASH_TITLE}>Low Stock Alerts</p>
        <Link href="/inventory" className="text-[12px] font-black text-[#0057ff] hover:underline">View all</Link>
      </div>
      <div className="mt-3 space-y-2">
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
                    <p className="truncate text-sm font-black leading-tight text-[#102347] dark:text-card-foreground">{item.name}</p>
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
    blue: "border-[#cfe0ff] bg-[#eaf2ff] text-[#075fff] shadow-[0_6px_16px_rgba(7,95,255,0.14)]",
    violet: "border-[#ddd3ff] bg-[#f0ebff] text-[#7047eb] shadow-[0_6px_16px_rgba(112,71,235,0.14)]",
    orange: "border-[#ffdca8] bg-[#fff2df] text-[#ff8500] shadow-[0_6px_16px_rgba(255,133,0,0.14)]",
  }[tone];
  const content = (
    <div className="flex min-h-[57px] items-center justify-between gap-3 border-b border-[#edf2f8] px-1 py-2 transition-colors hover:bg-[#f8fbff]">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border", toneClass)}>{icon}</span>
        <span className="min-w-0">
          <span className={cn("block truncate text-[11px] font-semibold", DASH_MUTED)}>{label}</span>
          <span className="block truncate text-[12px] font-black text-[#102347] dark:text-card-foreground">{value}</span>
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
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className={cn("flex items-center gap-2 font-semibold", DASH_MUTED)}>
        <span className={cn("grid h-6 w-6 place-items-center rounded-[7px] bg-[#f4f7fb]", color)}>{icon}</span>
        {label}
      </span>
      <span className={cn("flex items-center gap-1 font-semibold", color)}>
        <Icon size={11} aria-hidden="true" /> {value}
      </span>
    </div>
  );
}

function RecentProductsRail({ products }: { products: Product[] }) {
  return (
    <section className={cn(DASH_CARD, "overflow-hidden")}>
      <div className="flex items-center justify-between gap-3 border-b border-[#edf2f8] px-5 py-3.5">
        <p className={DASH_TITLE}>Recently Added Products</p>
        <Link href="/products" className="text-[12px] font-black text-[#075fff] hover:underline">View all</Link>
      </div>
      {products.length === 0 ? (
        <div className={cn("m-4 rounded-[10px] border border-dashed border-[#dce7f5] px-4 py-7 text-center text-sm font-semibold", DASH_MUTED)}>
          Products will appear here after you add stock.
        </div>
      ) : (
        <div className="flex min-h-[88px] items-stretch overflow-x-auto px-2">
          {products.slice(0, 8).map((product) => (
            <Link key={product.id} href={`/products?highlight=${encodeURIComponent(product.id)}`} className="group min-w-[190px] flex-1 border-r border-[#edf2f8] last:border-r-0">
              <div className="flex h-full items-center gap-3 px-4 py-3 transition-colors group-hover:bg-[#f8fbff]">
                <ProductAvatar product={product} compact />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-black text-[#102347]">{product.name}</p>
                  <p className={cn("mt-0.5 text-[11px] font-semibold", DASH_MUTED)}>{productUnitLabel(product)}</p>
                  <p className="mt-1 text-[12px] font-black text-[#102347]">{fmtRs(productPrice(product))}</p>
                </div>
              </div>
            </Link>
          ))}
          <Link href="/products" className="grid min-w-[72px] place-items-center px-3">
            <div className="grid h-10 w-10 place-items-center rounded-full border border-[#cfdaea] bg-white text-[#5f6f88] shadow-[0_7px_18px_rgba(26,57,112,0.10)] transition-all hover:border-[#075fff]/40 hover:text-[#075fff] hover:shadow-[0_9px_22px_rgba(7,95,255,0.16)]">
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
    <div className={cn(size, radius, "grid shrink-0 place-items-center bg-[#eef5ff] text-sm font-black text-[#0057ff] shadow-[0_6px_14px_rgba(0,87,255,0.08)]")}>
      {product.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function productPrice(product: Product): number {
  return money(product.sellingPrice ?? product.defaultPricePerRateUnit ?? product.retailPrice ?? 0);
}

function productUnitLabel(product: Product): string {
  const unit = product.displayUnit ?? product.unit ?? product.rateUnit ?? "piece";
  const stock = Number(product.stockQuantity ?? product.stockBaseQty);
  if (Number.isFinite(stock) && stock >= 0) return `${stock.toLocaleString("en-IN")} ${unit}`;
  return unit;
}

function fmtRs(n: number | undefined | null) {
  const value = Number(n ?? 0);
  const safe = Number.isFinite(value) ? value : 0;
  return `₹${safe.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── RESTAURANT layout ────────────────────────────────────────────────────────

function RestaurantLayout({ btDef, dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations, seedingDemo, userName, onLoadDemo, openDrilldown, drilldownKeyHandler }: LayoutProps) {
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

function TechnicalLayout({ btDef, dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations, seedingDemo, userName, onLoadDemo, openDrilldown, drilldownKeyHandler }: LayoutProps) {
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

      <StatsGrid className="mb-6">
        <StatCard label={dbCfg.kpi.revenue} value={fmt(dashboard.revenue)} description={`${dashboard.billCount} bills · tap for details`} icon={<Wrench size={20} aria-hidden="true" />} loading={isLoading} tone="green" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("revenue")} onKeyDown={drilldownKeyHandler("revenue")} />
        <StatCard label="Supplier Dues" value={dashboard.supplierDue > 0 ? fmt(dashboard.supplierDue) : "Clear"} description={dashboard.purchaseDue > 0 ? `Today due ${fmt(dashboard.purchaseDue)}` : "No urgent due"} icon={<Truck size={20} aria-hidden="true" />} loading={isLoading} tone={dashboard.supplierDue > 0 ? "red" : "green"} />
        <Link href="/udhar?filter=outstanding">
          <StatCard label={dbCfg.kpi.credit} value={fmt(dashboard.totalOutstanding)} description={`${dashboard.outstandingCustomers.length} party accounts`} icon={<AlertTriangle size={20} aria-hidden="true" />} loading={isLoading} tone="amber" className="h-full cursor-pointer" />
        </Link>
        <StatCard label={dbCfg.kpi.cash} value={fmt(dashboard.cashCollected)} description={`Drawer ${fmt(cashInDrawer)}`} icon={<Wallet size={20} aria-hidden="true" />} loading={isLoading} tone="violet" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("collection")} onKeyDown={drilldownKeyHandler("collection")} />
      </StatsGrid>

      <AttentionStrip supplierDue={dashboard.supplierDue} purchaseDue={dashboard.purchaseDue} lowStockCount={lowStockCount} pendingSyncCount={pendingSyncCount} hasUnsyncedOperations={hasUnsyncedOperations} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTableCard title="Party Credit (Khata)" description="Customers with outstanding balance." loading={isLoading} empty={dashboard.outstandingCustomers.length === 0} emptyState={<EmptyState title="No outstanding khata" description="All customer accounts are clear." />} actions={<Link href="/udhar"><span className="cursor-pointer text-sm text-primary hover:underline">{t("dashboard.viewAll")}</span></Link>}>
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

function MedicalLayout({ btDef, dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations, seedingDemo, userName, onLoadDemo, openDrilldown, drilldownKeyHandler }: LayoutProps) {
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

      <StatsGrid className="mb-6">
        <StatCard label={dbCfg.kpi.revenue} value={fmt(dashboard.revenue)} description={`${dashboard.billCount} dispensing counters`} icon={<ClipboardList size={20} aria-hidden="true" />} loading={isLoading} tone="green" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("revenue")} onKeyDown={drilldownKeyHandler("revenue")} />
        <StatCard label="Low Stock" value={lowStockCount > 0 ? `${lowStockCount} items` : "Healthy"} description={lowStockCount > 0 ? "Reorder required" : "All medicines stocked"} icon={<Pill size={20} aria-hidden="true" />} loading={isLoading} tone={lowStockCount > 0 ? "red" : "green"} />
        <Link href="/udhar?filter=outstanding">
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
        <DataTableCard title="Patient Accounts" description="Outstanding credit by patient." loading={isLoading} empty={dashboard.outstandingCustomers.length === 0} emptyState={<EmptyState title="No outstanding accounts" description="All patient accounts are settled." />} actions={<Link href="/udhar"><span className="cursor-pointer text-sm text-primary hover:underline">{t("dashboard.viewAll")}</span></Link>}>
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
  const description = type === "revenue" ? "Bills included in today's revenue." : type === "profit" ? "Product-level profit from saved bill items." : "Cash drawer and UPI collection split for today.";

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
                  <p className="mt-1 text-xs text-muted-foreground">Cash {fmt(row.cash)} - UPI {fmt(row.upi)} - Udhar {fmt(row.udhar)}</p>
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
