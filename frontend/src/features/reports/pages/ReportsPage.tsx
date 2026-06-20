import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  CheckCircle2,
  CircleDollarSign,
  Download,
  Filter,
  IndianRupee,
  Info,
  PackagePlus,
  ReceiptIndianRupee,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { PageShell, SyncBadge } from "@/components/shared";
import { getExpenseSummary, listExpenses } from "@/features/expenses/api";
import {
  buildLocalReportSnapshot,
  toDateInputValue,
  type LocalReportSnapshot,
  type ReportDailyPoint,
} from "@/features/reports/local-reporting";
import { recordDataExportLocalFirst } from "@/features/reports/local-actions";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PANEL = "overflow-hidden rounded-[8px] border border-[#e2e9f3] bg-white shadow-[0_4px_18px_rgba(31,60,110,0.045)]";
const GRID_STROKE = "#e7edf5";
const AXIS_COLOR = "#6f7f9b";

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

function delta(current: number, previous: number) {
  if (Math.abs(previous) < 0.005) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1_000) / 10;
}

function shortText(value: string, max = 18) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [from, setFrom] = useState(daysAgoInput(6));
  const [to, setTo] = useState(todayInput());
  const [snapshot, setSnapshot] = useState<LocalReportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportPinOpen, setExportPinOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const range = useMemo(() => safeDateRange(from, to), [from, to]);
  const priorRange = useMemo(() => previousRange(range.from, range.to), [range.from, range.to]);
  const expenseParams = useMemo(() => ({
    from: `${range.from}T00:00:00.000Z`,
    to: `${range.to}T23:59:59.999Z`,
  }), [range.from, range.to]);

  const expenseSummary = useQuery({
    queryKey: ["reports-expense-summary", range],
    queryFn: () => getExpenseSummary(expenseParams),
    retry: 1,
  });
  const previousExpenseSummary = useQuery({
    queryKey: ["reports-expense-summary", priorRange],
    queryFn: () => getExpenseSummary({ from: `${priorRange.from}T00:00:00.000Z`, to: `${priorRange.to}T23:59:59.999Z` }),
    retry: 1,
  });
  const expenses = useQuery({
    queryKey: ["reports-expenses", range],
    queryFn: () => listExpenses(expenseParams),
    retry: 1,
  });

  const loadReports = async () => {
    setLoading(true);
    try {
      setSnapshot(await buildLocalReportSnapshot(range));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
    const refresh = () => void loadReports();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [range.from, range.to]);

  const selected = snapshot?.selected;
  const previous = snapshot?.previousSelected;
  const expenseTotal = expenseSummary.data?.total;
  const previousExpenseTotal = previousExpenseSummary.data?.total ?? 0;
  const netProfit = expenseTotal == null ? undefined : (selected?.profitEstimate ?? 0) - expenseTotal;
  const previousNetProfit = (previous?.profitEstimate ?? 0) - previousExpenseTotal;

  const paymentModes = useMemo(() => {
    const payment = snapshot?.paymentBreakdown;
    if (!payment) return [];
    return [
      { name: "Cash", value: payment.cashIn, color: "#20b75a" },
      { name: "UPI", value: payment.upiIn, color: "#1264f6" },
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
        detail: `${paymentModes[0]?.name ?? "Cash"} currently leads collected payments.`,
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
      toast({ title: "Report exported", description: "Owner approval was recorded in the audit log." });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Owner approval is required.");
    } finally {
      setExporting(false);
    }
  }

  const trend = snapshot?.dailyTrend ?? [];
  const kpis = [
    {
      label: "Total Sales",
      value: selected?.sales ?? 0,
      previous: previous?.sales ?? 0,
      icon: <ShoppingBag size={16} />,
      color: "#1264f6",
      iconClass: "bg-[#edf4ff] text-[#1264f6]",
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
      color: "#1264f6",
      iconClass: "bg-[#edf4ff] text-[#1264f6]",
      spark: trend.map((point) => point.profit - (expenseByDay.get(point.date) ?? 0)),
    },
  ];

  return (
    <PageShell className="space-y-3 bg-white pb-8 text-[#10224a] sm:space-y-3.5 2xl:pt-0">
      <section className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between 2xl:fixed 2xl:right-[276px] 2xl:top-[18px] 2xl:z-[60] 2xl:flex-row 2xl:gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-[#6c7c98]">
          {snapshot?.hasUnsyncedOperations ? (
            <SyncBadge status="estimate" label={`${snapshot.pendingSyncCount + snapshot.failedSyncCount} changes awaiting sync`} />
          ) : (
            <SyncBadge status="synced" label="Synced · Local reports ready" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 min-w-[220px] justify-between rounded-[7px] border-[#dfe7f2] bg-white px-3 text-[12px] font-semibold text-[#24385f]">
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-[#1264f6]" />{rangeLabel(range.from, range.to)}</span>
                <span className="text-[#7e8ba3]">⌄</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] rounded-[8px] border-[#dfe7f2] p-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">From</Label><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-9 rounded-[6px]" /></div>
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">To</Label><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 h-9 rounded-[6px]" /></div>
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild><Button variant="outline" className="h-9 rounded-[7px] border-[#dfe7f2] px-4 text-[12px] font-semibold"><Filter size={14} className="mr-2" />Filters</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-48 rounded-[8px] p-2">
              {[{ label: "Today", days: 0 }, { label: "This week", days: 6 }, { label: "Last 30 days", days: 29 }].map((item) => (
                <button key={item.label} className="w-full rounded-[6px] px-3 py-2 text-left text-xs font-semibold hover:bg-[#f2f6fc]" onClick={() => { setFrom(daysAgoInput(item.days)); setTo(todayInput()); }}>{item.label}</button>
              ))}
              <Link href="/daily-closing" className="mt-1 block border-t border-[#edf1f6] px-3 py-2 text-xs font-semibold text-[#1264f6]">Open daily closing</Link>
            </PopoverContent>
          </Popover>
          <Button onClick={() => { setExportError(null); setExportPinOpen(true); }} disabled={!snapshot || loading} className="h-9 rounded-[7px] bg-[#075fff] px-4 text-[12px] font-bold shadow-[0_7px_16px_rgba(7,95,255,0.2)] hover:bg-[#0052e0]"><Download size={14} className="mr-2" />Export</Button>
          <Button variant="ghost" size="icon" title="Refresh reports" onClick={loadReports} disabled={loading} className="h-9 w-9 rounded-[7px]"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} loading={loading || (kpi.label.includes("Expense") && expenseSummary.isLoading)} />
        ))}
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.04fr_1.12fr_1.18fr]">
        <Panel title="Sales Trend" info action={<PeriodPill />}>
          <div className="flex items-baseline gap-4 px-3.5 pt-1 text-[11px]">
            <span className="text-[#60708e]">Total Sales</span>
            <strong className="text-[16px] text-[#14264c]">{fmt(selected?.sales)}</strong>
            <TrendLabel current={selected?.sales ?? 0} previous={previous?.sales ?? 0} />
          </div>
          <ChartFrame loading={loading} empty={trend.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 14, right: 10, left: -12, bottom: 0 }}>
                <defs><linearGradient id="salesArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1264f6" stopOpacity={0.2} /><stop offset="100%" stopColor="#1264f6" stopOpacity={0.01} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<MoneyTooltip />} />
                <Area type="monotone" dataKey="sales" name="Sales" stroke="#075fff" strokeWidth={2.2} fill="url(#salesArea)" dot={{ r: 2.7, fill: "white", stroke: "#075fff", strokeWidth: 1.7 }} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>

        <Panel title="Category Performance" info action={<PeriodPill />}>
          <ChartFrame loading={loading} empty={!snapshot?.categoryPerformance.length}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snapshot?.categoryPerformance ?? []} margin={{ top: 20, right: 8, left: -10, bottom: 2 }} barCategoryGap="28%">
                <defs><linearGradient id="categoryBars" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#075fff" /><stop offset="100%" stopColor="#8bb5ff" /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" />
                <XAxis dataKey="name" tickFormatter={(value) => shortText(String(value), 10)} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={44} />
                <Tooltip content={<MoneyTooltip />} />
                <Bar dataKey="revenue" name="Revenue" fill="url(#categoryBars)" radius={[3, 3, 0, 0]} maxBarSize={34}><LabelList dataKey="revenue" position="top" formatter={(value: unknown) => fmt(Number(value))} style={{ fontSize: 8, fontWeight: 700, fill: "#24385f" }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Panel>

        <Panel title="Payment Mode Breakdown" info action={<PeriodPill />}>
          {loading ? <Skeleton className="m-4 h-[178px]" /> : paymentModes.length === 0 ? <EmptyChart /> : (
            <div className="grid min-h-[208px] grid-cols-[minmax(150px,0.85fr)_1.15fr] items-center gap-3 px-3 pb-2">
              <div className="relative mx-auto h-[162px] w-[162px]">
                <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={paymentModes} dataKey="value" nameKey="name" innerRadius={51} outerRadius={76} paddingAngle={1} stroke="#fff" strokeWidth={2}>{paymentModes.map((mode) => <Cell key={mode.name} fill={mode.color} />)}</Pie><Tooltip content={<MoneyTooltip />} /></PieChart></ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="block text-[15px] text-[#13244a]">{fmt(paymentTotal)}</strong><span className="text-[10px] text-[#7886a0]">Total Collection</span></div></div>
              </div>
              <div className="space-y-3 pr-2">
                {paymentModes.map((mode) => <div key={mode.name} className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ background: mode.color }} /><span className="font-semibold text-[#2c3f64]">{mode.name}</span><span className="font-bold text-[#15264b]">{fmt(mode.value)} <em className="font-normal not-italic text-[#75839d]">({paymentTotal ? ((mode.value / paymentTotal) * 100).toFixed(1) : 0}%)</em></span></div>)}
              </div>
            </div>
          )}
        </Panel>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        <DenseTable title="Top Products" action="View all" actionHref="/products" headers={["Product", "Category", "Qty Sold", "Sales (₹)", "Margin (%)"]} loading={loading} empty={!snapshot?.topProducts.length}>
          {snapshot?.topProducts.slice(0, 5).map((row) => <tr key={row.productId}><Td strong>{row.name}</Td><Td>{row.category}</Td><Td right>{row.quantitySold}</Td><Td right strong>{fmt(row.revenue)}</Td><Td right>{row.marginPct.toFixed(1)}%</Td></tr>)}
          {snapshot?.topProducts.length ? <tr className="font-bold"><Td>Total</Td><Td /><Td right>{snapshot.topProducts.reduce((sum, row) => sum + row.quantitySold, 0)}</Td><Td right>{fmt(snapshot.topProducts.reduce((sum, row) => sum + row.revenue, 0))}</Td><Td /></tr> : null}
        </DenseTable>

        <DenseTable title="Top Customers (Udhar)" action="View all" actionHref="/customers" headers={["Customer", "Total Due (₹)", "Last Purchase", "Risk"]} loading={loading} empty={!snapshot?.topCustomers.length}>
          {snapshot?.topCustomers.slice(0, 5).map((row) => <tr key={row.customerId}><Td strong>{row.name}</Td><Td right strong>{fmt(row.balance)}</Td><Td right>{row.bills ? `${row.bills} bills` : "—"}</Td><Td right><RiskChip balance={row.balance} /></Td></tr>)}
          {snapshot?.topCustomers.length ? <tr className="font-bold"><Td>Total Outstanding</Td><Td right>{fmt(snapshot.topCustomers.reduce((sum, row) => sum + row.balance, 0))}</Td><Td /><Td /></tr> : null}
        </DenseTable>

        <DenseTable title="Daily Closing Summary" action="View all" actionHref="/daily-closing" headers={["Date", "Sales (₹)", "Collection (₹)", "Expense (₹)", "Net Profit (₹)"]} loading={loading || expenses.isLoading} empty={!dailyRows.length}>
          {dailyRows.map((row) => <tr key={row.date}><Td strong>{new Date(`${row.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</Td><Td right>{fmt(row.sales)}</Td><Td right>{fmt(row.collection)}</Td><Td right>{fmt(row.expense)}</Td><Td right strong>{fmt(row.net)}</Td></tr>)}
        </DenseTable>
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.86fr_1.1fr_1.04fr]">
        <Panel title="Stock Movement Snapshot" info action={<PeriodPill />}>
          <div className="grid grid-cols-2 divide-x divide-y divide-[#e8edf5] px-3 pb-3">
            <StockStat icon={<PackagePlus size={15} />} label="Total Stock In" value={fmt(snapshot?.stockMovement.totalIn)} deltaValue="Value received" tone="blue" />
            <StockStat icon={<Box size={15} />} label="Total Stock Out" value={fmt(snapshot?.stockMovement.totalOut)} deltaValue="Value issued" tone="red" />
            <StockStat icon={<ShoppingBag size={15} />} label="New Products Added" value={String(snapshot?.stockMovement.newProducts ?? 0)} deltaValue="In selected period" tone="green" />
            <StockStat icon={<AlertTriangle size={15} />} label="Low Stock Items" value={String(snapshot?.stockMovement.lowStockItems ?? 0)} deltaValue="Require attention" tone="amber" />
          </div>
        </Panel>

        <Panel title="Stock Movement Trend" subtitle="(Value)" info action={<PeriodPill />}>
          <div className="flex gap-5 px-4 pt-1 text-[10px] font-semibold"><span className="text-[#15a94d]">→ Stock In</span><span className="text-[#ff3b45]">→ Stock Out</span></div>
          <div className="h-[138px] px-2 pb-2">
            {loading ? <Skeleton className="h-full" /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}><CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="2 4" /><XAxis dataKey="label" tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} minTickGap={18} /><YAxis tickFormatter={fmtAxis} tick={{ fontSize: 9, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={44} /><Tooltip content={<MoneyTooltip />} /><Line type="monotone" dataKey="stockIn" name="Stock In" stroke="#15a94d" strokeWidth={2} dot={{ r: 2.4, fill: "white", strokeWidth: 1.5 }} /><Line type="monotone" dataKey="stockOut" name="Stock Out" stroke="#ff3b45" strokeWidth={2} dot={{ r: 2.4, fill: "white", strokeWidth: 1.5 }} /></LineChart></ResponsiveContainer>}
          </div>
        </Panel>

        <Panel title="Report Insights">
          <div className="divide-y divide-[#e8edf5] px-3">
            {loading ? <Skeleton className="my-3 h-28" /> : insights.map((insight) => <InsightRow key={insight.title} {...insight} />)}
          </div>
          <Link href="/daily-closing" className="mx-3 mb-3 flex h-8 items-center justify-center rounded-[6px] border border-[#dfe7f2] text-[11px] font-bold text-[#075fff] hover:bg-[#f6f9ff]">View Detailed Insights <span className="ml-2">→</span></Link>
        </Panel>
      </section>

      <OwnerPinModal open={exportPinOpen} onCancel={() => { if (!exporting) setExportPinOpen(false); }} title="Approve data export" description="Reports contain sensitive shop data. Owner PIN and reason are required before export." confirmLabel="Export data" reasonRequired loading={exporting} error={exportError} onConfirm={({ ownerPin, reason }) => confirmExport(ownerPin, reason)} />
    </PageShell>
  );
}

function KpiCard({ label, value, previous, icon, iconClass, color, spark, positiveIsBad, loading }: { label: string; value: number | undefined; previous: number; icon: ReactNode; iconClass: string; color: string; spark: number[]; positiveIsBad?: boolean; loading: boolean }) {
  const change = delta(value ?? 0, previous);
  const favorable = positiveIsBad ? change <= 0 : change >= 0;
  const points = spark.length > 1 ? spark.map((item, index) => ({ index, value: item })) : [{ index: 0, value: 0 }, { index: 1, value: value ?? 0 }];
  return <article className={cn(PANEL, "min-h-[126px] p-3")}>
    {loading ? <Skeleton className="h-full min-h-[98px]" /> : <>
      <div className="flex items-center gap-2"><span className={cn("grid h-8 w-8 place-items-center rounded-[7px]", iconClass)}>{icon}</span><p className="min-w-0 text-[10.5px] font-semibold leading-tight text-[#34486e]">{label}</p></div>
      <p className="mt-2 whitespace-nowrap text-[20px] font-black leading-none text-[#101f40]">{fmt(value)}</p>
      <div className="mt-2 flex items-center gap-1 text-[9.5px]"><span className={cn("inline-flex items-center gap-0.5 font-bold", favorable ? "text-[#10a948]" : "text-[#ff334d]")}>{change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{Math.abs(change)}%</span><span className="text-[#7a879f]">vs last period</span></div>
      <div className="mt-1 h-[24px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.6} dot={{ r: 1.6, fill: color, strokeWidth: 0 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
    </>}
  </article>;
}

function Panel({ title, subtitle, info, action, children }: { title: string; subtitle?: string; info?: boolean; action?: ReactNode; children: ReactNode }) {
  return <article className={PANEL}>
    <header className="flex h-10 items-center justify-between gap-2 px-3.5"><div className="flex items-center gap-1.5"><h2 className="text-[12px] font-extrabold text-[#13254a]">{title}</h2>{subtitle ? <span className="text-[9px] text-[#72809a]">{subtitle}</span> : null}{info ? <Info size={11} className="text-[#7e8ca4]" /> : null}</div>{action}</header>
    {children}
  </article>;
}

function PeriodPill() {
  return <span className="rounded-[5px] border border-[#dfe6f0] bg-[#fbfcfe] px-2 py-1 text-[9px] font-semibold text-[#405273]">This Week⌄</span>;
}

function ChartFrame({ loading, empty, children }: { loading: boolean; empty: boolean; children: ReactNode }) {
  return <div className="h-[166px] px-2 pb-2">{loading ? <Skeleton className="h-full" /> : empty ? <EmptyChart /> : children}</div>;
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
  return <article className={PANEL}><header className="flex h-9 items-center justify-between px-3.5"><h2 className="text-[12px] font-extrabold text-[#13254a]">{title}</h2><Link href={actionHref} className="text-[10px] font-bold text-[#075fff] hover:underline">{action}</Link></header>{loading ? <Skeleton className="m-3 h-32" /> : empty ? <div className="grid h-32 place-items-center text-[11px] text-[#8290a8]">No records in this period</div> : <div className="overflow-x-auto px-2 pb-1.5"><table className="w-full min-w-[430px] border-collapse text-[9px]"><thead><tr className="bg-[#f5f7fb]">{headers.map((header, index) => <th key={header} className={cn("border-y border-[#e5ebf3] px-2 py-1 font-bold text-[#52617c]", index ? "text-right" : "text-left")}>{header}</th>)}</tr></thead><tbody className="divide-y divide-[#e8edf4]">{children}</tbody></table></div>}</article>;
}

function Td({ children, right, strong }: { children?: ReactNode; right?: boolean; strong?: boolean }) {
  return <td className={cn("whitespace-nowrap px-2 py-1 text-[#344666]", right && "text-right", strong && "font-bold text-[#17294d]")}>{children}</td>;
}

function RiskChip({ balance }: { balance: number }) {
  const level = balance >= 10_000 ? "High" : balance >= 3_000 ? "Medium" : "Low";
  return <span className={cn("inline-flex rounded-[4px] px-2 py-0.5 text-[9px] font-semibold", level === "High" ? "bg-[#ffeded] text-[#ff334d]" : level === "Medium" ? "bg-[#fff3df] text-[#f08a00]" : "bg-[#eaf9ef] text-[#14a94f]")}>{level}</span>;
}

function StockStat({ icon, label, value, deltaValue, tone }: { icon: ReactNode; label: string; value: string; deltaValue: string; tone: "blue" | "red" | "green" | "amber" }) {
  const colors = { blue: "bg-[#edf4ff] text-[#1264f6]", red: "bg-[#ffedef] text-[#ff334d]", green: "bg-[#eaf9ef] text-[#16ad52]", amber: "bg-[#fff3e8] text-[#ff8a00]" }[tone];
  return <div className="flex min-h-[68px] gap-2.5 p-3"><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[7px]", colors)}>{icon}</span><div className="min-w-0"><p className="text-[9px] font-semibold text-[#64738e]">{label}</p><p className="mt-0.5 text-[14px] font-black text-[#15264b]">{value}</p><p className="mt-0.5 text-[8.5px] text-[#7b89a0]">{deltaValue}</p></div></div>;
}

function InsightRow({ tone, title, detail }: { tone: "green" | "amber" | "red"; title: string; detail: string }) {
  const colors = { green: "bg-[#eaf9ef] text-[#16ad52]", amber: "bg-[#fff3e8] text-[#ff8a00]", red: "bg-[#ffedef] text-[#ff334d]" }[tone];
  const icon = tone === "green" ? <TrendingUp size={14} /> : tone === "amber" ? <Sparkles size={14} /> : <AlertTriangle size={14} />;
  return <div className="flex gap-2.5 py-2.5"><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", colors)}>{icon}</span><div><p className="text-[10px] font-semibold leading-4 text-[#20345a]">{title}</p><p className="text-[9px] leading-4 text-[#76839b]">{detail}</p></div></div>;
}
