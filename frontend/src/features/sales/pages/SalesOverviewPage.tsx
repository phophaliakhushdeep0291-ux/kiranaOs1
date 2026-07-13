import { roundMoney } from "@/lib/money";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Download,
  Filter,
  IndianRupee,
  Percent,
  Plus,
  RefreshCw,
  ShoppingCart,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell, SyncBadge } from "@/components/shared";
import { buildLocalReportSnapshot, toDateInputValue, type DateRange } from "@/features/reports/local-reporting";
import { dedupeBillsForDisplay } from "@/features/sync/bill-reconciliation";
import { filterRowsForCurrentScope, offlineDB } from "@/lib/offline/db";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Bill } from "@/types/api";

type SalesPeriod = "today" | "week" | "month" | "custom";
type LocalBill = Bill & Record<string, unknown>;

const PANEL = "min-w-0 overflow-hidden rounded-[9px] border border-[#e1e8f3] bg-white shadow-[0_5px_20px_rgba(31,60,110,0.045)]";
const GRID_STROKE = "#e7edf5";
const AXIS_COLOR = "#6f7f9b";
const BLUE = "#075fff";
const GREEN = "#18b85a";
const ORANGE = "#ff9d0a";
const PURPLE = "#7c3ff2";
const PINK = "#ff3b8d";
const PERIOD_LABELS: Record<SalesPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  custom: "Custom",
};

function readNumber(value: unknown, fallback = 0): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}



function money(value: number | undefined, fractionDigits = 0): string {
  return `\u20b9${Math.round(readNumber(value, 0)).toLocaleString("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function fmtAxis(value: number) {
  if (Math.abs(value) >= 100_000) return `\u20b9${Math.round(value / 100_000)}L`;
  if (Math.abs(value) >= 1_000) return `\u20b9${Math.round(value / 1_000)}K`;
  return `\u20b9${Math.round(value)}`;
}

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysAgoInput(days: number) {
  const date = startOfLocalDay();
  date.setDate(date.getDate() - days);
  return toDateInputValue(date);
}

function dateLabel(value: string, withYear = false) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
  });
}

function rangeLabel(range: DateRange) {
  return range.from === range.to ? dateLabel(range.from, true) : `${dateLabel(range.from, true)} - ${dateLabel(range.to, true)}`;
}

function safeDateRange(from: string, to: string): DateRange {
  if (!from || !to) return { from: toDateInputValue(new Date()), to: toDateInputValue(new Date()) };
  return from <= to ? { from, to } : { from: to, to: from };
}

function periodRange(period: Exclude<SalesPeriod, "custom">): DateRange {
  const today = startOfLocalDay();
  if (period === "today") {
    const value = toDateInputValue(today);
    return { from: value, to: value };
  }
  if (period === "month") {
    return { from: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)), to: toDateInputValue(today) };
  }
  return { from: daysAgoInput(6), to: toDateInputValue(today) };
}

function previousRange(range: DateRange): DateRange {
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousTo = new Date(start);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - days + 1);
  return { from: toDateInputValue(previousFrom), to: toDateInputValue(previousTo) };
}

function monthRange(offset = 0): DateRange {
  const today = startOfLocalDay();
  const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const end = offset === 0 ? today : new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  return { from: toDateInputValue(start), to: toDateInputValue(end) };
}

function pctChange(current: number, previous: number) {
  if (Math.abs(previous) < 0.005) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1_000) / 10;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function billDate(bill: LocalBill) {
  return String(bill.createdAt ?? bill.created_at ?? bill.billDate ?? bill.bill_date ?? "");
}

function billTotal(bill: LocalBill) {
  return roundMoney(readNumber(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount ?? bill.total_amount ?? bill.net_amount, 0));
}

function billPaid(bill: LocalBill) {
  const payments = Array.isArray(bill.payments) ? bill.payments.map(asRecord) : [];
  const embeddedPaid = payments.reduce((sum, payment) => (
    String(payment.mode ?? "").toLowerCase() === "credit" ? sum : sum + readNumber(payment.amount, 0)
  ), 0);
  return Math.max(readNumber(bill.paidAmount ?? bill.buyerPaidAmount, 0), embeddedPaid);
}

function billCredit(bill: LocalBill) {
  return readNumber(bill.creditAmount, Math.max(0, billTotal(bill) - billPaid(bill)));
}

function isDeleted(bill: LocalBill) {
  return Boolean(bill.deleted_at ?? bill.deletedAt ?? bill.merged_into_id ?? bill.mergedIntoId);
}

function isReturnBill(bill: LocalBill) {
  return String(bill.billType ?? bill.bill_type ?? "").toLowerCase().includes("return");
}

function isSaleBill(bill: LocalBill) {
  // Estimates (kacha bills) count as sales — same money/stock effects, only the EST- series differs.
  const status = String(bill.status ?? "").toLowerCase();
  return !isDeleted(bill) && !isReturnBill(bill) && !status.includes("cancel");
}

function isWithinRange(bill: LocalBill, range: DateRange) {
  const raw = billDate(bill);
  if (!raw) return false;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= new Date(`${range.from}T00:00:00`).getTime() && time <= new Date(`${range.to}T23:59:59.999`).getTime();
}

function billNo(bill: LocalBill) {
  return String(bill.billNumber ?? bill.billNo ?? bill.id);
}

function customerName(bill: LocalBill) {
  return String(bill.customerName ?? bill.customer_name ?? "Walk-in Customer");
}

function paymentMode(bill: LocalBill) {
  const payments = Array.isArray(bill.payments) ? bill.payments.map(asRecord) : [];
  const modes = Array.from(new Set(payments
    .filter((payment) => String(payment.mode ?? "").toLowerCase() !== "credit" && readNumber(payment.amount, 0) > 0)
    .map((payment) => String(payment.mode ?? "").toLowerCase())));
  const hasCredit = payments.some((payment) => String(payment.mode ?? "").toLowerCase() === "credit" && readNumber(payment.amount, 0) > 0) || billCredit(bill) > 0;
  if (modes.length > 1 || (modes.length === 1 && hasCredit)) return "split";
  if (modes.length === 1) return modes[0];
  if (hasCredit) return "udhar";
  return String(bill.paymentMode ?? bill.payment_mode ?? "cash").toLowerCase();
}

function modeMeta(mode: string) {
  if (mode === "upi") return { label: "UPI", color: PURPLE, chip: "border-[#ddd3ff] bg-[#f4efff] text-[#7146eb]" };
  if (mode === "card") return { label: "Card", color: ORANGE, chip: "border-[#ffdda8] bg-[#fff2df] text-[#db7f00]" };
  if (mode === "udhar") return { label: "Udhar", color: ORANGE, chip: "border-[#ffdda8] bg-[#fff2df] text-[#db7f00]" };
  if (mode === "split") return { label: "Split", color: BLUE, chip: "border-[#c9dcff] bg-[#eef4ff] text-[#075fff]" };
  return { label: "Cash", color: GREEN, chip: "border-[#c9efd5] bg-[#eaf9ef] text-[#13964a]" };
}

async function loadBills(): Promise<LocalBill[]> {
  const rows = await offlineDB.getAll<LocalBill>("bills").catch(() => []);
  return dedupeBillsForDisplay(filterRowsForCurrentScope(rows)) as unknown as LocalBill[];
}

async function loadSalesData(range: DateRange) {
  const today = toDateInputValue(new Date());
  const yesterday = daysAgoInput(1);
  const lastWeek = previousRange(periodRange("week"));
  const [snapshot, previous, todaySnapshot, yesterdaySnapshot, monthSnapshot, lastMonthSnapshot, bills] = await Promise.all([
    buildLocalReportSnapshot(range),
    buildLocalReportSnapshot(previousRange(range)),
    buildLocalReportSnapshot({ from: today, to: today }),
    buildLocalReportSnapshot({ from: yesterday, to: yesterday }),
    buildLocalReportSnapshot(monthRange(0)),
    buildLocalReportSnapshot(monthRange(-1)),
    loadBills(),
  ]);
  const lastWeekSnapshot = range.from === periodRange("week").from && range.to === periodRange("week").to
    ? previous
    : await buildLocalReportSnapshot(lastWeek);
  return { snapshot, previous, todaySnapshot, yesterdaySnapshot, monthSnapshot, lastMonthSnapshot, lastWeekSnapshot, bills };
}

type SalesData = Awaited<ReturnType<typeof loadSalesData>>;

export default function SalesOverviewPage() {
  const { toast } = useToast();
  const [period, setPeriod] = useState<SalesPeriod>("week");
  const [from, setFrom] = useState(daysAgoInput(6));
  const [to, setTo] = useState(toDateInputValue(new Date()));
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateOpen, setDateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dataRef = useRef<SalesData | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const range = useMemo(() => safeDateRange(from, to), [from, to]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    const run = async (options?: { showLoader?: boolean }) => {
      if (cancelled) return;
      const showLoader = options?.showLoader ?? !dataRef.current;
      if (showLoader) setLoading(true);
      try {
        const next = await loadSalesData(range);
        if (!cancelled) setData(next);
      } finally {
        if (!cancelled && showLoader) setLoading(false);
      }
    };
    void run({ showLoader: !dataRef.current });
    const refresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        void run({ showLoader: false });
      }, 220);
    };
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      cancelled = true;
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [range]);

  const applyPeriod = (nextPeriod: Exclude<SalesPeriod, "custom">) => {
    const nextRange = periodRange(nextPeriod);
    setPeriod(nextPeriod);
    setFrom(nextRange.from);
    setTo(nextRange.to);
    setDateOpen(false);
    setFiltersOpen(false);
  };

  const snapshot = data?.snapshot ?? null;
  const previous = data?.previous?.selected;
  const selected = snapshot?.selected;
  const allBills = data?.bills ?? [];
  const saleBills = useMemo(() => allBills.filter((bill) => isSaleBill(bill) && isWithinRange(bill, range)), [allBills, range]);
  const returnBills = useMemo(() => allBills.filter((bill) => isReturnBill(bill) && isWithinRange(bill, range)), [allBills, range]);
  const refundTotal = returnBills.reduce((sum, bill) => sum + Math.abs(billTotal(bill)), 0);
  const previousRefundTotal = allBills
    .filter((bill) => isReturnBill(bill) && isWithinRange(bill, previousRange(range)))
    .reduce((sum, bill) => sum + Math.abs(billTotal(bill)), 0);
  const avgOrderValue = selected?.bills ? roundMoney(selected.sales / selected.bills) : 0;
  const previousAvgOrderValue = previous?.bills ? roundMoney(previous.sales / previous.bills) : 0;
  const profitMargin = selected?.sales ? roundMoney(((selected.profitEstimate ?? 0) / selected.sales) * 100) : 0;
  const previousProfitMargin = previous?.sales ? roundMoney(((previous.profitEstimate ?? 0) / previous.sales) * 100) : 0;

  const dailyOrderCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const bill of saleBills) {
      const date = billDate(bill).slice(0, 10);
      if (date) map.set(date, (map.get(date) ?? 0) + 1);
    }
    return map;
  }, [saleBills]);

  const returnsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const bill of allBills.filter(isReturnBill)) {
      const date = billDate(bill).slice(0, 10);
      if (date) map.set(date, roundMoney((map.get(date) ?? 0) + Math.abs(billTotal(bill))));
    }
    return map;
  }, [allBills]);

  const recentSales = useMemo(() => [...saleBills].sort((a, b) => new Date(billDate(b)).getTime() - new Date(billDate(a)).getTime()).slice(0, 5), [saleBills]);
  const paymentRows = useMemo(() => {
    const payment = snapshot?.paymentBreakdown;
    const sales = selected?.sales ?? 0;
    const rows = [
      { name: "UPI", value: payment?.upi ?? 0, color: BLUE },
      { name: "Cash", value: payment?.cash ?? 0, color: GREEN },
      { name: "Card", value: 0, color: ORANGE },
      { name: "Wallet", value: 0, color: PURPLE },
      { name: "Others", value: Math.max(0, roundMoney(sales - (payment?.upi ?? 0) - (payment?.cash ?? 0) - (payment?.udhar ?? 0))), color: "#9aa8bc" },
    ];
    const udhar = payment?.udhar ?? 0;
    if (udhar > 0) rows.splice(3, 0, { name: "Credit", value: udhar, color: "#ff7a1a" });
    return rows.filter((row) => row.value > 0);
  }, [snapshot?.paymentBreakdown, selected?.sales]);

  const categoryRows = useMemo(() => {
    const source = snapshot?.categoryPerformance ?? [];
    const colors = [BLUE, GREEN, ORANGE, PURPLE, PINK, "#9aa8bc"];
    return source.slice(0, 6).map((row, index) => ({ ...row, value: row.revenue, color: colors[index] ?? BLUE }));
  }, [snapshot?.categoryPerformance]);

  const hourlyRows = useMemo(() => {
    const today = toDateInputValue(new Date());
    const labels = ["12 AM", "2 AM", "4 AM", "6 AM", "8 AM", "10 AM", "12 PM", "2 PM", "4 PM", "6 PM", "8 PM", "10 PM"];
    return labels.map((label, index) => {
      const fromHour = index * 2;
      const value = allBills
        .filter((bill) => isSaleBill(bill) && billDate(bill).slice(0, 10) === today)
        .filter((bill) => {
          const hour = new Date(billDate(bill)).getHours();
          return hour >= fromHour && hour < fromHour + 2;
        })
        .reduce((sum, bill) => roundMoney(sum + billTotal(bill)), 0);
      return { label, value };
    });
  }, [allBills]);

  const storeRows = useMemo(() => {
    const rows = snapshot?.staffSales ?? [];
    if (rows.length > 0) return rows.slice(0, 5).map((row) => ({ name: row.staffName || "Main Store", sales: row.sales, orders: row.bills }));
    if ((selected?.sales ?? 0) > 0) return [{ name: "Main Store", sales: selected?.sales ?? 0, orders: selected?.bills ?? 0 }];
    return [];
  }, [snapshot?.staffSales, selected?.bills, selected?.sales]);

  const summaryRows = [
    { label: "Today Sales", value: data?.todaySnapshot.selected.sales ?? 0, color: BLUE },
    { label: "Yesterday Sales", value: data?.yesterdaySnapshot.selected.sales ?? 0, color: BLUE },
    { label: "This Week Sales", value: data?.snapshot.sevenDay.sales ?? 0, color: GREEN },
    { label: "Last Week Sales", value: data?.lastWeekSnapshot.selected.sales ?? 0, color: GREEN },
    { label: "This Month Sales", value: data?.monthSnapshot.selected.sales ?? 0, color: ORANGE },
    { label: "Last Month Sales", value: data?.lastMonthSnapshot.selected.sales ?? 0, color: ORANGE },
  ];

  const kpis = [
    { label: "Total Sales", value: money(selected?.sales), current: selected?.sales ?? 0, previous: previous?.sales ?? 0, icon: <IndianRupee size={16} />, iconClass: "bg-[#edf4ff] text-[#075fff]", color: BLUE, spark: snapshot?.dailyTrend.map((point) => point.sales) ?? [] },
    { label: "Total Orders", value: String(selected?.bills ?? 0), current: selected?.bills ?? 0, previous: previous?.bills ?? 0, icon: <ShoppingCart size={16} />, iconClass: "bg-[#eaf9ef] text-[#16ad52]", color: GREEN, spark: snapshot?.dailyTrend.map((point) => point.collection) ?? [] },
    { label: "Average Order Value", value: money(avgOrderValue), current: avgOrderValue, previous: previousAvgOrderValue, icon: <Tag size={16} />, iconClass: "bg-[#fff3e8] text-[#ff8a00]", color: ORANGE, spark: snapshot?.dailyTrend.map((point) => {
      const bills = dailyOrderCounts.get(point.date) ?? 0;
      return bills > 0 ? point.sales / bills : 0;
    }) ?? [] },
    { label: "Gross Profit", value: money(selected?.profitEstimate), current: selected?.profitEstimate ?? 0, previous: previous?.profitEstimate ?? 0, icon: <CircleDollarSign size={16} />, iconClass: "bg-[#f3edff] text-[#7c3df0]", color: PURPLE, spark: snapshot?.dailyTrend.map((point) => point.profit) ?? [] },
    { label: "Profit Margin", value: `${profitMargin.toFixed(2)}%`, current: profitMargin, previous: previousProfitMargin, icon: <Percent size={16} />, iconClass: "bg-[#ffedf5] text-[#ff3b8d]", color: PINK, spark: snapshot?.dailyTrend.map((point) => point.sales ? (point.profit / point.sales) * 100 : 0) ?? [] },
    { label: "Refunds", value: money(refundTotal), current: refundTotal, previous: previousRefundTotal, icon: <RefreshCw size={16} />, iconClass: "bg-[#edf4ff] text-[#075fff]", color: BLUE, spark: snapshot?.dailyTrend.map((point) => returnsByDate.get(point.date) ?? 0) ?? [], positiveIsBad: true },
  ];

  const exportSales = () => {
    if (!snapshot) return;
    const payload = { exportedAt: new Date().toISOString(), range, selected, topProducts: snapshot.topProducts, recentSales: recentSales.map((bill) => ({ billNo: billNo(bill), total: billTotal(bill), customer: customerName(bill), createdAt: billDate(bill) })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kirana-sales-overview-${range.from}-to-${range.to}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: "Sales overview exported", description: "The selected period summary was downloaded." });
  };

  return (
    <PageShell className="mx-auto min-h-full w-full max-w-[1800px] space-y-3 !bg-white pb-8 text-[#10224a]">
      <section className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <SyncBadge status={snapshot?.hasUnsyncedOperations ? "estimate" : "synced"} label={snapshot?.hasUnsyncedOperations ? "Local estimate" : "Synced"} />
          <span className="text-[#7b879b]">Just now</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 min-w-[230px] justify-between rounded-[7px] border-[#dfe7f2] bg-white px-3 text-[12px] font-bold text-[#24385f]">
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-[#075fff]" />{rangeLabel(range)}</span>
                <ChevronDown size={13} className="text-[#7e8ba3]" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] rounded-[8px] border-[#dfe7f2] p-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">From</Label><Input type="date" value={from} onChange={(event) => { setPeriod("custom"); setFrom(event.target.value); }} className="mt-1 h-9 rounded-[6px]" /></div>
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">To</Label><Input type="date" value={to} onChange={(event) => { setPeriod("custom"); setTo(event.target.value); }} className="mt-1 h-9 rounded-[6px]" /></div>
              </div>
            </PopoverContent>
          </Popover>
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 rounded-[7px] border-[#dfe7f2] px-4 text-[12px] font-bold"><Filter size={14} className="mr-2" />Filters</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 rounded-[8px] border-[#dfe7f2] p-2">
              {(["today", "week", "month"] as const).map((item) => (
                <button key={item} type="button" onClick={() => applyPeriod(item)} className={cn("w-full rounded-[6px] px-3 py-2 text-left text-xs font-bold hover:bg-[#f2f6fc]", period === item && "bg-[#edf4ff] text-[#075fff]")}>{PERIOD_LABELS[item]}</button>
              ))}
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={exportSales} disabled={!snapshot || loading} className="h-9 rounded-[7px] border-[#dfe7f2] px-4 text-[12px] font-bold"><Download size={14} className="mr-2" />Export</Button>
          <Button asChild className="h-9 rounded-[7px] bg-[#075fff] px-5 text-[12px] font-bold shadow-[0_8px_18px_rgba(7,95,255,0.22)] hover:bg-[#0052e0]"><Link href="/billing"><Plus size={14} className="mr-2" />New Sale</Link></Button>
        </div>
      </section>

      <section className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => <MetricCard key={kpi.label} {...kpi} loading={loading} />)}
      </section>

      <section className="grid items-stretch gap-3 xl:grid-cols-[1.22fr_0.92fr_0.92fr]">
        <Panel title="Sales Trend" action={<PeriodPill value={period} onChange={applyPeriod} />}>
          <ChartFrame loading={loading} empty={!snapshot?.dailyTrend.length}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={snapshot?.dailyTrend ?? []} margin={{ top: 16, right: 14, left: -8, bottom: 0 }}>
                <defs><linearGradient id="sales-overview-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BLUE} stopOpacity={0.22} /><stop offset="100%" stopColor={BLUE} stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: AXIS_COLOR }} />
                <YAxis tickFormatter={fmtAxis} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: AXIS_COLOR }} width={48} />
                <Tooltip content={<MoneyTooltip />} />
                <Area type="monotone" dataKey="sales" name="Sales" stroke={BLUE} strokeWidth={2.4} fill="url(#sales-overview-area)" dot={{ r: 3, fill: "white", stroke: BLUE, strokeWidth: 1.8 }} activeDot={{ r: 4.4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>

        <DonutPanel title="Sales by Category" total={selected?.sales ?? 0} rows={categoryRows} centerLabel="Total Sales" />
        <DonutPanel title="Sales by Payment Method" total={selected?.sales ?? 0} rows={paymentRows} centerLabel="Total Sales" />
      </section>

      <section className="grid items-stretch gap-3 xl:grid-cols-3">
        <SmallTable title="Top Selling Products" actionHref="/products" action="View all" headers={["Product", "Category", "Qty Sold", "Sales (\u20b9)"]} loading={loading} empty={!snapshot?.topProducts.length}>
          {snapshot?.topProducts.slice(0, 5).map((row, index) => (
            <tr key={row.productId} className="text-[#24385f]">
              <td className="px-3 py-2 font-bold"><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded bg-[#f5f7fb] text-[10px] text-[#075fff]">{index + 1}</span>{row.name}</td>
              <td className="px-3 py-2">{row.category}</td>
              <td className="px-3 py-2 text-right font-semibold">{row.quantitySold}</td>
              <td className="px-3 py-2 text-right font-black">{money(row.revenue)}</td>
            </tr>
          ))}
        </SmallTable>

        <Panel title="Sales by Store" action={<Link href="/settings/store-profile" className="text-[10px] font-bold text-[#075fff]">View all</Link>}>
          <div className="space-y-3 px-4 pb-4 pt-1">
            {loading ? <Skeleton className="h-36" /> : storeRows.length === 0 ? <EmptyState label="No store sales in this period" /> : storeRows.map((row) => {
              const max = Math.max(...storeRows.map((item) => item.sales), 1);
              return <div key={row.name} className="grid grid-cols-[1fr_86px_44px] items-center gap-3 text-[10px]">
                <span className="truncate font-semibold text-[#34486e]">{row.name}</span>
                <div><p className="mb-1 text-right font-black text-[#14264c]">{money(row.sales)}</p><div className="h-1.5 rounded-full bg-[#edf2f8]"><div className="h-full rounded-full bg-[#075fff]" style={{ width: `${Math.max(7, (row.sales / max) * 100)}%` }} /></div></div>
                <span className="text-right font-semibold text-[#52617c]">{row.orders}</span>
              </div>;
            })}
          </div>
        </Panel>

        <SmallTable title="Recent Sales" actionHref="/bills" action="View all" headers={["Invoice", "Customer", "Amount", "Payment", "Time"]} loading={loading} empty={recentSales.length === 0}>
          {recentSales.map((bill) => {
            const mode = modeMeta(paymentMode(bill));
            const date = new Date(billDate(bill));
            return <tr key={bill.id} className="text-[#24385f]">
              <td className="px-3 py-2 font-bold text-[#075fff]">{billNo(bill)}</td>
              <td className="px-3 py-2">{customerName(bill)}</td>
              <td className="px-3 py-2 text-right font-black">{money(billTotal(bill))}</td>
              <td className="px-3 py-2 text-right"><span className={cn("rounded-[5px] border px-2 py-0.5 text-[9px] font-bold", mode.chip)}>{mode.label}</span></td>
              <td className="px-3 py-2 text-right">{Number.isFinite(date.getTime()) ? date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
            </tr>;
          })}
        </SmallTable>
      </section>

      <section className="grid items-stretch gap-3 xl:grid-cols-[1fr_320px]">
        <Panel title="Hourly Sales Today">
          <div className="h-[220px] px-3 pb-3">
            {loading ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyRows} margin={{ top: 24, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: AXIS_COLOR }} />
                  <YAxis tickFormatter={fmtAxis} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: AXIS_COLOR }} width={48} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Bar dataKey="value" name="Sales" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="Sales Summary">
          <div className="divide-y divide-[#e8edf4] px-4 pb-3">
            {loading ? <Skeleton className="my-3 h-44" /> : summaryRows.map((row) => (
              <div key={row.label} className="grid grid-cols-[26px_1fr_auto] items-center gap-2 py-2.5 text-[11px]">
                <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-[#edf4ff]" style={{ color: row.color }}><CalendarDays size={13} /></span>
                <span className="font-semibold text-[#34486e]">{row.label}</span>
                <span className="font-black text-[#14264c]">{money(row.value)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </PageShell>
  );
}

function MetricCard({ label, value, current, previous, icon, iconClass, color, spark, positiveIsBad, loading }: {
  label: string;
  value: string;
  current: number;
  previous: number;
  icon: ReactNode;
  iconClass: string;
  color: string;
  spark: number[];
  positiveIsBad?: boolean;
  loading: boolean;
}) {
  const change = pctChange(current, previous);
  const bad = positiveIsBad ? change > 0 : change < 0;
  const points = spark.length > 1 ? spark.map((item, index) => ({ index, value: item })) : [{ index: 0, value: previous }, { index: 1, value: current }];
  const gradientId = `sales-kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <article className={cn(PANEL, "h-full min-h-[142px] p-4")}>
      {loading ? <Skeleton className="h-full min-h-[112px]" /> : (
        <>
          <div className="flex min-w-0 items-center gap-3"><span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[9px]", iconClass)}>{icon}</span><p className="min-w-0 text-[11px] font-bold leading-snug text-[#34486e]">{label}</p></div>
          <p className="mt-3 text-[22px] font-black leading-none text-[#101f40]">{value}</p>
          <div className="mt-2 flex items-center gap-1 text-[10px]">
            <span className={cn("inline-flex items-center gap-0.5 font-black", change === 0 ? "text-[#64748b]" : bad ? "text-[#ff314f]" : "text-[#10a948]")}>{change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{Math.abs(change)}%</span>
            <span className="font-medium text-[#7a879f]">vs last week</span>
          </div>
          <div className="mt-2 h-[28px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 2, right: 1, left: 1, bottom: 0 }}>
                <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.26} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.8} fill={`url(#${gradientId})`} dot={{ r: 1.7, fill: "white", stroke: color, strokeWidth: 1.2 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </article>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <article className={PANEL}><header className="flex h-12 min-w-0 items-center justify-between gap-3 px-4"><h2 className="truncate text-[14px] font-black text-[#13254a]">{title}</h2>{action ? <div className="shrink-0">{action}</div> : null}</header>{children}</article>;
}

function ChartFrame({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  return <div className="h-[214px] px-3 pb-3">{loading ? <Skeleton className="h-full" /> : empty ? <EmptyState label="No sales in this period" /> : children}</div>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="grid h-full min-h-[130px] place-items-center text-center text-[11px] font-semibold text-[#8290a8]">{label}</div>;
}

function PeriodPill({ value, onChange }: { value: SalesPeriod; onChange: (period: Exclude<SalesPeriod, "custom">) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-7 min-w-[82px] items-center justify-between gap-2 rounded-[6px] border border-[#dfe6f0] bg-[#fbfcfe] px-2.5 text-[10px] font-bold text-[#405273] hover:bg-white">
          {PERIOD_LABELS[value]} <ChevronDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-36 rounded-[7px] border-[#dfe7f2] p-1.5">
        {(["today", "week", "month"] as const).map((period) => (
          <button key={period} type="button" onClick={() => onChange(period)} className={cn("w-full rounded-[5px] px-2.5 py-2 text-left text-[11px] font-bold text-[#405273] hover:bg-[#f2f6fc]", value === period && "bg-[#edf4ff] text-[#075fff]")}>{PERIOD_LABELS[period]}</button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function DonutPanel({ title, total, rows, centerLabel }: { title: string; total: number; rows: Array<{ name: string; value: number; color: string }>; centerLabel: string }) {
  const chartRows = rows.length ? rows : [{ name: "No sales", value: 1, color: "#e6ebf2" }];
  return (
    <Panel title={title}>
      <div className="grid min-h-[224px] items-center gap-3 px-4 pb-4 sm:grid-cols-[184px_1fr]">
        <div className="relative mx-auto h-[176px] w-[176px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartRows} dataKey="value" nameKey="name" innerRadius={56} outerRadius={84} paddingAngle={1} stroke="#fff" strokeWidth={2} isAnimationActive animationBegin={80} animationDuration={800}>
                {chartRows.map((row) => <Cell key={row.name} fill={row.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-[15px] font-black text-[#13244a]">{money(total)}</p><p className="mt-1 text-[10px] font-medium text-[#7886a0]">{centerLabel}</p></div></div>
        </div>
        <div className="space-y-3">
          {rows.length === 0 ? <p className="text-center text-[11px] text-[#8290a8]">No breakdown yet</p> : rows.map((row) => (
            <div key={row.name} className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[11px]">
              <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
              <span className="font-semibold text-[#2c3f64]">{row.name}</span>
              <span className="font-black text-[#15264b]">{money(row.value)} <em className="font-normal not-italic text-[#75839d]">({total ? ((row.value / total) * 100).toFixed(1) : 0}%)</em></span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SmallTable({ title, action, actionHref, headers, loading, empty, children }: { title: string; action: string; actionHref: string; headers: string[]; loading: boolean; empty: boolean; children: ReactNode }) {
  return (
    <article className={cn(PANEL, "h-full")}>
      <header className="flex h-11 items-center justify-between gap-3 px-4"><h2 className="truncate text-[13px] font-black text-[#13254a]">{title}</h2><Link href={actionHref} className="shrink-0 text-[10px] font-bold text-[#075fff]">{action}</Link></header>
      {loading ? <Skeleton className="m-3 h-36" /> : empty ? <EmptyState label="No records in this period" /> : (
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[520px] border-collapse text-[10px]">
            <thead><tr className="border-y border-[#e5ebf3] bg-[#f7f9fc] text-[#52617c]">{headers.map((header, index) => <th key={header} className={cn("px-3 py-2 text-left font-black", index > 1 && "text-right")}>{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#e8edf4]">{children}</tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-[6px] border border-[#dfe7f2] bg-white px-3 py-2 text-[10px] shadow-lg"><p className="mb-1 font-bold text-[#536483]">{label}</p>{payload.map((item) => <p key={item.name} style={{ color: item.color }}><span className="font-semibold">{item.name}:</span> {money(item.value)}</p>)}</div>;
}
