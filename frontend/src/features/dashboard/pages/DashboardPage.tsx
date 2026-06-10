import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  ShoppingCart, AlertTriangle, TrendingUp, Wallet, CreditCard, Smartphone,
  CalendarCheck, Sparkles, HandCoins, ReceiptText, Truck, PackagePlus,
  Layers, BarChart3, Building2, ChefHat, Wrench, Pill, ClipboardList,
  Package,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { getLocalDashboardSnapshot, useGetPaymentSummary, useGetPnL, useGetUdharSummary, useListBills, warmRecentLocalCache, type LocalDashboardSnapshot } from "@/lib/api/client";
import { buildLocalReportSnapshot, type LocalReportSnapshot } from "@/features/reports/local-reporting";
import { FinancialAggregationService, type FinancialAggregationSnapshot } from "@/features/finance/services/FinancialAggregationService";
import { seedDemoShopData } from "@/features/demo/demo-shop-data";
import { useAppLanguage } from "@/features/settings/i18n";
import { useFeature } from "@/features/subscription";
import { useToast } from "@/hooks/use-toast";
import { DataTableCard, EmptyState, MoneyBadge, PageHeader, PageShell, StatCard, StatsGrid, SyncBadge } from "@/components/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBusinessType, type BusinessTypeDefinition, type QuickActionIconKey, type QuickActionColorKey } from "@/features/settings/business-types";

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
  const [localSnapshot, setLocalSnapshot] = useState<LocalDashboardSnapshot>(() => getLocalDashboardSnapshot());
  const [ownerReport, setOwnerReport] = useState<LocalReportSnapshot | null>(null);
  const [financialSnapshot, setFinancialSnapshot] = useState<FinancialAggregationSnapshot | null>(null);
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
      void FinancialAggregationService.buildSnapshot(today).then(setFinancialSnapshot).catch(() => undefined);
    };
    refreshReport();
    window.addEventListener("kirana:sync-queue-updated", refreshReport);
    window.addEventListener("kirana:local-data-changed", refreshReport);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refreshLocal);
      window.removeEventListener("kirana:local-data-changed", refreshReport);
      window.removeEventListener("kirana:sync-queue-updated", refreshReport);
    };
  }, [today]);

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
    const credit = reportToday?.udharSales ?? localSnapshot.credit ?? paymentSummary.data?.credit;
    const todayUdhar = roundMoney(money(credit));
    const cashIn = roundMoney(money(cash));
    const upiIn = roundMoney(money(upi));
    const supplierCashPaid = roundMoney(money(finance?.supplierCashPaidToday ?? reportPayments?.purchaseCashPaid));
    const supplierUpiPaid = roundMoney(money(finance?.supplierUpiPaidToday ?? reportPayments?.purchaseUpiPaid));
    const purchaseDue = roundMoney(money(finance?.purchaseDueToday ?? reportPayments?.purchaseDue));
    const supplierDue = roundMoney(money(finance?.supplierDue ?? reportPayments?.purchaseDue));
    const cashCollected = roundMoney(money(finance?.totalCashCollectedToday ?? reportPayments?.netCashInHand ?? Math.max(0, cashIn - supplierCashPaid)));
    const upiCollected = roundMoney(money(finance?.totalUpiCollectedToday ?? upiIn - supplierUpiPaid));
    const grossMarginPct = revenue > 0
      ? Math.round((grossProfit / revenue) * 100)
      : roundMoney(money(localSnapshot.grossMarginPct ?? backendPnL?.grossMarginPct));
    const totalOutstanding = roundMoney(money(finance?.totalOutstandingUdhar ?? ownerReport?.pendingUdhar ?? localSnapshot.totalOutstanding ?? udharSummary.data?.totalOutstanding));
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
      source: useLocal ? "IndexedDB" : "backend refresh",
      hasBusinessData: Boolean(useLocal || revenue > 0 || totalOutstanding > 0 || billsToday.data?.total),
    };
  }, [financialSnapshot, ownerReport, localSnapshot, backendPnL, billsToday.data, udharSummary.data, paymentSummary.data]);

  const isLoading = !financialSnapshot && !ownerReport && !localSnapshot.hasCache && (pnl.isLoading || udharSummary.isLoading || paymentSummary.isLoading);
  const cashInDrawer = Math.max(0, dashboard.cashCollected - dashboard.supplierCashPaid);
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

function GeneralLayout({ btDef, dashboard, ownerReport, isLoading, cashInDrawer, lowStockCount, pendingSyncCount, hasUnsyncedOperations, seedingDemo, userName, onLoadDemo, openDrilldown, drilldownKeyHandler }: LayoutProps) {
  const { t } = useAppLanguage();
  const dbCfg = btDef.dashboard;
  const attentionCount = [dashboard.supplierDue > 0, lowStockCount > 0, hasUnsyncedOperations].filter(Boolean).length;

  return (
    <PageShell>
      <PageHeader
        title="Owner Dashboard"
        description={`${format(new Date(), "EEEE, d MMMM yyyy")} — ${userName} counter view`}
        eyebrow={(
          <div data-testid="text-dashboard-local-first" className="flex flex-wrap items-center gap-2">
            <SyncBadge status="local" label={`Local-first numbers (${dashboard.source})`} />
          </div>
        )}
      />

      <section className="premium-hero mb-6">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary ring-1 ring-primary/20">● Counter live</span>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900">
                {dashboard.billCount} bills today
              </span>
              {dashboard.purchaseDue > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                  Supplier due {fmt(dashboard.purchaseDue)}
                </span>
              )}
            </div>
            <h2 className="mt-5 max-w-2xl font-display text-3xl font-black tracking-tight text-foreground sm:text-4xl">{dbCfg.heroTitle}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{dbCfg.heroSubtitle}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ring-1 ${attentionCount > 0 ? "bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900" : "bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900"}`}>
                {attentionCount > 0 ? `${attentionCount} owner alert${attentionCount > 1 ? "s" : ""}` : "✓ No urgent alerts"}
              </span>
              <span className="rounded-full bg-muted/60 px-3 py-1.5 font-medium text-muted-foreground ring-1 ring-black/[0.06]">
                Drawer {fmt(cashInDrawer)}
              </span>
            </div>
          </div>
          <div className="border-t bg-background/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
            <p className="app-muted-label">Quick actions</p>
            <p className="mt-3 font-display text-xl font-black tracking-tight text-foreground">{btDef.label}</p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {dbCfg.quickActions.map((action) => (
                <Link key={action.href + action.label} href={action.href}>
                  <div className="flex flex-col items-center gap-2.5 rounded-xl border bg-card p-4 text-center shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
                    <div className={`grid h-11 w-11 place-items-center rounded-xl ${ACTION_ICON_BG[action.color]}`}>{ACTION_ICON[action.icon]}</div>
                    <span className="text-sm font-bold">{action.label}</span>
                  </div>
                </Link>
              ))}
            </div>
            {!dashboard.hasBusinessData && (
              <button type="button" onClick={onLoadDemo} disabled={seedingDemo} className="premium-action mt-3 w-full">
                <Sparkles size={16} aria-hidden="true" />
                {seedingDemo ? "Loading demo..." : "Load demo shop"}
              </button>
            )}
          </div>
        </div>
      </section>

      <StatsGrid className="mb-6">
        <StatCard label={dbCfg.kpi.revenue} value={fmt(dashboard.revenue)} description={`${dashboard.billCount} bills · tap for details`} icon={<TrendingUp size={20} aria-hidden="true" />} loading={isLoading} tone="green" data-testid="metric-revenue" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("revenue")} onKeyDown={drilldownKeyHandler("revenue")} />
        <StatCard label={dbCfg.kpi.profit} value={fmt(dashboard.grossProfit)} description={`${Math.round(dashboard.grossMarginPct)}% margin`} icon={<Wallet size={20} aria-hidden="true" />} loading={isLoading} tone="blue" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("profit")} onKeyDown={drilldownKeyHandler("profit")} />
        <Link href="/udhar?filter=outstanding">
          <StatCard label={dbCfg.kpi.credit} value={fmt(dashboard.totalOutstanding)} description={`${dashboard.outstandingCustomers.length} ${dbCfg.creditLabel.toLowerCase()} accounts`} icon={<AlertTriangle size={20} aria-hidden="true" />} loading={isLoading} tone="amber" className="h-full cursor-pointer" />
        </Link>
        <StatCard label={dbCfg.kpi.cash} value={fmt(dashboard.cashCollected)} description={`Drawer ${fmt(cashInDrawer)}`} icon={<CreditCard size={20} aria-hidden="true" />} loading={isLoading} tone="violet" role="button" tabIndex={0} className="cursor-pointer" onClick={() => openDrilldown("collection")} onKeyDown={drilldownKeyHandler("collection")} />
      </StatsGrid>

      <AttentionStrip supplierDue={dashboard.supplierDue} purchaseDue={dashboard.purchaseDue} lowStockCount={lowStockCount} pendingSyncCount={pendingSyncCount} hasUnsyncedOperations={hasUnsyncedOperations} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTableCard title="Cash Collection" description="Closing-ready drawer, UPI, and supplier payout." loading={isLoading} actions={(
          <button type="button" onClick={() => openDrilldown("collection")} className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">Breakdown</button>
        )}>
          <div className="space-y-2">
            <CollectionRow label="Cash collected" value={fmt(dashboard.cashCollected)} icon={<Wallet size={16} aria-hidden="true" />} />
            <CollectionRow label="UPI collected" value={fmt(dashboard.upiCollected)} icon={<Smartphone size={16} aria-hidden="true" />} />
            <CollectionRow label="Supplier paid out" value={fmt(dashboard.supplierCashPaid + dashboard.supplierUpiPaid)} icon={<Truck size={16} aria-hidden="true" />} muted />
            <div className="mt-3 rounded-lg bg-primary/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-muted-foreground">Expected cash in drawer</span>
                <span className="text-lg font-black text-foreground">{fmt(cashInDrawer)}</span>
              </div>
              {dashboard.purchaseDue > 0 && <p className="mt-2 text-xs text-muted-foreground">Supplier due today: {fmt(dashboard.purchaseDue)}</p>}
            </div>
          </div>
        </DataTableCard>

        <DataTableCard title={`${dbCfg.creditLabel} Outstanding`} loading={isLoading} empty={dashboard.outstandingCustomers.length === 0} emptyState={<EmptyState title={`No ${dbCfg.creditLabel.toLowerCase()} outstanding`} description={`No customer has pending ${dbCfg.creditLabel.toLowerCase()} right now.`} />} actions={(
          <Link href="/udhar"><span className="cursor-pointer text-sm text-primary hover:underline">{t("dashboard.viewAll")}</span></Link>
        )}>
          <div className="space-y-2">
            {dashboard.outstandingCustomers.slice(0, 5).map((c) => (
              <div key={c.customerId} data-testid={`row-udhar-${c.customerId}`} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
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
