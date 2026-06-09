import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { CalendarDays, Database, Download, FileBarChart, RefreshCw, TrendingUp, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { buildLocalReportSnapshot, toDateInputValue, type LocalReportSnapshot } from "@/features/reports/local-reporting";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { recordDataExportLocalFirst } from "@/features/reports/local-actions";
import { FilterBar, PageHeader, PageShell, SyncBadge } from "@/components/shared";

function fmt(value: number | undefined) {
  return "Rs " + Math.round(value ?? 0).toLocaleString("en-IN");
}

function todayInput() {
  return toDateInputValue(new Date());
}

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

  const quickRanges = useMemo(() => [
    { label: "Today", from: todayInput(), to: todayInput() },
    { label: "7 days", from: daysAgoInput(6), to: todayInput() },
    { label: "30 days", from: daysAgoInput(29), to: todayInput() },
  ], []);

  const selected = snapshot?.selected;
  const selectedCashCollected = snapshot?.paymentBreakdown.netCashInHand ?? 0;
  const selectedTotalReceived = (snapshot?.paymentBreakdown.cashIn ?? 0) + (snapshot?.paymentBreakdown.upiIn ?? 0);

  async function confirmDataExport(ownerPin: string, reason: string) {
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
      const payload = JSON.stringify({ exportedAt: new Date().toISOString(), from: range.from, to: range.to, snapshot }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kirana-report-${range.from}-to-${range.to}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportPinOpen(false);
      toast({ title: "Report exported", description: "Owner approval was saved in the audit log and queued for sync." });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Owner PIN is required to export data.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageShell className="space-y-5 sm:space-y-6">
      <PageHeader
        title="Reports"
        description={`${rangeLabel} owner report with sales, cash, udhar, stock, and staff performance.`}
        eyebrow={snapshot?.hasUnsyncedOperations ? <SyncBadge status="estimate" label={`Local estimate - ${snapshot.pendingSyncCount} pending, ${snapshot.failedSyncCount} failed, ${snapshot.conflictCount} conflict`} /> : <span className="inline-flex items-center gap-2"><Database size={16} /> Calculated from saved local data</span>}
        actions={(
          <>
            <Link href="/daily-closing"><Button variant="outline" className="w-full sm:w-auto"><CalendarDays size={16} className="mr-2" /> Daily closing</Button></Link>
            <Button onClick={loadReports} disabled={loading} className="w-full sm:w-auto"><RefreshCw size={16} className="mr-2" /> Refresh</Button>
          </>
        )}
      />

      <FilterBar actions={<Button variant="outline" className="h-10 w-full sm:w-auto" disabled={loading || !snapshot} onClick={() => { setExportError(null); setExportPinOpen(true); }}><Download size={16} className="mr-1.5" />Export</Button>}>
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-auto">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">From</Label>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-lg" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To</Label>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-lg" />
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 lg:flex lg:w-auto lg:justify-end">
          {quickRanges.map((item) => (
            <Button key={item.label} className="h-10 px-3" variant={range.from === item.from && range.to === item.to ? "default" : "outline"} onClick={() => { setFrom(item.from); setTo(item.to); }}>
              {item.label}
            </Button>
          ))}
        </div>
      </FilterBar>

      <div className="rounded-lg border bg-card/80 p-3 sm:p-4">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected report</p>
            <h2 className="text-lg font-semibold">{rangeLabel}</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Sales" value={fmt(selected?.sales)} sub={`${selected?.bills ?? 0} bills in this period`} icon={<TrendingUp size={18} />} loading={loading} />
          <MetricCard title="Profit estimate" value={fmt(selected?.profitEstimate)} sub="Saved bill profit/product cost" icon={<FileBarChart size={18} />} loading={loading} />
          <MetricCard title="Udhar sales" value={fmt(selected?.udharSales)} sub="Credit given in this period" icon={<Users size={18} />} loading={loading} />
          <MetricCard title="Cash in hand" value={fmt(selectedCashCollected)} sub={`Cash/udhar cash received minus supplier cash paid`} icon={<Wallet size={18} />} loading={loading} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Money flow</h2>
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SmallStat label="Sales cash" value={fmt(snapshot?.paymentBreakdown.cash)} />
              <SmallStat label="Sales UPI" value={fmt(snapshot?.paymentBreakdown.upi)} />
              <SmallStat label="Total received" value={fmt(selectedTotalReceived)} hint={`Old udhar: ${fmt(snapshot?.paymentBreakdown.oldUdharReceived)}`} />
              <SmallStat label="Supplier cash paid" value={fmt(snapshot?.paymentBreakdown.purchaseCashPaid)} />
              <SmallStat label="Supplier due" value={fmt(snapshot?.paymentBreakdown.purchaseDue)} />
              <SmallStat label="Pending udhar" value={fmt(snapshot?.pendingUdhar)} />
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 font-semibold">Backup status</h2>
          {loading ? <Skeleton className="h-28 w-full" /> : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span>Pending cloud backup</span><Badge variant={snapshot?.pendingSyncCount ? "secondary" : "outline"}>{snapshot?.pendingSyncCount ?? 0}</Badge></div>
              <div className="flex items-center justify-between"><span>Failed sync</span><Badge variant={snapshot?.failedSyncCount ? "destructive" : "outline"}>{snapshot?.failedSyncCount ?? 0}</Badge></div>
              <div className="flex items-center justify-between"><span>Conflicts</span><Badge variant={snapshot?.conflictCount ? "destructive" : "outline"}>{snapshot?.conflictCount ?? 0}</Badge></div>
              <Link href="/sync-status"><Button variant="outline" size="sm" className="mt-2 w-full">Open sync status</Button></Link>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportTable title="Top customers" empty="No customer sales in this period" headers={["Customer", "Sales", "Balance", "Bills"]} loading={loading}>
          {snapshot?.topCustomers.map((row) => (
            <tr key={row.customerId} className="border-b last:border-0">
              <td className="px-3 py-2"><div className="font-medium">{row.name}</div><div className="text-xs text-muted-foreground">{row.mobile || "No mobile"}</div></td>
              <td className="px-3 py-2 text-right font-medium">{fmt(row.sales)}</td>
              <td className="px-3 py-2 text-right">{fmt(row.balance)}</td>
              <td className="px-3 py-2 text-right">{row.bills}</td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable title="Top products" empty="No product sales in this period" headers={["Product", "Qty", "Revenue", "Profit"]} loading={loading}>
          {snapshot?.topProducts.map((row) => (
            <tr key={row.productId} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{row.name}</td>
              <td className="px-3 py-2 text-right">{row.quantitySold}</td>
              <td className="px-3 py-2 text-right font-medium">{fmt(row.revenue)}</td>
              <td className="px-3 py-2 text-right">{fmt(row.profitEstimate)}</td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable title="Low stock" empty="No low-stock products" headers={["Product", "Stock", "Threshold"]} loading={loading}>
          {snapshot?.lowStock.map((row) => (
            <tr key={row.productId} className="border-b last:border-0">
              <td className="px-3 py-2"><div className="font-medium">{row.name}</div><div className="text-xs text-muted-foreground">{row.category || "Uncategorised"}</div></td>
              <td className="px-3 py-2 text-right font-medium text-destructive">{row.stock} {row.unit || ""}</td>
              <td className="px-3 py-2 text-right">{row.threshold} {row.unit || ""}</td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable title="Staff-wise sales" empty="No staff sales in this period" headers={["Staff", "Sales", "Bills"]} loading={loading}>
          {snapshot?.staffSales.map((row) => (
            <tr key={row.staffId} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{row.staffName}</td>
              <td className="px-3 py-2 text-right font-medium">{fmt(row.sales)}</td>
              <td className="px-3 py-2 text-right">{row.bills}</td>
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

function MetricCard({ title, value, sub, icon, loading }: { title: string; value: string; sub: string; icon: React.ReactNode; loading: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-wide text-muted-foreground"><span>{title}</span><span className="text-primary">{icon}</span></div>
      {loading ? <Skeleton className="h-7 w-28" /> : <p className="text-xl font-bold sm:text-2xl">{value}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function SmallStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p>{hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}</div>;
}

function ReportTable({ title, empty, headers, loading, children }: { title: string; empty: string; headers: string[]; loading: boolean; children?: React.ReactNode }) {
  const hasRows = Boolean(children && (!Array.isArray(children) || children.length > 0));
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-4 py-3 font-semibold">{title}</div>
      {loading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : !hasRows ? <div className="p-8 text-center text-sm text-muted-foreground">{empty}</div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/60"><tr>{headers.map((header, index) => <th key={header} className={`px-3 py-2 font-medium text-muted-foreground ${index === 0 ? "text-left" : "text-right"}`}>{header}</th>)}</tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
