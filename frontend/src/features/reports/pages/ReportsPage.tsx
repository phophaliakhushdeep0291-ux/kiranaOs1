import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, Database, Download, FileBarChart, Lightbulb, PieChart as PieIcon, RefreshCw, ShieldAlert, TrendingDown, TrendingUp, Users, Wallet, XCircle } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from "recharts";
import { getExpenseSummary } from "@/features/expenses/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { buildLocalReportSnapshot, toDateInputValue, type LocalReportSnapshot } from "@/features/reports/local-reporting";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { recordDataExportLocalFirst } from "@/features/reports/local-actions";
import { FilterBar, PageHeader, PageShell, StatCard, StatsGrid, SyncBadge } from "@/components/shared";
import { cn } from "@/lib/utils";

function fmt(value: number | undefined) {
  return "Rs " + Math.round(value ?? 0).toLocaleString("en-IN");
}

function todayInput() { return toDateInputValue(new Date()); }

function daysAgoInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateInputValue(date);
}

function formatRangeLabel(from: string, to: string) {
  const today = todayInput();
  if (from === today && to === today) return "Today";
  if (from === daysAgoInput(6) && to === today) return "Last 7 days";
  if (from === daysAgoInput(29) && to === today) return "Last 30 days";
  if (from === to) return from;
  return `${from} to ${to}`;
}

function safeDateRange(from: string, to: string) {
  if (!from || !to) return { from: todayInput(), to: todayInput() };
  return from <= to ? { from, to } : { from: to, to: from };
}

export default function Reports() {
  const { toast } = useToast();
  const [from, setFrom] = useState(todayInput());
  const [to, setTo] = useState(todayInput());
  const [snapshot, setSnapshot] = useState<LocalReportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportPinOpen, setExportPinOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const range = useMemo(() => safeDateRange(from, to), [from, to]);
  const rangeLabel = useMemo(() => formatRangeLabel(range.from, range.to), [range.from, range.to]);

  // Operating expenses come from the server (online-first feature); when offline
  // the cards show an em dash rather than a wrong zero.
  const expenseQ = useQuery({
    queryKey: ["reports-expense-summary", range],
    queryFn: () => getExpenseSummary({ from: `${range.from}T00:00:00.000Z`, to: `${range.to}T23:59:59.999Z` }),
    retry: 1,
  });
  const expenseTotal = expenseQ.data?.total;
  const netProfit = expenseQ.data != null && snapshot?.selected != null
    ? (snapshot.selected.profitEstimate ?? 0) - expenseQ.data.total
    : undefined;

  const payModeData = useMemo(() => {
    const s = snapshot?.selected;
    if (!s) return [];
    return [
      { name: "Cash", value: s.cashSales ?? 0, color: "#16a34a" },
      { name: "UPI", value: s.upiSales ?? 0, color: "#8b5cf6" },
      { name: "Udhar", value: s.udharSales ?? 0, color: "#f59e0b" },
    ].filter((d) => d.value > 0);
  }, [snapshot]);

  const insights = useMemo(() => {
    const s = snapshot?.selected;
    if (!s || !s.bills) return [];
    const out: { text: string; tone: "green" | "amber" | "blue" }[] = [];
    out.push({ tone: "blue", text: `${fmt(s.sales)} across ${s.bills} bill${s.bills === 1 ? "" : "s"} — average ${fmt(s.sales / s.bills)} per bill.` });
    const top = payModeData.length ? payModeData.reduce((a, b) => (b.value > a.value ? b : a)) : null;
    if (top && s.sales > 0) out.push({ tone: "green", text: `${top.name} leads payments with ${Math.round((top.value / s.sales) * 100)}% of sales.` });
    const topProduct = snapshot?.topProducts?.[0];
    if (topProduct && s.sales > 0) out.push({ tone: "blue", text: `${topProduct.name} is your top seller — ${fmt(topProduct.revenue)} (${Math.round((topProduct.revenue / s.sales) * 100)}% of sales).` });
    if ((s.udharSales ?? 0) > 0) out.push({ tone: "amber", text: `${fmt(s.udharSales)} went out as udhar this period — follow up to protect cash flow.` });
    if (netProfit != null) out.push({ tone: netProfit >= 0 ? "green" : "amber", text: `Net profit ${fmt(netProfit)} after ${fmt(expenseTotal ?? 0)} operating expenses.` });
    return out.slice(0, 4);
  }, [snapshot, payModeData, netProfit, expenseTotal]);

  const loadReports = async () => {
    setLoading(true);
    try { setSnapshot(await buildLocalReportSnapshot(range)); }
    finally { setLoading(false); }
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

  const quickRanges = useMemo(() => [
    { label: "Today", from: todayInput(), to: todayInput() },
    { label: "7 days", from: daysAgoInput(6), to: todayInput() },
    { label: "30 days", from: daysAgoInput(29), to: todayInput() },
  ], []);

  const selected = snapshot?.selected;
  const selectedCashCollected = snapshot?.paymentBreakdown.netCashInHand ?? 0;
  const selectedTotalReceived = (snapshot?.paymentBreakdown.cashIn ?? 0) + (snapshot?.paymentBreakdown.upiIn ?? 0);
  const maxProductRevenue = useMemo(() =>
    Math.max(...(snapshot?.topProducts.map((p) => p.revenue) ?? [0]), 1),
  [snapshot?.topProducts]);
  const maxCustomerSales = useMemo(() =>
    Math.max(...(snapshot?.topCustomers.map((c) => c.sales) ?? [0]), 1),
  [snapshot?.topCustomers]);

  async function confirmDataExport(ownerPin: string, reason: string) {
    if (!snapshot) return;
    setExporting(true);
    setExportError(null);
    try {
      await recordDataExportLocalFirst({
        ownerPin, reason,
        reportType: "local_reports_snapshot",
        from: range.from, to: range.to, format: "json",
        rowCount: snapshot.topProducts.length + snapshot.topCustomers.length + snapshot.lowStock.length + snapshot.staffSales.length,
      });
      const payload = JSON.stringify({ exportedAt: new Date().toISOString(), from: range.from, to: range.to, snapshot }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kirana-report-${range.from}-to-${range.to}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportPinOpen(false);
      toast({ title: "Report exported", description: "Owner approval was saved in the audit log." });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Owner PIN is required to export data.");
    } finally { setExporting(false); }
  }

  return (
    <PageShell className="space-y-5 sm:space-y-6">
      <PageHeader
        title="Reports"
        description={`${rangeLabel} — sales, cash, udhar, stock, and staff performance.`}
        eyebrow={snapshot?.hasUnsyncedOperations
          ? <SyncBadge status="estimate" label={`Local estimate — ${snapshot.pendingSyncCount} pending, ${snapshot.failedSyncCount} failed`} />
          : <span className="inline-flex items-center gap-1.5"><Database size={13} className="opacity-60" /> Calculated from local saved data</span>}
        actions={(
          <>
            <Link href="/daily-closing"><Button variant="outline" className="w-full sm:w-auto"><CalendarDays size={15} className="mr-1.5" /> Daily closing</Button></Link>
            <Button onClick={loadReports} disabled={loading} className="w-full sm:w-auto"><RefreshCw size={15} className="mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      {/* ── Date Range Filter ─────────────────────────────────────────────── */}
      <FilterBar actions={
        <Button variant="outline" className="h-10 w-full sm:w-auto" disabled={loading || !snapshot} onClick={() => { setExportError(null); setExportPinOpen(true); }}>
          <Download size={15} className="mr-1.5" />Export
        </Button>
      }>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-auto">
          <div className="space-y-1.5">
            <Label className="app-muted-label">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="app-muted-label">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-xl" />
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 lg:flex lg:w-auto">
          {quickRanges.map((item) => (
            <Button key={item.label} className="h-10 rounded-xl px-4" variant={range.from === item.from && range.to === item.to ? "default" : "outline"} onClick={() => { setFrom(item.from); setTo(item.to); }}>
              {item.label}
            </Button>
          ))}
        </div>
      </FilterBar>

      {/* ── KPI Hero Section ─────────────────────────────────────────────── */}
      <section className="premium-hero overflow-hidden">
        <div className="border-b px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="app-muted-label">Summary</p>
              <p className="mt-0.5 font-display text-xl font-black tracking-tight">{rangeLabel}</p>
            </div>
            {selected && !loading && (
              <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary ring-1 ring-primary/20">
                <TrendingUp size={13} />
                {selected.bills ?? 0} bills
              </div>
            )}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <StatsGrid columns={4}>
            <StatCard
              label="Total sales"
              value={loading ? "" : fmt(selected?.sales)}
              description={`${selected?.bills ?? 0} bills`}
              icon={<TrendingUp size={18} />}
              loading={loading}
              tone="green"
            />
            <StatCard
              label="Profit estimate"
              value={loading ? "" : fmt(selected?.profitEstimate)}
              description="From saved bill items"
              icon={<FileBarChart size={18} />}
              loading={loading}
              tone="blue"
            />
            <StatCard
              label="Udhar given"
              value={loading ? "" : fmt(selected?.udharSales)}
              description="Credit issued this period"
              icon={<Users size={18} />}
              loading={loading}
              tone="amber"
            />
            <StatCard
              label="Cash in hand"
              value={loading ? "" : fmt(selectedCashCollected)}
              description="Received minus supplier paid"
              icon={<Wallet size={18} />}
              loading={loading}
              tone="green"
            />
            <StatCard
              label="Expense total"
              value={expenseQ.isLoading ? "" : expenseTotal != null ? fmt(expenseTotal) : "—"}
              description={expenseQ.isError ? "Connect to load expenses" : "Operating costs this period"}
              icon={<TrendingDown size={18} />}
              loading={expenseQ.isLoading}
              tone="amber"
            />
            <StatCard
              label="Net profit"
              value={loading || expenseQ.isLoading ? "" : netProfit != null ? fmt(netProfit) : "—"}
              description={netProfit != null ? "Profit estimate minus expenses" : "Needs expenses (online)"}
              icon={<FileBarChart size={18} />}
              loading={loading || expenseQ.isLoading}
              tone="blue"
            />
          </StatsGrid>
        </div>
      </section>

      {/* ── Payment Mode Breakdown + Insights ────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"><PieIcon size={16} /></span>
              <h2 className="font-display text-base font-black tracking-tight">Payment mode breakdown</h2>
            </div>
          </div>
          {loading ? (
            <div className="p-5"><Skeleton className="h-40 w-full" /></div>
          ) : payModeData.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">No sales in this period yet.</p>
          ) : (
            <div className="flex items-center gap-4 p-5">
              <div className="relative h-[130px] w-[130px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={payModeData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={2} strokeWidth={0}>
                      {payModeData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <ChartTooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Sales</p>
                    <p className="font-display text-sm font-black">{fmt(selected?.sales)}</p>
                  </div>
                </div>
              </div>
              <ul className="min-w-0 flex-1 space-y-2">
                {payModeData.map((d) => (
                  <li key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                    <span className="flex-1 font-semibold">{d.name}</span>
                    <span className="font-bold">{fmt(d.value)}</span>
                    <span className="text-[10px] text-muted-foreground">({selected?.sales ? Math.round((d.value / selected.sales) * 100) : 0}%)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm lg:col-span-2">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><Lightbulb size={16} /></span>
              <h2 className="font-display text-base font-black tracking-tight">Report insights</h2>
            </div>
          </div>
          {loading ? (
            <div className="p-5"><Skeleton className="h-40 w-full" /></div>
          ) : insights.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Insights appear once this period has bills.</p>
          ) : (
            <ul className="space-y-3 p-5">
              {insights.map((ins, i) => (
                <li key={i} className="flex items-start gap-3 rounded-xl border bg-background/60 px-4 py-3">
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${ins.tone === "green" ? "bg-emerald-50 text-emerald-600" : ins.tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600"}`}>
                    {ins.tone === "green" ? <TrendingUp size={14} /> : ins.tone === "amber" ? <AlertTriangle size={14} /> : <FileBarChart size={14} />}
                  </span>
                  <p className="text-sm font-medium leading-snug">{ins.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Money Flow + Sync Status ─────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm lg:col-span-2">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Wallet size={16} /></span>
              <h2 className="font-display text-base font-black tracking-tight">Money flow</h2>
            </div>
          </div>
          {loading ? (
            <div className="p-5"><Skeleton className="h-32 w-full" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
              <MoneyCell label="Sales — cash" value={fmt(snapshot?.paymentBreakdown.cash)} positive />
              <MoneyCell label="Sales — UPI" value={fmt(snapshot?.paymentBreakdown.upi)} positive />
              <MoneyCell label="Total received" value={fmt(selectedTotalReceived)} positive highlight hint={`Incl. old udhar: ${fmt(snapshot?.paymentBreakdown.oldUdharReceived)}`} />
              <MoneyCell label="Supplier cash paid" value={fmt(snapshot?.paymentBreakdown.purchaseCashPaid)} negative />
              <MoneyCell label="Supplier due" value={fmt(snapshot?.paymentBreakdown.purchaseDue)} negative />
              <MoneyCell label="Pending udhar" value={fmt(snapshot?.pendingUdhar)} />
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"><ShieldAlert size={16} /></span>
              <h2 className="font-display text-base font-black tracking-tight">Sync status</h2>
            </div>
          </div>
          {loading ? (
            <div className="p-5"><Skeleton className="h-24 w-full" /></div>
          ) : (
            <div className="divide-y p-1">
              <SyncRow label="Pending backup" count={snapshot?.pendingSyncCount ?? 0} />
              <SyncRow label="Failed sync" count={snapshot?.failedSyncCount ?? 0} critical />
              <SyncRow label="Conflicts" count={snapshot?.conflictCount ?? 0} critical />
              <div className="px-4 py-3">
                <Link href="/sync-status"><Button variant="outline" size="sm" className="w-full rounded-xl">Open sync status</Button></Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Data Tables ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportTable
          title="Top customers"
          icon={<Users size={16} className="text-sky-600" />}
          empty="No customer sales in this period"
          headers={["Customer", "Sales", "Balance", "Bills"]}
          loading={loading}
        >
          {snapshot?.topCustomers.map((row, index) => (
            <tr key={row.customerId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <RankBadge rank={index + 1} />
                  <div>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.mobile || "No mobile"}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <p className="font-bold">{fmt(row.sales)}</p>
                <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted ml-auto">
                  <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.round((row.sales / maxCustomerSales) * 100)}%` }} />
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <span className={row.balance > 0 ? "font-semibold text-amber-600" : "text-muted-foreground"}>{fmt(row.balance)}</span>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.bills}</td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable
          title="Top products"
          icon={<TrendingUp size={16} className="text-emerald-600" />}
          empty="No product sales in this period"
          headers={["Product", "Qty", "Revenue", "Profit"]}
          loading={loading}
        >
          {snapshot?.topProducts.map((row, index) => (
            <tr key={row.productId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <RankBadge rank={index + 1} />
                  <span className="font-semibold">{row.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.quantitySold}</td>
              <td className="px-4 py-3 text-right">
                <p className="font-bold">{fmt(row.revenue)}</p>
                <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted ml-auto">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.round((row.revenue / maxProductRevenue) * 100)}%` }} />
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <span className={row.profitEstimate > 0 ? "font-semibold text-emerald-600" : "text-muted-foreground"}>{fmt(row.profitEstimate)}</span>
              </td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable
          title="Low stock alerts"
          icon={<AlertTriangle size={16} className="text-amber-600" />}
          empty="No low-stock products"
          headers={["Product", "Current stock", "Alert threshold"]}
          loading={loading}
        >
          {snapshot?.lowStock.map((row) => {
            const pct = row.threshold > 0 ? Math.round((row.stock / row.threshold) * 100) : 0;
            return (
              <tr key={row.productId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="font-semibold">{row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.category || "Uncategorised"}</p>
                </td>
                <td className="px-4 py-3 text-right">
                  <div>
                    <span className={cn("font-bold", pct <= 25 ? "text-destructive" : "text-amber-600")}>
                      {row.stock} {row.unit || ""}
                    </span>
                    <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-muted ml-auto">
                      <div className={cn("h-full rounded-full", pct <= 25 ? "bg-destructive" : "bg-amber-400")} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">{row.threshold} {row.unit || ""}</td>
              </tr>
            );
          })}
        </ReportTable>

        <ReportTable
          title="Staff-wise sales"
          icon={<Users size={16} className="text-violet-600" />}
          empty="No staff sales in this period"
          headers={["Staff", "Sales", "Bills"]}
          loading={loading}
        >
          {snapshot?.staffSales.map((row, index) => (
            <tr key={row.staffId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <RankBadge rank={index + 1} tone="violet" />
                  <span className="font-semibold">{row.staffName}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-right font-bold">{fmt(row.sales)}</td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.bills}</td>
            </tr>
          ))}
        </ReportTable>
      </div>

      <OwnerPinModal
        open={exportPinOpen}
        onCancel={() => { if (!exporting) setExportPinOpen(false); }}
        title="Approve data export"
        description="Reports contain sensitive shop data. Owner PIN and reason are required before the export file is generated."
        confirmLabel="Export data"
        reasonRequired
        loading={exporting}
        error={exportError}
        onConfirm={({ ownerPin, reason }) => confirmDataExport(ownerPin, reason)}
      />
    </PageShell>
  );
}

/* ── Local components ────────────────────────────────────────────────────── */

function RankBadge({ rank, tone = "default" }: { rank: number; tone?: "default" | "violet" }) {
  const colors = tone === "violet"
    ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
    : rank === 1 ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black ${colors}`}>
      {rank}
    </span>
  );
}

function MoneyCell({ label, value, positive, negative, highlight, hint }: { label: string; value: string; positive?: boolean; negative?: boolean; highlight?: boolean; hint?: string }) {
  return (
    <div className={cn("bg-card p-4", highlight && "bg-primary/[0.04]")}>
      <p className="app-muted-label">{label}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {positive && <ArrowUpRight size={14} className="shrink-0 text-emerald-500" />}
        {negative && <ArrowDownRight size={14} className="shrink-0 text-orange-500" />}
        <p className={cn(
          "font-display text-lg font-black tabular-nums",
          positive && "text-emerald-700 dark:text-emerald-400",
          negative && "text-orange-600 dark:text-orange-400",
          highlight && "text-primary",
        )}>{value}</p>
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SyncRow({ label, count, critical }: { label: string; count: number; critical?: boolean }) {
  const ok = count === 0;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2.5">
        {ok
          ? <CheckCircle2 size={16} className="text-emerald-500" />
          : critical
            ? <XCircle size={16} className="text-destructive" />
            : <AlertTriangle size={16} className="text-amber-500" />}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-bold",
        ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : critical ? "bg-destructive/10 text-destructive"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      )}>{count}</span>
    </div>
  );
}

function ReportTable({ title, icon, empty, headers, loading, children }: { title: string; icon?: React.ReactNode; empty: string; headers: string[]; loading: boolean; children?: React.ReactNode }) {
  const hasRows = Boolean(children && (!Array.isArray(children) || (children as React.ReactNode[]).filter(Boolean).length > 0));
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b px-5 py-4">
        {icon && <span className="grid h-7 w-7 place-items-center rounded-lg bg-muted">{icon}</span>}
        <h2 className="font-display text-base font-black tracking-tight">{title}</h2>
      </div>
      {loading ? (
        <div className="p-5"><Skeleton className="h-32 w-full" /></div>
      ) : !hasRows ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="text-2xl">—</span>
          <p className="text-sm text-muted-foreground">{empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {headers.map((header, index) => (
                  <th key={header} className={cn("px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground", index === 0 ? "text-left" : "text-right")}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
