import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Box,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Download,
  Filter,
  Info,
  Landmark,
  PackagePlus,
  ReceiptIndianRupee,
  RefreshCw,
  ShoppingBag,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { PageShell, SyncBadge } from "@/components/shared";
import { getExpenseSummary, listExpenses } from "@/features/core/expenses/api";
import {
  buildLocalReportSnapshot,
  toDateInputValue,
  type LocalReportSnapshot,
} from "@/features/core/reports/local-reporting";
import { recordDataExportLocalFirst } from "@/features/core/reports/local-actions";
import { AccountingControlPanel } from "@/features/core/reports/components/AccountingControlPanel";
import { BankReconciliationPanel } from "@/features/core/reports/components/BankReconciliationPanel";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Expense, ExpenseSummary } from "@/types/api";
import { ACTIVITY_EVENTS, trackEvent, useReportView } from "@/lib/activity";

const PANEL = "min-w-0 overflow-hidden rounded-[16px] border border-[#e2e9f3] bg-white shadow-[0_10px_30px_rgba(31,60,110,0.055)]";
const GRID_STROKE = "#e7edf5";
const AXIS_COLOR = "#6f7f9b";

function usePhoneReportLayout() {
  const query = "(max-width: 767px)";
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setIsPhone(media.matches);
    media.addEventListener("change", sync);
    sync();
    return () => media.removeEventListener("change", sync);
  }, []);

  return isPhone;
}

function fmt(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function fmtAxis(value: number) {
  if (Math.abs(value) >= 100_000) return `₹${Math.round(value / 100_000)}L`;
  if (Math.abs(value) >= 1_000) return `₹${Math.round(value / 1_000)}K`;
  return `₹${Math.round(value)}`;
}

function todayInput() {
  return toDateInputValue(new Date());
}

function hourLabel(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  const twelveHour = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${twelveHour}${normalized < 12 ? "am" : "pm"}`;
}

function daysAgoInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateInputValue(date);
}

function safeDateRange(from: string, to: string) {
  if (!from || !to) return { from: todayInput(), to: todayInput() };
  return from <= to ? { from, to } : { from: to, to: from };
}

function previousRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousTo = new Date(start);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - days + 1);
  return { from: toDateInputValue(previousFrom), to: toDateInputValue(previousTo) };
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function rangeLabel(from: string, to: string) {
  return from === to ? dateLabel(from) : `${dateLabel(from)} - ${dateLabel(to)}`;
}

type ReportPeriod = "today" | "week" | "month" | "custom";

const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  custom: "Custom",
};

function reportPeriodRange(period: Exclude<ReportPeriod, "custom">) {
  const today = new Date();
  if (period === "today") {
    const value = toDateInputValue(today);
    return { from: value, to: value };
  }
  if (period === "month") {
    return {
      from: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: toDateInputValue(today),
    };
  }
  return { from: daysAgoInput(6), to: toDateInputValue(today) };
}

function delta(current: number, previous: number) {
  if (Math.abs(previous) < 0.005) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1_000) / 10;
}

function shortText(value: string, max = 18) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

type ExpenseDateParams = { from?: string; to?: string };

function emptyExpenseSummary(): ExpenseSummary {
  return { total: 0, count: 0, byCategory: {}, byMode: {}, pendingTotal: 0, pendingCount: 0 };
}

async function getExpenseSummaryOrEmpty(params: ExpenseDateParams): Promise<ExpenseSummary> {
  try {
    return await getExpenseSummary(params);
  } catch {
    return emptyExpenseSummary();
  }
}

async function listExpensesOrEmpty(params: ExpenseDateParams): Promise<Expense[]> {
  try {
    return await listExpenses(params);
  } catch {
    return [];
  }
}

export default function ReportsPage() {
  useReportView("overview", "Business overview");
  const { toast } = useToast();
  const isPhoneLayout = usePhoneReportLayout();
  const [from, setFrom] = useState(daysAgoInput(6));
  const [to, setTo] = useState(todayInput());
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [snapshot, setSnapshot] = useState<LocalReportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const snapshotRef = useRef<LocalReportSnapshot | null>(null);
  const loadRequestId = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const [exportPinOpen, setExportPinOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  const range = useMemo(() => safeDateRange(from, to), [from, to]);
  const priorRange = useMemo(() => previousRange(range.from, range.to), [range.from, range.to]);
  const expenseParams = useMemo(() => ({
    from: range.from,
    to: range.to,
  }), [range.from, range.to]);

  const expenseSummary = useQuery({
    queryKey: ["reports-expense-summary", range],
    queryFn: () => getExpenseSummaryOrEmpty(expenseParams),
    retry: false,
  });
  const previousExpenseSummary = useQuery({
    queryKey: ["reports-expense-summary", priorRange],
    queryFn: () => getExpenseSummaryOrEmpty({ from: priorRange.from, to: priorRange.to }),
    retry: false,
  });
  const expenses = useQuery({
    queryKey: ["reports-expenses", range],
    queryFn: () => listExpensesOrEmpty(expenseParams),
    retry: false,
  });

  const applyPeriod = (nextPeriod: Exclude<ReportPeriod, "custom">) => {
    const nextRange = reportPeriodRange(nextPeriod);
    setPeriod(nextPeriod);
    setFrom(nextRange.from);
    setTo(nextRange.to);
  };

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const loadReports = useCallback(async (options?: { showLoader?: boolean }) => {
    const requestId = ++loadRequestId.current;
    const showLoader = options?.showLoader ?? !snapshotRef.current;
    if (showLoader) setLoading(true);
    try {
      const nextSnapshot = await buildLocalReportSnapshot({ from: range.from, to: range.to });
      if (requestId === loadRequestId.current) {
        setSnapshot(nextSnapshot);
      }
    } finally {
      if (requestId === loadRequestId.current && showLoader) {
        setLoading(false);
      }
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void loadReports({ showLoader: !snapshotRef.current });
  }, [loadReports]);

  useEffect(() => {
    const refresh = () => {
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }
      refreshTimer.current = window.setTimeout(() => {
        void loadReports({ showLoader: false });
      }, 150);
    };
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [loadReports]);

  const selected = snapshot?.selected;
  const previous = snapshot?.previousSelected;
  const expenseTotal = expenseSummary.data?.total;
  const previousExpenseTotal = previousExpenseSummary.data?.total ?? 0;
  const netProfit = expenseTotal == null ? undefined : (selected?.profitEstimate ?? 0) - expenseTotal;
  const previousNetProfit = (previous?.profitEstimate ?? 0) - previousExpenseTotal;

  // Tender split of the period's SALES, so the slices reconcile to Total Sales.
  // Deliberately not cashIn/upiIn/bankIn: those add recovery of *older* udhar, which
  // double-counts against the udhar slice and made this donut exceed total sales.
  const paymentModes = useMemo(() => {
    const payment = snapshot?.paymentBreakdown;
    if (!payment) return [];
    return [
      { name: "Cash", value: payment.cash, color: "#20b75a" },
      { name: "UPI", value: payment.upi, color: "var(--brand)" },
      { name: "Bank", value: payment.bank, color: "#0ea5e9" },
      { name: "Udhar", value: payment.udhar, color: "#f5a30a" },
    ].filter((item) => item.value > 0);
  }, [snapshot]);

  const paymentTotal = paymentModes.reduce((sum, item) => sum + item.value, 0);
  const expenseByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const expense of expenses.data ?? []) {
      if (expense.deletedAt) continue;
      const date = expense.spentAt?.slice(0, 10);
      if (date) map.set(date, (map.get(date) ?? 0) + Number(expense.amount || 0));
    }
    return map;
  }, [expenses.data]);

  const dailyRows = useMemo(() => (snapshot?.dailyTrend ?? []).slice(-7).reverse().map((point) => {
    const dayExpense = expenseByDay.get(point.date) ?? 0;
    return { ...point, expense: dayExpense, net: point.profit - dayExpense };
  }), [snapshot?.dailyTrend, expenseByDay]);

  const insights = useMemo(() => {
    if (!snapshot || !selected) return [];
    const salesDelta = delta(selected.sales, previous?.sales ?? 0);
    const topCategory = snapshot.categoryPerformance[0];
    return [
      {
        tone: "green" as const,
        title: `Sales ${salesDelta >= 0 ? "increased" : "decreased"} by ${Math.abs(salesDelta)}% compared to the previous period.`,
        detail: `${paymentModes[0]?.name ?? "Cash"} currently leads the payment mode mix.`,
      },
      topCategory ? {
        tone: "amber" as const,
        title: `${topCategory.name} contributes ${selected.sales ? Math.round((topCategory.revenue / selected.sales) * 100) : 0}% of total sales.`,
        detail: "Review product margins and stock depth in this category.",
      } : null,
      {
        tone: "red" as const,
        title: `${snapshot.topCustomers.filter((customer) => customer.balance > 0).length} customers have outstanding dues.`,
        detail: "Follow up from Customers / Udhar to improve cash flow.",
      },
    ].filter(Boolean) as Array<{ tone: "green" | "amber" | "red"; title: string; detail: string }>;
  }, [snapshot, selected, previous?.sales, paymentModes]);

  async function confirmExport(ownerPin: string, reason: string) {
    if (!snapshot) return;
    setExporting(true);
    setExportError(null);
    try {
      await recordDataExportLocalFirst({
        ownerPin,
        reason,
        reportType: "local_reports_snapshot",
        from: range.from,
        to: range.to,
        format: "json",
        rowCount: snapshot.topProducts.length + snapshot.topCustomers.length + snapshot.lowStock.length + snapshot.staffSales.length,
      });
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), range, snapshot }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kirana-report-${range.from}-to-${range.to}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportPinOpen(false);
      trackEvent(ACTIVITY_EVENTS.REPORT_EXPORT, { report: "overview", reportLabel: "Business overview", format: "json" });
      toast({ title: "Report exported", description: "Owner approval was recorded in the audit log." });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Owner approval is required.");
    } finally {
      setExporting(false);
    }
  }

  const trend = snapshot?.dailyTrend ?? [];
  const hourlyChart = useMemo(
    () => (snapshot?.hourlySales ?? []).map((row) => ({ ...row, label: hourLabel(row.hour) })),
    [snapshot?.hourlySales],
  );
  const peakHour = useMemo(() => {
    const withSales = (snapshot?.hourlySales ?? []).filter((row) => row.sales > 0);
    return withSales.length ? withSales.reduce((best, row) => (row.sales > best.sales ? row : best)) : null;
  }, [snapshot?.hourlySales]);
  const quietHour = useMemo(() => {
    const withSales = (snapshot?.hourlySales ?? []).filter((row) => row.sales > 0);
    if (withSales.length < 2) return null;
    return withSales.reduce((worst, row) => (row.sales < worst.sales ? row : worst));
  }, [snapshot?.hourlySales]);
  const kpis = [
    {
      label: "Total Sales",
      value: selected?.sales ?? 0,
      previous: previous?.sales ?? 0,
      icon: <ShoppingBag size={16} />,
      color: "var(--brand)",
      iconClass: "bg-[var(--brand-soft)] text-[var(--brand)]",
      spark: trend.map((point) => point.sales),
    },
    {
      label: "Cash Collection",
      value: snapshot?.paymentBreakdown.cashIn ?? 0,
      previous: previous?.cashSales ?? 0,
      icon: <Banknote size={16} />,
      color: "#16ad52",
      iconClass: "bg-[#eaf9ef] text-[#16ad52]",
      spark: trend.map((point) => point.cash),
    },
    {
      label: "UPI Collection",
      value: snapshot?.paymentBreakdown.upiIn ?? 0,
      previous: previous?.upiSales ?? 0,
      icon: <WalletCards size={16} />,
      color: "#7c3df0",
      iconClass: "bg-[#f3edff] text-[#7c3df0]",
      spark: trend.map((point) => point.upi),
    },
    {
      label: "Bank Collection",
      value: snapshot?.paymentBreakdown.bankIn ?? 0,
      previous: previous?.bankSales ?? 0,
      icon: <Landmark size={16} />,
      color: "#0ea5e9",
      iconClass: "bg-[#e6f7ff] text-[#0ea5e9]",
      spark: trend.map((point) => point.bank),
    },
    {
      label: "Profit (Est.)",
      value: selected?.profitEstimate ?? 0,
      previous: previous?.profitEstimate ?? 0,
      icon: <CircleDollarSign size={16} />,
      color: "#16ad52",
      iconClass: "bg-[#eaf9ef] text-[#16ad52]",
      spark: trend.map((point) => point.profit),
    },
    {
      label: "Outstanding Udhar",
      value: snapshot?.pendingUdhar ?? 0,
      previous: previous?.udharSales ?? 0,
      icon: <ReceiptIndianRupee size={16} />,
      color: "#ff334d",
      iconClass: "bg-[#ffedef] text-[#ff334d]",
      spark: trend.map((point) => point.udhar),
      positiveIsBad: true,
    },
    {
      label: "Expense Total",
      value: expenseTotal,
      previous: previousExpenseTotal,
      icon: <Box size={16} />,
      color: "#ff8a00",
      iconClass: "bg-[#fff3e8] text-[#ff8a00]",
      spark: trend.map((point) => expenseByDay.get(point.date) ?? 0),
      positiveIsBad: true,
    },
    {
      label: "Net Profit",
      value: netProfit,
      previous: previousNetProfit,
      icon: <BarChart3 size={16} />,
      color: "var(--brand)",
      iconClass: "bg-[var(--brand-soft)] text-[var(--brand)]",
      spark: trend.map((point) => point.profit - (expenseByDay.get(point.date) ?? 0)),
    },
  ];

  return (
    <PageShell className="reports-page mx-auto min-h-full w-full max-w-[1800px] space-y-4 pb-10 text-[var(--brand-ink)] lg:space-y-5">
      <section className="rounded-[18px] border border-[#dfe7f2] bg-white p-4 shadow-[0_10px_32px_rgba(31,60,110,0.055)] lg:flex lg:items-center lg:justify-between lg:gap-6 lg:p-5">
        <div className="min-w-0">
          <div className="hidden items-center gap-3 lg:flex">
            <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[var(--brand-soft)] text-[var(--brand)]"><BarChart3 size={19} /></span>
            <div><h2 className="text-[17px] font-black tracking-tight text-[var(--brand-ink)]">Business overview</h2><p className="mt-0.5 text-[11px] font-medium text-[#718099]">Sales, collections, profit and stock performance in one clear view</p></div>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-[#6c7c98] lg:mt-3">
            {snapshot?.hasUnsyncedOperations ? (
              <SyncBadge status="estimate" label={`${snapshot.pendingSyncCount + snapshot.failedSyncCount} changes awaiting sync`} />
            ) : (
              <SyncBadge status="synced" label="Synced · Local reports ready" />
            )}
          </div>
        </div>
        <div className="mt-3 grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center lg:mt-0 lg:justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="col-span-3 h-11 min-w-0 justify-between rounded-xl border-[#dfe7f2] bg-white px-3 text-[12px] font-bold text-[#24385f] sm:col-auto sm:h-9 sm:min-w-[220px] sm:rounded-[7px] sm:font-semibold">
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-[var(--brand)]" />{rangeLabel(range.from, range.to)}</span>
                <span className="text-[#7e8ba3]">⌄</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[calc(100vw-2rem)] rounded-xl border-[#dfe7f2] p-3 sm:w-[320px] sm:rounded-[8px]">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">From</Label><Input type="date" value={from} onChange={(event) => { setPeriod("custom"); setFrom(event.target.value); }} className="mt-1 h-11 rounded-lg sm:h-9 sm:rounded-[6px]" /></div>
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">To</Label><Input type="date" value={to} onChange={(event) => { setPeriod("custom"); setTo(event.target.value); }} className="mt-1 h-11 rounded-lg sm:h-9 sm:rounded-[6px]" /></div>
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild><Button variant="outline" className="h-11 w-full rounded-xl border-[#dfe7f2] px-4 text-[12px] font-bold sm:h-9 sm:w-auto sm:rounded-[7px] sm:font-semibold"><Filter size={14} className="mr-2" />Filters</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-48 rounded-[8px] p-2">
              {(["today", "week", "month"] as const).map((item) => (
                <button key={item} className={cn("min-h-11 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-[#f2f6fc] sm:min-h-0 sm:rounded-[6px]", period === item && "bg-[var(--brand-soft)] text-[var(--brand)]")} onClick={() => applyPeriod(item)}>{REPORT_PERIOD_LABELS[item]}</button>
              ))}
              <Link href="/daily-closing" className="mt-1 flex min-h-11 items-center border-t border-[#edf1f6] px-3 py-2 text-xs font-semibold text-[var(--brand)] sm:min-h-0">Open daily closing</Link>
            </PopoverContent>
          </Popover>
          <Button onClick={() => { setExportError(null); setExportPinOpen(true); }} disabled={!snapshot || loading} className="h-11 w-full rounded-xl bg-[var(--brand)] px-4 text-[12px] font-bold shadow-[0_8px_20px_rgba(7,95,255,0.22)] hover:bg-[var(--brand-strong)] sm:h-9 sm:w-auto sm:rounded-[7px]"><Download size={14} className="mr-2" />Export</Button>
          <Button variant="outline" size="icon" title="Refresh reports" aria-label="Refresh reports" onClick={() => void loadReports({ showLoader: !snapshotRef.current })} disabled={loading && !snapshot} className="h-11 w-11 rounded-xl border-[#dfe7f2] sm:h-9 sm:w-9 sm:rounded-[7px]"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></Button>
        </div>
      </section>

      {isPhoneLayout ? (
        <MobileReportsOverview
          loading={loading || expenseSummary.isLoading}
          periodLabel={rangeLabel(range.from, range.to)}
          sales={selected?.sales ?? 0}
          previousSales={previous?.sales ?? 0}
          cash={snapshot?.paymentBreakdown.cashIn ?? 0}
          upi={snapshot?.paymentBreakdown.upiIn ?? 0}
          bank={snapshot?.paymentBreakdown.bankIn ?? 0}
          profit={selected?.profitEstimate ?? 0}
          netProfit={netProfit ?? 0}
          expenses={expenseTotal ?? 0}
          udhar={snapshot?.pendingUdhar ?? 0}
        />
      ) : null}

      {!isPhoneLayout ? (
        <section className="hidden min-w-0 grid-cols-2 gap-2 md:grid lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} loading={loading || (kpi.label.includes("Expense") && expenseSummary.isLoading)} />
          ))}
        </section>
      ) : null}

      <section className="grid items-stretch gap-4 xl:grid-cols-3 2xl:grid-cols-[1.05fr_1.05fr_1.12fr]">
        <Panel title="Sales Trend" info action={<PeriodPill value={period} onChange={applyPeriod} />}>
          <div className="flex items-baseline gap-4 px-3.5 pt-1 text-[11px]">
            <span className="text-[#60708e]">Total Sales</span>
            <strong className="text-[16px] text-[var(--brand-ink)]">{fmt(selected?.sales)}</strong>
            <TrendLabel current={selected?.sales ?? 0} previous={previous?.sales ?? 0} />
          </div>
          <ChartFrame loading={loading} empty={trend.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 14, right: 10, left: -12, bottom: 0 }}>
                <defs><linearGradient id="salesArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.2} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0.01} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<MoneyTooltip />} />
                <Area type="monotone" dataKey="sales" name="Sales" stroke="var(--brand)" strokeWidth={2.2} fill="url(#salesArea)" dot={{ r: 2.7, fill: "white", stroke: "var(--brand)", strokeWidth: 1.7 }} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>

        <Panel title="Category Performance" info action={<PeriodPill value={period} onChange={applyPeriod} />}>
          <ChartFrame loading={loading} empty={!snapshot?.categoryPerformance.length}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snapshot?.categoryPerformance ?? []} margin={{ top: 20, right: 8, left: -10, bottom: 2 }} barCategoryGap="28%">
                <defs><linearGradient id="categoryBars" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" /><stop offset="100%" stopColor="#8bb5ff" /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" />
                <XAxis dataKey="name" tickFormatter={(value) => shortText(String(value), 10)} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<MoneyTooltip />} />
                <Bar dataKey="revenue" name="Revenue" fill="url(#categoryBars)" radius={[3, 3, 0, 0]} maxBarSize={34}><LabelList dataKey="revenue" position="top" formatter={(value: unknown) => fmt(Number(value))} style={{ fontSize: 8, fontWeight: 700, fill: "#24385f" }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>

        <Panel title="Payment Mode Breakdown" info action={<PeriodPill value={period} onChange={applyPeriod} />}>
          {loading ? <Skeleton className="m-4 h-[178px]" /> : paymentModes.length === 0 ? <EmptyChart /> : (
            <div className="grid min-h-[218px] items-center gap-3 px-3 pb-2 sm:grid-cols-[minmax(170px,0.9fr)_minmax(0,1.1fr)]">
              <div className="relative mx-auto h-[176px] w-[176px]">
                <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={paymentModes} dataKey="value" nameKey="name" innerRadius={56} outerRadius={84} paddingAngle={1} stroke="#fff" strokeWidth={2}>{paymentModes.map((mode) => <Cell key={mode.name} fill={mode.color} />)}</Pie><Tooltip content={<MoneyTooltip />} /></PieChart></ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="block text-[15px] text-[#13244a]">{fmt(paymentTotal)}</strong><span className="text-[10px] text-[#7886a0]">Total Sales</span></div></div>
              </div>
              <div className="space-y-3 pr-2">
                {paymentModes.map((mode) => <div key={mode.name} className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ background: mode.color }} /><span className="font-semibold text-[#2c3f64]">{mode.name}</span><span className="font-bold text-[#15264b]">{fmt(mode.value)} <em className="font-normal not-italic text-[#75839d]">({paymentTotal ? ((mode.value / paymentTotal) * 100).toFixed(1) : 0}%)</em></span></div>)}
              </div>
            </div>
          )}
        </Panel>
      </section>

      <section className="space-y-3 md:hidden">
        <MobileReportList title="Top Products" actionHref="/products">
          {(snapshot?.topProducts ?? []).slice(0, 5).map((row) => (
            <MobileReportRow
              key={row.productId}
              title={row.name}
              subtitle={row.category}
              value={fmt(row.revenue)}
              meta={`${row.quantitySold.toLocaleString("en-IN")} qty • ${row.marginPct.toFixed(1)}% margin`}
            />
          ))}
        </MobileReportList>

        <MobileReportList title="Top Customers (Udhar)" actionHref="/customers">
          {(snapshot?.topCustomers ?? []).slice(0, 5).map((row) => (
            <MobileReportRow
              key={row.customerId}
              title={row.name}
              subtitle={row.lastPurchase ? `Last purchase ${dateLabel(row.lastPurchase.slice(0, 10))}` : "No recent purchase"}
              value={fmt(row.balance)}
              meta={<RiskChip balance={row.balance} />}
            />
          ))}
        </MobileReportList>

        <MobileReportList title="Discounts Given" actionHref="/bills">
          {(snapshot?.discounts.recent ?? []).slice(0, 5).map((row) => (
            <MobileReportRow
              key={row.billId}
              title={row.billNo}
              subtitle={row.reason ?? "No reason recorded"}
              value={fmt(row.amount)}
              meta={row.at ? dateLabel(row.at.slice(0, 10)) : "—"}
            />
          ))}
        </MobileReportList>

        <MobileReportList title="Sales by Staff" actionHref="/staff">
          {(snapshot?.staffSales ?? []).slice(0, 5).map((row) => (
            <MobileReportRow
              key={row.staffId}
              title={row.staffName}
              subtitle={`${row.bills} bill${row.bills === 1 ? "" : "s"} • avg ${fmt(row.bills > 0 ? row.sales / row.bills : 0)}`}
              value={fmt(row.sales)}
            />
          ))}
        </MobileReportList>

        <MobileReportList title="Daily Closing Summary" actionHref="/daily-closing">
          {dailyRows.slice(0, 5).map((row) => (
            <MobileReportRow
              key={row.date}
              title={new Date(`${row.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              subtitle={`Sales ${fmt(row.sales)} • Collection ${fmt(row.collection)}`}
              value={fmt(row.net)}
              meta={`Expense ${fmt(row.expense)}`}
            />
          ))}
        </MobileReportList>
      </section>

      <section className="hidden items-start gap-4 md:grid xl:grid-cols-3">
        <DenseTable title="Top Products" action="View all" actionHref="/products" headers={["Product", "Category", "Qty Sold", "Sales (₹)", "Margin (%)"]} loading={loading} empty={!snapshot?.topProducts.length}>
          {snapshot?.topProducts.slice(0, 5).map((row) => <tr key={row.productId}><Td strong>{row.name}</Td><Td>{row.category}</Td><Td right>{row.quantitySold}</Td><Td right strong>{fmt(row.revenue)}</Td><Td right>{row.marginPct.toFixed(1)}%</Td></tr>)}
          {snapshot?.topProducts.length ? <tr className="font-bold"><Td>Total</Td><Td /><Td right>{snapshot.topProducts.reduce((sum, row) => sum + row.quantitySold, 0)}</Td><Td right>{fmt(snapshot.topProducts.reduce((sum, row) => sum + row.revenue, 0))}</Td><Td /></tr> : null}
        </DenseTable>

        <DenseTable title="Top Customers (Udhar)" action="View all" actionHref="/customers" headers={["Customer", "Total Due (₹)", "Last Purchase", "Risk"]} loading={loading} empty={!snapshot?.topCustomers.length}>
          {snapshot?.topCustomers.slice(0, 5).map((row) => <tr key={row.customerId}><Td strong>{row.name}</Td><Td right strong>{fmt(row.balance)}</Td><Td right>{row.lastPurchase ? dateLabel(row.lastPurchase.slice(0, 10)) : "—"}</Td><Td right><RiskChip balance={row.balance} /></Td></tr>)}
          {snapshot?.topCustomers.length ? <tr className="font-bold"><Td>Total Outstanding</Td><Td right>{fmt(snapshot.topCustomers.reduce((sum, row) => sum + row.balance, 0))}</Td><Td /><Td /></tr> : null}
        </DenseTable>

        <DenseTable title="Sales by Staff" action="Manage staff" actionHref="/staff" headers={["Staff", "Bills", "Sales (₹)", "Avg bill (₹)"]} loading={loading} empty={!snapshot?.staffSales.length}>
          {snapshot?.staffSales.slice(0, 5).map((row) => <tr key={row.staffId}><Td strong>{row.staffName}</Td><Td right>{row.bills}</Td><Td right strong>{fmt(row.sales)}</Td><Td right>{fmt(row.bills > 0 ? row.sales / row.bills : 0)}</Td></tr>)}
          {snapshot?.staffSales.length ? <tr className="font-bold"><Td>Total</Td><Td right>{snapshot.staffSales.reduce((sum, row) => sum + row.bills, 0)}</Td><Td right>{fmt(snapshot.staffSales.reduce((sum, row) => sum + row.sales, 0))}</Td><Td /></tr> : null}
        </DenseTable>

        <DenseTable title="Discounts Given" action="View bills" actionHref="/bills" headers={["Bill", "Date", "Discount (₹)", "Reason"]} loading={loading} empty={!snapshot?.discounts.recent.length}>
          {snapshot?.discounts.recent.slice(0, 5).map((row) => <tr key={row.billId}><Td strong>{row.billNo}</Td><Td>{row.at ? dateLabel(row.at.slice(0, 10)) : "—"}</Td><Td right strong>{fmt(row.amount)}</Td><Td>{row.reason ?? "—"}</Td></tr>)}
          {snapshot && snapshot.discounts.total > 0 ? <tr className="font-bold"><Td>Total ({snapshot.discounts.discountedBillCount} bills)</Td><Td /><Td right>{fmt(snapshot.discounts.total)}</Td><Td>{[snapshot.discounts.manual > 0 ? `manual ${fmt(snapshot.discounts.manual)}` : null, snapshot.discounts.coupon > 0 ? `coupon ${fmt(snapshot.discounts.coupon)}` : null, snapshot.discounts.loyalty > 0 ? `loyalty ${fmt(snapshot.discounts.loyalty)}` : null, snapshot.discounts.line > 0 ? `line ${fmt(snapshot.discounts.line)}` : null].filter(Boolean).join(" · ") || "—"}</Td></tr> : null}
        </DenseTable>

        <DenseTable title="Daily Closing Summary" action="View all" actionHref="/daily-closing" headers={["Date", "Sales (₹)", "Collection (₹)", "Expense (₹)", "Net Profit (₹)"]} loading={loading || expenses.isLoading} empty={!dailyRows.length}>
          {dailyRows.map((row) => <tr key={row.date}><Td strong>{new Date(`${row.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</Td><Td right>{fmt(row.sales)}</Td><Td right>{fmt(row.collection)}</Td><Td right>{fmt(row.expense)}</Td><Td right strong>{fmt(row.net)}</Td></tr>)}
        </DenseTable>
      </section>

      <section className="grid items-start gap-4 md:grid-cols-2">
        <Panel title="Sales by Hour" subtitle={peakHour ? `Peak ${hourLabel(peakHour.hour)} • ${fmt(peakHour.sales)} (${peakHour.bills} bills)` : "(No sales in this period)"} info action={<PeriodPill value={period} onChange={applyPeriod} />}>
          <div className="h-[150px] px-2 pb-2">
            {loading ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyChart} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} minTickGap={14} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Bar dataKey="sales" name="Sales" radius={[3, 3, 0, 0]}>
                    {hourlyChart.map((row) => <Cell key={row.label} fill={peakHour && row.hour === peakHour.hour ? "var(--brand)" : "#b9d1fb"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="Busy Hours Insight">
          <div className="space-y-2 px-4 pb-4 pt-1 text-[12px] leading-relaxed text-[#42536f]">
            {loading ? <Skeleton className="h-24" /> : peakHour ? (
              <>
                <p><strong className="text-[var(--brand-ink)]">{hourLabel(peakHour.hour)}</strong> is your busiest hour — {fmt(peakHour.sales)} across {peakHour.bills} bill{peakHour.bills === 1 ? "" : "s"} in this period.</p>
                {quietHour ? <p>Quietest selling hour with any sales: <strong className="text-[var(--brand-ink)]">{hourLabel(quietHour.hour)}</strong> ({fmt(quietHour.sales)}). Schedule restocking, cleaning, or supplier calls there instead of the rush.</p> : null}
                <p className="text-[11px] text-[#7a879f]">Counted from every non-cancelled sale in the selected period, using each bill's local time.</p>
              </>
            ) : (
              <p>No sales recorded in the selected period yet — the hourly pattern appears after a few billing days.</p>
            )}
          </div>
        </Panel>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-3 2xl:grid-cols-[0.9fr_1.1fr_1fr]">
        <Panel title="Stock Movement Snapshot" info action={<PeriodPill value={period} onChange={applyPeriod} />}>
          <div className="grid grid-cols-2 divide-x divide-y divide-[#e8edf5] px-3 pb-3">
            <StockStat icon={<PackagePlus size={15} />} label="Total Stock In" value={fmt(snapshot?.stockMovement.totalIn)} deltaValue="Value received" tone="blue" />
            <StockStat icon={<Box size={15} />} label="Total Stock Out" value={fmt(snapshot?.stockMovement.totalOut)} deltaValue="Value issued" tone="red" />
            <StockStat icon={<ShoppingBag size={15} />} label="New Products Added" value={String(snapshot?.stockMovement.newProducts ?? 0)} deltaValue="In selected period" tone="green" />
            <StockStat icon={<AlertTriangle size={15} />} label="Low Stock Items" value={String(snapshot?.stockMovement.lowStockItems ?? 0)} deltaValue="Require attention" tone="amber" />
          </div>
        </Panel>

        <Panel title="Stock Movement Trend" subtitle="(Value)" info action={<PeriodPill value={period} onChange={applyPeriod} />}>
          <div className="flex gap-5 px-4 pt-1 text-[10px] font-semibold"><span className="text-[#15a94d]">→ Stock In</span><span className="text-[#ff3b45]">→ Stock Out</span></div>
          <div className="h-[138px] px-2 pb-2">
            {loading ? <Skeleton className="h-full" /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}><CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" /><XAxis dataKey="label" tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} minTickGap={18} /><YAxis tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={44} /><Tooltip content={<MoneyTooltip />} /><Line type="monotone" dataKey="stockIn" name="Stock In" stroke="#15a94d" strokeWidth={2} dot={{ r: 2.4, fill: "white", strokeWidth: 1.5 }} /><Line type="monotone" dataKey="stockOut" name="Stock Out" stroke="#ff3b45" strokeWidth={2} dot={{ r: 2.4, fill: "white", strokeWidth: 1.5 }} /></LineChart></ResponsiveContainer>}
          </div>
        </Panel>

        <Panel title="Report Insights">
          <div className="divide-y divide-[#e8edf5] px-3">
            {loading ? <Skeleton className="my-3 h-28" /> : insights.map((insight) => <InsightRow key={insight.title} {...insight} />)}
          </div>
          <Link href="/daily-closing" className="mx-3 mb-3 flex h-11 items-center justify-center rounded-xl border border-[#dfe7f2] text-[11px] font-bold text-[var(--brand)] hover:bg-[#f6f9ff] sm:h-8 sm:rounded-[6px]">View Detailed Insights <span className="ml-2">→</span></Link>
        </Panel>
      </section>

      <section className="overflow-hidden rounded-[18px] border border-[#dfe7f2] bg-white shadow-[0_10px_30px_rgba(31,60,110,0.05)]">
        <button type="button" className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-[#f8faff] lg:p-5" aria-expanded={controlsOpen} onClick={() => setControlsOpen((value) => !value)}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#eef3fb] text-[#445775]"><ShieldCheck size={18} /></span>
            <span className="min-w-0"><span className="block text-sm font-black text-[var(--brand-ink)]">Financial controls</span><span className="mt-1 block text-[11px] leading-4 text-[#718099]">Accounting integrity and bank reconciliation for owners and finance review</span></span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 text-[11px] font-bold text-[var(--brand)]">{controlsOpen ? "Hide controls" : "Open controls"}<ChevronDown size={15} className={cn("transition-transform", controlsOpen && "rotate-180")} /></span>
        </button>
        {controlsOpen ? <div className="space-y-4 border-t border-[#e7edf5] bg-[#f7f9fc] p-3 sm:p-4 lg:p-5"><AccountingControlPanel from={range.from} to={range.to} /><BankReconciliationPanel from={range.from} to={range.to} /></div> : null}
      </section>

      <OwnerPinModal open={exportPinOpen} onCancel={() => { if (!exporting) setExportPinOpen(false); }} title="Approve data export" description="Reports contain sensitive shop data. Owner PIN and reason are required before export." confirmLabel="Export data" reasonRequired loading={exporting} error={exportError} onConfirm={({ ownerPin, reason }) => confirmExport(ownerPin, reason)} />
    </PageShell>
  );
}

function MobileReportList({ title, actionHref, children }: { title: string; actionHref: string; children: ReactNode }) {
  return (
    <article className="rounded-[18px] border border-[#e4ebf4] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <header className="flex items-center justify-between border-b border-[#edf2f8] px-4 py-3.5">
        <h2 className="text-[16px] font-extrabold text-[var(--brand-ink)]">{title}</h2>
        <Link href={actionHref} className="inline-flex min-h-11 items-center px-1 text-xs font-extrabold text-[var(--brand)]">View all</Link>
      </header>
      <div className="divide-y divide-[#edf2f8] px-3">
        {children ? children : <div className="py-8 text-center text-xs font-semibold text-[#8290a8]">No records in this period</div>}
      </div>
    </article>
  );
}

function MobileReportRow({ title, subtitle, value, meta }: { title: ReactNode; subtitle?: ReactNode; value?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-extrabold text-[var(--brand-ink)]">{title}</p>
        {subtitle ? <p className="mt-1 truncate text-[11px] font-medium text-[#53617d]">{subtitle}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        {value ? <p className="text-[13px] font-black text-[var(--brand-ink)]">{value}</p> : null}
        {meta ? <div className="mt-1 text-[11px] font-bold text-[#64708b]">{meta}</div> : null}
      </div>
    </div>
  );
}

function MobileReportsOverview({
  loading,
  periodLabel,
  sales,
  previousSales,
  cash,
  upi,
  bank,
  profit,
  netProfit,
  expenses,
  udhar,
}: {
  loading: boolean;
  periodLabel: string;
  sales: number;
  previousSales: number;
  cash: number;
  upi: number;
  bank: number;
  profit: number;
  netProfit: number;
  expenses: number;
  udhar: number;
}) {
  const salesChange = delta(sales, previousSales);

  if (loading) {
    return <Skeleton className="h-[346px] rounded-[26px] md:hidden" data-testid="mobile-reports-overview-loading" />;
  }

  return (
    <section className="space-y-3 md:hidden" aria-label="Mobile report overview" data-testid="mobile-reports-overview">
      <article className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[var(--brand-ink)] via-[var(--brand)] to-[var(--brand-strong)] p-5 text-white shadow-[0_18px_46px_var(--brand-shadow)]">
        <span className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full border border-white/15 bg-white/[0.06]" aria-hidden="true" />
        <span className="pointer-events-none absolute -bottom-20 -left-16 h-40 w-40 rounded-full bg-[#54c9ff]/20 blur-2xl" aria-hidden="true" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/65">Net sales</p>
              <p className="mt-2 break-words text-[36px] font-black leading-none tracking-[-0.04em] tabular-nums">{fmt(sales)}</p>
            </div>
            <span className="max-w-[148px] rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-right text-[10px] font-bold leading-4 text-white/85 backdrop-blur-sm">{periodLabel}</span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px]">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-black", salesChange >= 0 ? "bg-emerald-300/20 text-emerald-100" : "bg-rose-300/20 text-rose-100")}>
              {salesChange >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(salesChange)}%
            </span>
            <span className="font-semibold text-white/60">against the previous period</span>
          </div>
          <div className="mt-5 grid grid-cols-3 divide-x divide-white/15 rounded-2xl border border-white/10 bg-[#031331]/25 p-1 backdrop-blur-sm">
            <MobileTenderStat label="Cash" value={cash} />
            <MobileTenderStat label="UPI" value={upi} />
            <MobileTenderStat label="Bank" value={bank} />
          </div>
        </div>
      </article>

      <div className="grid grid-cols-2 gap-2.5">
        <MobilePulseTile label="Profit (Est.)" value={profit} detail="Before expenses" icon={<CircleDollarSign size={17} />} tone="emerald" />
        <MobilePulseTile label="Net Profit" value={netProfit} detail="After expenses" icon={<TrendingUp size={17} />} tone="blue" />
        <MobilePulseTile label="Expenses" value={expenses} detail="Selected period" icon={<Box size={17} />} tone="amber" />
        <MobilePulseTile label="Udhar Due" value={udhar} detail="Needs collection" icon={<ReceiptIndianRupee size={17} />} tone="rose" />
      </div>
    </section>
  );
}

function MobileTenderStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 px-2.5 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/55">{label}</p>
      <p className="mt-1 truncate text-[13px] font-black tabular-nums text-white">{fmt(value)}</p>
    </div>
  );
}

function MobilePulseTile({ label, value, detail, icon, tone }: { label: string; value: number; detail: string; icon: ReactNode; tone: "emerald" | "blue" | "amber" | "rose" }) {
  const tones = {
    emerald: "border-emerald-100 bg-gradient-to-br from-white to-emerald-50/70 text-emerald-700",
    blue: "border-blue-100 bg-gradient-to-br from-white to-blue-50/75 text-blue-700",
    amber: "border-amber-100 bg-gradient-to-br from-white to-amber-50/75 text-amber-700",
    rose: "border-rose-100 bg-gradient-to-br from-white to-rose-50/70 text-rose-700",
  }[tone];
  return (
    <article className={cn("min-w-0 rounded-[20px] border p-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.055)]", tones)}>
      <div className="flex items-center gap-2 text-[11px] font-extrabold"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white shadow-sm">{icon}</span><span className="truncate text-[#304467]">{label}</span></div>
      <p className="mt-3 break-words text-[20px] font-black leading-none tracking-[-0.025em] text-[var(--brand-ink)] tabular-nums">{fmt(value)}</p>
      <p className="mt-2 text-[10px] font-semibold text-[#77859d]">{detail}</p>
    </article>
  );
}

function KpiCard({ label, value, previous, icon, iconClass, color, spark, positiveIsBad, loading }: { label: string; value: number | undefined; previous: number; icon: ReactNode; iconClass: string; color: string; spark: number[]; positiveIsBad?: boolean; loading: boolean }) {
  const change = delta(value ?? 0, previous);
  const favorable = positiveIsBad ? change <= 0 : change >= 0;
  const points = spark.length > 1 ? spark.map((item, index) => ({ index, value: item })) : [{ index: 0, value: 0 }, { index: 1, value: value ?? 0 }];
  const gradientId = `report-kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <article className={cn(PANEL, "h-full min-h-[148px] p-4")}>
    {loading ? <Skeleton className="h-full min-h-[98px]" /> : <>
      <div className="flex min-w-0 items-center gap-2.5"><span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", iconClass)}>{icon}</span><p className="min-w-0 truncate text-[11px] font-bold leading-tight text-[#52617c]">{label}</p></div>
      <p className="mt-3 whitespace-nowrap text-[22px] font-black leading-none tracking-[-0.025em] text-[var(--brand-ink)]">{fmt(value)}</p>
      <div className="mt-2 flex min-w-0 items-center gap-1 text-[9.5px]"><span className={cn("inline-flex shrink-0 items-center gap-0.5 font-bold", favorable ? "text-[#10a948]" : "text-[#ff334d]")}>{change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{Math.abs(change)}%</span><span className="truncate text-[#7a879f]">vs last period</span></div>
      <div className="mt-1 h-[24px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ top: 2, right: 1, left: 1, bottom: 0 }}><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="70%" stopColor={color} stopOpacity={0.08} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.7} fill={`url(#${gradientId})`} dot={{ r: 1.5, fill: "white", stroke: color, strokeWidth: 1.2 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
    </>}
  </article>;
}

function Panel({ title, subtitle, info, action, children }: { title: string; subtitle?: string; info?: boolean; action?: ReactNode; children: ReactNode }) {
  return <article className={PANEL}>
    <header className="flex min-h-14 min-w-0 items-center justify-between gap-3 border-b border-[#edf1f6] px-4"><div className="flex min-w-0 items-center gap-1.5"><h2 className="truncate text-[13px] font-extrabold text-[var(--brand-ink)]">{title}</h2>{subtitle ? <span className="shrink-0 text-[9px] text-[#72809a]">{subtitle}</span> : null}{info ? <Info size={12} className="shrink-0 text-[#7e8ca4]" /> : null}</div><div className="shrink-0">{action}</div></header>
    {children}
  </article>;
}

function PeriodPill({ value, onChange }: { value: ReportPeriod; onChange: (period: Exclude<ReportPeriod, "custom">) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-11 min-w-[108px] items-center justify-between gap-2 rounded-xl border border-[#dfe6f0] bg-[#fbfcfe] px-3 text-[10px] font-bold text-[#405273] transition-colors hover:border-[#c7d4e6] hover:bg-white sm:h-7 sm:min-w-[92px] sm:rounded-[6px] sm:px-2.5 sm:text-[9.5px] sm:font-semibold">
          {REPORT_PERIOD_LABELS[value]} <ChevronDown size={11} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={5} className="w-36 rounded-[7px] border-[#dfe7f2] p-1.5">
        {(["today", "week", "month"] as const).map((period) => (
          <button key={period} type="button" onClick={() => onChange(period)} className={cn("min-h-11 w-full rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-[#405273] hover:bg-[#f2f6fc] sm:min-h-0 sm:rounded-[5px]", value === period && "bg-[var(--brand-soft)] text-[var(--brand)]")}>
            {REPORT_PERIOD_LABELS[period]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ChartFrame({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  return <div className="h-[210px] px-3 pb-3 pt-2 2xl:h-[228px]">{loading ? <Skeleton className="h-full" /> : empty ? <EmptyChart /> : children}</div>;
}

function EmptyChart() {
  return <div className="grid h-full min-h-[150px] place-items-center text-[11px] text-[#8290a8]">No activity in this period</div>;
}

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-[6px] border border-[#dfe7f2] bg-white px-3 py-2 text-[10px] shadow-lg"><p className="mb-1 font-bold text-[#536483]">{label}</p>{payload.map((item) => <p key={item.name} style={{ color: item.color }}><span className="font-semibold">{item.name}:</span> {fmt(item.value)}</p>)}</div>;
}

function TrendLabel({ current, previous }: { current: number; previous: number }) {
  const change = delta(current, previous);
  return <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-bold", change >= 0 ? "text-[#10a948]" : "text-[#ff334d]")}>{change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{Math.abs(change)}% <em className="font-normal not-italic text-[#75839d]">vs last period</em></span>;
}

function DenseTable({ title, action, actionHref, headers, loading, empty, children }: { title: string; action: string; actionHref: string; headers: string[]; loading: boolean; empty: boolean; children: ReactNode }) {
  return <article className={cn(PANEL, "h-full")}><header className="flex min-h-12 min-w-0 items-center justify-between gap-2 border-b border-[#edf1f6] px-4"><h2 className="truncate text-[12px] font-extrabold text-[var(--brand-ink)]">{title}</h2><Link href={actionHref} className="shrink-0 text-[10px] font-bold text-[var(--brand)] hover:underline">{action}</Link></header>{loading ? <Skeleton className="m-3 h-32" /> : empty ? <div className="grid h-32 place-items-center text-[11px] text-[#8290a8]">No records in this period</div> : <div className="overflow-x-auto p-3"><table className="w-full min-w-[430px] border-collapse text-[10px]"><thead><tr className="bg-[#f5f7fb]">{headers.map((header, index) => <th key={header} className={cn("border-y border-[#e5ebf3] px-2.5 py-2 font-bold text-[#52617c]", index ? "text-right" : "text-left")}>{header}</th>)}</tr></thead><tbody className="divide-y divide-[#e8edf4]">{children}</tbody></table></div>}</article>;
}

function Td({ children, right, strong }: { children?: ReactNode; right?: boolean; strong?: boolean }) {
  return <td className={cn("whitespace-nowrap px-2.5 py-2 text-[#344666]", right && "text-right", strong && "font-bold text-[var(--brand-ink)]")}>{children}</td>;
}

function RiskChip({ balance }: { balance: number }) {
  const level = balance >= 10_000 ? "High" : balance >= 3_000 ? "Medium" : "Low";
  return <span className={cn("inline-flex rounded-[4px] px-2 py-0.5 text-[9px] font-semibold", level === "High" ? "bg-[#ffeded] text-[#ff334d]" : level === "Medium" ? "bg-[#fff3df] text-[#f08a00]" : "bg-[#eaf9ef] text-[#14a94f]")}>{level}</span>;
}

function StockStat({ icon, label, value, deltaValue, tone }: { icon: ReactNode; label: string; value: string; deltaValue: string; tone: "blue" | "red" | "green" | "amber" }) {
  const colors = { blue: "bg-[var(--brand-soft)] text-[var(--brand)]", red: "bg-[#ffedef] text-[#ff334d]", green: "bg-[#eaf9ef] text-[#16ad52]", amber: "bg-[#fff3e8] text-[#ff8a00]" }[tone];
  return <div className="flex min-h-[68px] gap-2.5 p-3"><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[7px]", colors)}>{icon}</span><div className="min-w-0"><p className="text-[9px] font-semibold text-[#64738e]">{label}</p><p className="mt-0.5 text-[14px] font-black text-[#15264b]">{value}</p><p className="mt-0.5 text-[8.5px] text-[#7b89a0]">{deltaValue}</p></div></div>;
}

function InsightRow({ tone, title, detail }: { tone: "green" | "amber" | "red"; title: string; detail: string }) {
  const colors = { green: "bg-[#eaf9ef] text-[#16ad52]", amber: "bg-[#fff3e8] text-[#ff8a00]", red: "bg-[#ffedef] text-[#ff334d]" }[tone];
  const icon = tone === "green" ? <TrendingUp size={14} /> : tone === "amber" ? <Sparkles size={14} /> : <AlertTriangle size={14} />;
  return <div className="flex gap-2.5 py-2.5"><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", colors)}>{icon}</span><div><p className="text-[10px] font-semibold leading-4 text-[#20345a]">{title}</p><p className="text-[9px] leading-4 text-[#76839b]">{detail}</p></div></div>;
}
