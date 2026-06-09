import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { ShoppingCart, AlertTriangle, TrendingUp, Wallet, CreditCard, Smartphone, CalendarCheck, Sparkles, HandCoins, ReceiptText, Truck } from "lucide-react";
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

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");
  const [localSnapshot, setLocalSnapshot] = useState<LocalDashboardSnapshot>(() => getLocalDashboardSnapshot());
  const [ownerReport, setOwnerReport] = useState<LocalReportSnapshot | null>(null);
  const [financialSnapshot, setFinancialSnapshot] = useState<FinancialAggregationSnapshot | null>(null);
  const [drilldown, setDrilldown] = useState<"revenue" | "profit" | "collection" | null>(null);
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

  const dashboard = useMemo(() => {
    const reportToday = ownerReport?.today;
    const reportPayments = ownerReport?.paymentBreakdown;
    const finance = financialSnapshot;

    // Dashboard cards must follow one clear rule set:
    // 1) Today's revenue = sum of today's non-cancelled, non-estimate bills.
    // 2) Today's profit = sum of today's saved bill/item profit.
    // 3) Total udhar = current pending udhar across customers/ledger.
    // 4) Cash collected/in hand = real money received today, including old udhar recovery,
    //    minus supplier purchase cash paid today. Credit/udhar is debt, not collection.
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
      revenue,
      grossProfit,
      grossMarginPct,
      billCount: finance?.totalBillsToday ?? reportToday?.bills ?? localSnapshot.billCount ?? billsToday.data?.total ?? 0,
      totalOutstanding,
      outstandingCustomers,
      cash: cashIn,
      upi: upiIn,
      credit: todayUdhar,
      cashCollected,
      upiCollected,
      supplierCashPaid,
      supplierUpiPaid,
      supplierDue,
      purchaseDue,
      source: useLocal ? "IndexedDB" : "backend refresh",
      hasBusinessData: Boolean(useLocal || revenue > 0 || totalOutstanding > 0 || billsToday.data?.total),
    };
  }, [financialSnapshot, ownerReport, localSnapshot, backendPnL, billsToday.data, udharSummary.data, paymentSummary.data]);

  const isLoading = !financialSnapshot && !ownerReport && !localSnapshot.hasCache && (pnl.isLoading || udharSummary.isLoading || paymentSummary.isLoading);
  const cashInDrawer = Math.max(0, dashboard.cashCollected - dashboard.supplierCashPaid);
  const lowStockCount = ownerReport?.lowStock.length ?? 0;
  const pendingSyncCount = ownerReport?.pendingSyncCount ?? 0;
  const hasUnsyncedOperations = Boolean(ownerReport?.hasUnsyncedOperations);
  const attentionCount = [
    dashboard.supplierDue > 0,
    lowStockCount > 0,
    hasUnsyncedOperations,
  ].filter(Boolean).length;

  const openDrilldown = (next: "revenue" | "profit" | "collection") => setDrilldown(next);

  const drilldownKeyHandler = (next: "revenue" | "profit" | "collection") => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDrilldown(next);
    }
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
      toast({
        title: "Could not load demo shop",
        description: "Please try again after local storage is available.",
        variant: "destructive",
      });
    } finally {
      setSeedingDemo(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Owner Dashboard"
        description={`${format(new Date(), "EEEE, d MMMM yyyy")} - ${user?.name ?? "Owner"} counter view`}
        eyebrow={(
          <div data-testid="text-dashboard-local-first" className="flex flex-wrap items-center gap-2">
            <SyncBadge status="local" label={`Local-first numbers (${dashboard.source})`} />
          </div>
        )}
      />

      <section className="premium-hero mb-5">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">Counter live</span>
              <span className="rounded-md bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                {dashboard.billCount} bills
              </span>
              {dashboard.purchaseDue > 0 ? (
                <span className="rounded-md bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  Supplier due {fmt(dashboard.purchaseDue)}
                </span>
              ) : null}
            </div>
            <h2 className="mt-4 max-w-2xl text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              Today, at a glance.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Sales, cash, udhar, and owner alerts for today&apos;s closing decisions.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className={`rounded-md px-2.5 py-1 ${attentionCount > 0 ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
                {attentionCount > 0 ? `${attentionCount} owner alert${attentionCount > 1 ? "s" : ""}` : "No urgent alerts"}
              </span>
              <span className="rounded-md bg-background/70 px-2.5 py-1 text-muted-foreground">Drawer {fmt(cashInDrawer)}</span>
            </div>
          </div>
          <div className="border-t bg-background/58 p-4 sm:p-5 lg:border-l lg:border-t-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Quick moves</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-foreground">Run the counter.</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Billing, payment, purchase, and close.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href="/billing">
                <span className="premium-action">
                  <ShoppingCart size={17} aria-hidden="true" />
                  Bill
                </span>
              </Link>
              <Link href="/udhar">
                <span className="premium-action">
                  <HandCoins size={17} aria-hidden="true" />
                  Payment
                </span>
              </Link>
              <Link href="/purchase-bills">
                <span className="premium-action">
                  <Truck size={17} aria-hidden="true" />
                  Purchase
                </span>
              </Link>
              <Link href="/daily-closing">
                <span className="premium-action">
                  <CalendarCheck size={17} aria-hidden="true" />
                  Close
                </span>
              </Link>
            </div>
            {!dashboard.hasBusinessData ? (
              <button
                type="button"
                onClick={() => void loadDemoShop()}
                disabled={seedingDemo}
                className="premium-action mt-3 w-full"
              >
                {seedingDemo ? "Loading demo..." : "Load demo shop"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <StatsGrid className="mb-6">
        <StatCard
          label={t("dashboard.todayRevenue")}
          value={fmt(dashboard.revenue)}
          description={`${dashboard.billCount} bills - details`}
          icon={<TrendingUp size={20} aria-hidden="true" />}
          loading={isLoading}
          tone="green"
          data-testid="metric-revenue"
          role="button"
          tabIndex={0}
          className="cursor-pointer"
          onClick={() => openDrilldown("revenue")}
          onKeyDown={drilldownKeyHandler("revenue")}
        />
        <StatCard
          label={t("dashboard.todayProfit")}
          value={fmt(dashboard.grossProfit)}
          description={`${Math.round(dashboard.grossMarginPct)}% margin`}
          icon={<Wallet size={20} aria-hidden="true" />}
          loading={isLoading}
          tone="blue"
          role="button"
          tabIndex={0}
          className="cursor-pointer"
          onClick={() => openDrilldown("profit")}
          onKeyDown={drilldownKeyHandler("profit")}
        />
        <Link href="/udhar?filter=outstanding">
          <StatCard
            label={t("dashboard.totalUdhar")}
            value={fmt(dashboard.totalOutstanding)}
            description={`${dashboard.outstandingCustomers.length} customers`}
            icon={<AlertTriangle size={20} aria-hidden="true" />}
            loading={isLoading}
            tone="amber"
            className="h-full cursor-pointer"
          />
        </Link>
        <StatCard
          label={t("dashboard.cashCollected")}
          value={fmt(dashboard.cashCollected)}
          description={`Drawer ${fmt(cashInDrawer)}`}
          icon={<CreditCard size={20} aria-hidden="true" />}
          loading={isLoading}
          tone="violet"
          role="button"
          tabIndex={0}
          className="cursor-pointer"
          onClick={() => openDrilldown("collection")}
          onKeyDown={drilldownKeyHandler("collection")}
        />
      </StatsGrid>

      <AttentionStrip
        supplierDue={dashboard.supplierDue}
        purchaseDue={dashboard.purchaseDue}
        lowStockCount={lowStockCount}
        pendingSyncCount={pendingSyncCount}
        hasUnsyncedOperations={hasUnsyncedOperations}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataTableCard
          title="Cash Collection"
          description="Closing-ready drawer, UPI, and supplier payout."
          loading={isLoading}
          actions={(
            <button type="button" onClick={() => openDrilldown("collection")} className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
              Breakdown
            </button>
          )}
        >
          <div className="space-y-2">
            <CollectionRow label="Cash collected" value={fmt(dashboard.cashCollected)} icon={<Wallet size={16} aria-hidden="true" />} />
            <CollectionRow label="UPI collected" value={fmt(dashboard.upiCollected)} icon={<Smartphone size={16} aria-hidden="true" />} />
            <CollectionRow label="Supplier paid out" value={fmt(dashboard.supplierCashPaid + dashboard.supplierUpiPaid)} icon={<Truck size={16} aria-hidden="true" />} muted />
            <div className="mt-3 rounded-lg bg-primary/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-muted-foreground">Expected cash in drawer</span>
                <span className="text-lg font-black text-foreground">{fmt(cashInDrawer)}</span>
              </div>
              {dashboard.purchaseDue > 0 ? <p className="mt-2 text-xs text-muted-foreground">Supplier due today: {fmt(dashboard.purchaseDue)}</p> : null}
            </div>
          </div>
        </DataTableCard>

        <DataTableCard
          title={t("dashboard.udharOutstanding")}
          loading={isLoading}
          empty={dashboard.outstandingCustomers.length === 0}
          emptyState={<EmptyState title={t("dashboard.noUdhar")} description="No customer has pending udhar right now." />}
          actions={(
            <Link href="/udhar">
              <span className="cursor-pointer text-sm text-primary hover:underline">{t("dashboard.viewAll")}</span>
            </Link>
          )}
        >
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

      <DashboardDrilldownDialog
        type={drilldown}
        snapshot={financialSnapshot}
        cashInDrawer={cashInDrawer}
        onOpenChange={(open) => {
          if (!open) setDrilldown(null);
        }}
      />
    </PageShell>
  );
}

function DashboardDrilldownDialog({
  type,
  snapshot,
  cashInDrawer,
  onOpenChange,
}: {
  type: "revenue" | "profit" | "collection" | null;
  snapshot: FinancialAggregationSnapshot | null;
  cashInDrawer: number;
  onOpenChange: (open: boolean) => void;
}) {
  const title =
    type === "revenue"
      ? "Revenue Breakdown"
      : type === "profit"
        ? "Profit Breakdown"
        : "Cash Collection";
  const description =
    type === "revenue"
      ? "Bills included in today's revenue."
      : type === "profit"
        ? "Product-level profit from saved bill items."
        : "Cash drawer and UPI collection split for today.";

  return (
    <Dialog open={type !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {!snapshot ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Financial snapshot is still loading.
          </div>
        ) : type === "revenue" ? (
          <div className="space-y-2">
            {snapshot.revenueBreakdown.length === 0 ? (
              <EmptyState title="No revenue today" description="No saved sale bills are included yet." />
            ) : (
              snapshot.revenueBreakdown.slice(0, 30).map((row) => (
                <div key={row.billId} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{row.billNo} - {row.customerName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cash {fmt(row.cash)} - UPI {fmt(row.upi)} - Udhar {fmt(row.udhar)}
                    </p>
                  </div>
                  <MoneyBadge amount={row.amount} tone="success" compact />
                </div>
              ))
            )}
          </div>
        ) : type === "profit" ? (
          <div className="space-y-2">
            {snapshot.profitByProduct.length === 0 ? (
              <EmptyState title="No product profit yet" description="Saved bill items with cost are needed for product profit." />
            ) : (
              snapshot.profitByProduct.slice(0, 30).map((row) => (
                <div key={row.productId} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{row.productName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Qty {row.quantity.toLocaleString("en-IN")} - Revenue {fmt(row.revenue)} - Cost {fmt(row.cost)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-700">{fmt(row.profit)}</p>
                      <p className="text-xs text-muted-foreground">{row.marginPct}% margin</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <CollectionTile label="Cash sales" value={fmt(snapshot.cashSalesToday)} icon={<Wallet size={16} aria-hidden="true" />} />
            <CollectionTile label="Old udhar cash" value={fmt(snapshot.cashUdharRecoveryToday)} icon={<HandCoins size={16} aria-hidden="true" />} />
            <CollectionTile label="UPI sales" value={fmt(snapshot.upiSalesToday)} icon={<Smartphone size={16} aria-hidden="true" />} />
            <CollectionTile label="Old udhar UPI" value={fmt(snapshot.upiUdharRecoveryToday)} icon={<CreditCard size={16} aria-hidden="true" />} />
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

function AttentionStrip({
  supplierDue,
  purchaseDue,
  lowStockCount,
  pendingSyncCount,
  hasUnsyncedOperations,
}: {
  supplierDue: number;
  purchaseDue: number;
  lowStockCount: number;
  pendingSyncCount: number;
  hasUnsyncedOperations: boolean;
}) {
  return (
    <section className="premium-panel-muted mb-5 p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <Link href="/purchase-bills">
          <CompactSignal
            label="Supplier"
            value={supplierDue > 0 ? fmt(supplierDue) : "Clear"}
            detail={purchaseDue > 0 ? `Today due ${fmt(purchaseDue)}` : "No urgent due"}
            icon={<Truck size={18} aria-hidden="true" />}
            tone={supplierDue > 0 ? "danger" : "good"}
          />
        </Link>
        <Link href="/inventory">
          <CompactSignal
            label="Stock"
            value={lowStockCount > 0 ? `${lowStockCount} low` : "Healthy"}
            detail={lowStockCount > 0 ? "Purchase attention" : "No urgent items"}
            icon={<ReceiptText size={18} aria-hidden="true" />}
            tone={lowStockCount > 0 ? "warn" : "good"}
          />
        </Link>
        <Link href="/sync-status">
          <CompactSignal
            label="Backup"
            value={pendingSyncCount > 0 ? `${pendingSyncCount} pending` : "Synced"}
            detail={hasUnsyncedOperations ? "Review before close" : "All clear"}
            icon={<Sparkles size={18} aria-hidden="true" />}
            tone={hasUnsyncedOperations ? "warn" : "good"}
          />
        </Link>
        <Link href="/reports">
          <CompactSignal
            label="Reports"
            value="Owner view"
            detail="Weekly and monthly"
            icon={<TrendingUp size={18} aria-hidden="true" />}
            tone="neutral"
          />
        </Link>
      </div>
    </section>
  );
}

function CompactSignal({ label, value, detail, icon, tone = "neutral" }: { label: string; value: string; detail: string; icon: ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }) {
  const toneClass = {
    neutral: "bg-muted text-muted-foreground",
    good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    danger: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  }[tone];

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
        <span className={`${muted ? "text-muted-foreground" : "text-primary"}`}>{icon}</span>
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
