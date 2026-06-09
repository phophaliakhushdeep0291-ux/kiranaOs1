import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CalendarDays, Printer, RefreshCw, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { buildDailyClosingReport, toDateInputValue, type DailyClosingReport } from "@/features/reports/local-reporting";

function fmt(value: number | undefined) {
  return "₹" + Math.round(value ?? 0).toLocaleString("en-IN");
}

function printClosing(report: DailyClosingReport) {
  const html = `
    <html><head><title>Daily Closing ${report.date}</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111} h1{font-size:22px;margin:0 0 8px}.muted{color:#666;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}.box{border:1px solid #ddd;padding:10px;border-radius:8px}.label{font-size:12px;color:#666}.value{font-weight:700;font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border-bottom:1px solid #eee;padding:7px;text-align:left}th{text-transform:uppercase;font-size:11px;color:#666}.right{text-align:right}
    </style></head><body>
      <h1>Daily Closing Report</h1><div class="muted">${report.date} • ${report.isLocalEstimate ? "Local estimate" : "Local saved data"}</div>
      <div class="grid">
        <div class="box"><div class="label">Total sales</div><div class="value">${fmt(report.totalSales)}</div></div>
        <div class="box"><div class="label">Cash received</div><div class="value">${fmt(report.cashReceived)}</div></div>
        <div class="box"><div class="label">UPI received</div><div class="value">${fmt(report.upiReceived)}</div></div>
        <div class="box"><div class="label">Udhar given</div><div class="value">${fmt(report.udharGiven)}</div></div>
        <div class="box"><div class="label">Old udhar payment</div><div class="value">${fmt(report.oldUdharPaymentReceived)}</div></div>
        <div class="box"><div class="label">Supplier paid</div><div class="value">${fmt(report.purchasePaid)}</div></div>
        <div class="box"><div class="label">Supplier due</div><div class="value">${fmt(report.purchaseDue)}</div></div>
        <div class="box"><div class="label">Expected cash in drawer</div><div class="value">${fmt(report.expectedCashInDrawer)}</div></div>
        <div class="box"><div class="label">Expected UPI/bank net</div><div class="value">${fmt(report.expectedUpiInBank)}</div></div>
      </div>
      <h2>Top sold products</h2><table><tr><th>Product</th><th class="right">Qty</th><th class="right">Sales</th></tr>${report.topSoldProducts.map((p) => `<tr><td>${p.name}</td><td class="right">${p.quantitySold}</td><td class="right">${fmt(p.revenue)}</td></tr>`).join("") || "<tr><td colspan='3'>No product sales</td></tr>"}</table>
      <h2>Low-stock items</h2><table><tr><th>Product</th><th class="right">Stock</th><th class="right">Alert</th></tr>${report.lowStockItems.map((p) => `<tr><td>${p.name}</td><td class="right">${p.stock} ${p.unit ?? ""}</td><td class="right">${p.threshold}</td></tr>`).join("") || "<tr><td colspan='3'>No low-stock items</td></tr>"}</table>
    </body></html>`;
  const win = window.open("", "_blank", "width=820,height=720");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export default function DailyClosingPage() {
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [report, setReport] = useState<DailyClosingReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setReport(await buildDailyClosingReport(date));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [date]);

  return (
    <div className="p-6 w-full max-w-none space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Daily Closing</h1>
          <p className="text-sm text-muted-foreground mt-1">Cash drawer and daily business summary from local IndexedDB.</p>
          {report?.isLocalEstimate && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Local estimate — {report.pendingSyncCount} changes pending cloud backup. Billing still works.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/reports"><Button variant="outline">Back to reports</Button></Link>
          <Button variant="outline" onClick={() => report && printClosing(report)} disabled={!report}><Printer size={16} className="mr-2" /> Print</Button>
          <Button onClick={load} disabled={loading}><RefreshCw size={16} className="mr-2" /> Refresh</Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 w-full sm:w-72">
        <Label className="text-xs text-muted-foreground">Closing date</Label>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <ClosingCard title="Total sales" value={fmt(report?.totalSales)} loading={loading} />
        <ClosingCard title="Cash received" value={fmt(report?.cashReceived)} loading={loading} />
        <ClosingCard title="UPI received" value={fmt(report?.upiReceived)} loading={loading} />
        <ClosingCard title="Udhar given" value={fmt(report?.udharGiven)} loading={loading} />
        <ClosingCard title="Old udhar payment received" value={fmt(report?.oldUdharPaymentReceived)} loading={loading} />
        <ClosingCard title="Supplier paid" value={fmt(report?.purchasePaid)} loading={loading} />
        <ClosingCard title="Supplier due" value={fmt(report?.purchaseDue)} loading={loading} />
        <ClosingCard title="Expected cash in drawer" value={fmt(report?.expectedCashInDrawer)} loading={loading} important />
        <ClosingCard title="Expected UPI/bank net" value={fmt(report?.expectedUpiInBank)} loading={loading} />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2"><Wallet size={18} /> Drawer check</h2>
        <p className="text-sm text-muted-foreground mt-2">Expected cash now means cash sales + customer udhar cash recovery - supplier purchase cash paid today. Opening cash, owner withdrawal, rent, salary and other expenses are not guessed yet.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TableCard title="Top sold products" empty="No product sales for this date" loading={loading} headers={["Product", "Qty", "Sales"]}>
          {report?.topSoldProducts.map((row) => (
            <tr key={row.productId} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2 text-right">{row.quantitySold}</td><td className="px-3 py-2 text-right font-medium">{fmt(row.revenue)}</td></tr>
          ))}
        </TableCard>
        <TableCard title="Low-stock items" empty="No low-stock items" loading={loading} headers={["Product", "Stock", "Alert"]}>
          {report?.lowStockItems.map((row) => (
            <tr key={row.productId} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2 text-right text-destructive">{row.stock} {row.unit ?? ""}</td><td className="px-3 py-2 text-right">{row.threshold}</td></tr>
          ))}
        </TableCard>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2"><AlertTriangle size={18} /> Sync check before closing</h2>
        {loading ? <Skeleton className="h-16 w-full mt-3" /> : (
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border p-3"><div className="text-muted-foreground">Pending</div><Badge variant={report?.pendingSyncCount ? "secondary" : "outline"}>{report?.pendingSyncCount ?? 0}</Badge></div>
            <div className="rounded-lg border p-3"><div className="text-muted-foreground">Failed</div><Badge variant={report?.failedSyncCount ? "destructive" : "outline"}>{report?.failedSyncCount ?? 0}</Badge></div>
            <div className="rounded-lg border p-3"><div className="text-muted-foreground">Conflicts</div><Badge variant={report?.conflictCount ? "destructive" : "outline"}>{report?.conflictCount ?? 0}</Badge></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ClosingCard({ title, value, loading, important }: { title: string; value: string; loading: boolean; important?: boolean }) {
  return <div className={`rounded-xl border bg-card p-4 ${important ? "ring-1 ring-primary/30" : ""}`}><p className="text-xs text-muted-foreground uppercase tracking-wide">{title}</p>{loading ? <Skeleton className="h-8 w-28 mt-2" /> : <p className="text-2xl font-bold mt-1">{value}</p>}</div>;
}

function TableCard({ title, empty, headers, loading, children }: { title: string; empty: string; headers: string[]; loading: boolean; children?: React.ReactNode }) {
  const hasRows = Boolean(children && (!Array.isArray(children) || children.length > 0));
  return <div className="rounded-xl border bg-card overflow-hidden"><div className="px-4 py-3 border-b font-semibold">{title}</div>{loading ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : !hasRows ? <div className="p-8 text-sm text-center text-muted-foreground">{empty}</div> : <table className="w-full text-sm"><thead className="bg-muted/60"><tr>{headers.map((header, index) => <th key={header} className={`px-3 py-2 font-medium text-muted-foreground ${index === 0 ? "text-left" : "text-right"}`}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table>}</div>;
}
