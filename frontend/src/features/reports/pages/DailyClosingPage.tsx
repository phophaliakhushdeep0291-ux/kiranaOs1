import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, CreditCard, MessageCircle, Printer, RefreshCw, ShieldAlert, TrendingUp, Wallet, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { buildDailyClosingReport, toDateInputValue, type DailyClosingReport } from "@/features/reports/local-reporting";
import { shareDailyClosingOnWhatsapp } from "@/features/reports/daily-summary-share";
import { useAuth } from "@/features/auth/useAuth";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { cn } from "@/lib/utils";

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
        <div class="box"><div class="label">Cash in (sales + old udhar)</div><div class="value">${fmt(report.cashReceived)}</div></div>
        <div class="box"><div class="label">UPI/bank in (sales + old udhar)</div><div class="value">${fmt(report.upiReceived)}</div></div>
        <div class="box"><div class="label">Udhar given</div><div class="value">${fmt(report.udharGiven)}</div></div>
        <div class="box"><div class="label">Old udhar payment</div><div class="value">${fmt(report.oldUdharPaymentReceived)}</div></div>
        <div class="box"><div class="label">Supplier cash paid</div><div class="value">${fmt(report.purchaseCashPaid)}</div></div>
        <div class="box"><div class="label">Supplier UPI/bank paid</div><div class="value">${fmt(report.purchaseUpiPaid)}</div></div>
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
  const { shop } = useAuth();
  const { prefs } = useSettingsPrefs();
  // Settings → Notifications → Daily Summary controls which sections the shared summary includes.
  const notif = (prefs.notifications ?? {}) as { dailySales?: boolean; dailyProfit?: boolean; dailyCashUpi?: boolean; dailyUdhar?: boolean };
  const summaryInclude = {
    sales: notif.dailySales !== false,
    profit: notif.dailyProfit !== false,
    cashUpi: notif.dailyCashUpi !== false,
    udhar: notif.dailyUdhar !== false,
  };
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [report, setReport] = useState<DailyClosingReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setReport(await buildDailyClosingReport(date)); }
    finally { setLoading(false); }
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

  const totalIncomingTender = (report?.cashReceived ?? 0) + (report?.upiReceived ?? 0);
  const cashPct = totalIncomingTender > 0 ? Math.round(((report?.cashReceived ?? 0) / totalIncomingTender) * 100) : 0;
  const upiPct = totalIncomingTender > 0 ? Math.round(((report?.upiReceived ?? 0) / totalIncomingTender) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-5 lg:p-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays size={20} />
            </span>
            <div>
              <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">Daily Closing</h1>
              <p className="text-sm text-muted-foreground">Cash drawer and business summary from local data.</p>
            </div>
          </div>
          {report?.isLocalEstimate && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle size={15} className="shrink-0" />
              Local estimate — {report.pendingSyncCount} changes pending cloud backup.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/reports"><Button variant="outline" className="rounded-xl"><CalendarDays size={15} className="mr-1.5" />Reports</Button></Link>
          <Button variant="outline" className="rounded-xl" onClick={() => report && printClosing(report)} disabled={!report}><Printer size={15} className="mr-1.5" />Print</Button>
          <Button variant="outline" className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => report && shareDailyClosingOnWhatsapp({ report, shopName: shop?.name, include: summaryInclude })} disabled={!report}><MessageCircle size={15} className="mr-1.5" />Share</Button>
          <Button onClick={load} disabled={loading} className="rounded-xl"><RefreshCw size={15} className="mr-1.5" />Refresh</Button>
        </div>
      </div>

      {/* ── Date picker ─────────────────────────────────────────────────── */}
      <div className="flex items-end gap-4">
        <div className="w-full max-w-xs space-y-1.5">
          <Label className="app-muted-label">Closing date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-xl" />
        </div>
      </div>

      {/* ── Hero: Expected Cash in Drawer ───────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border-2 border-primary/25 bg-card shadow-md">
        <div className="border-b border-primary/15 bg-primary/[0.04] px-5 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-primary" />
            <p className="app-muted-label text-primary/80">Expected cash in drawer tonight</p>
          </div>
        </div>
        <div className="grid gap-0 lg:grid-cols-[1fr_1px_0.9fr]">
          <div className="p-5 sm:p-6">
            {loading ? (
              <Skeleton className="h-16 w-48" />
            ) : (
              <>
                <p className="font-display text-5xl font-black tracking-tight text-foreground tabular-nums sm:text-6xl">
                  {fmt(report?.expectedCashInDrawer)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Cash sales + old udhar cash recovery - supplier cash paid
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <ArrowUpRight size={13} />Cash in {fmt(report?.cashReceived)}
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-sky-200/60 dark:bg-sky-950/40 dark:text-sky-300">
                    <CreditCard size={13} />UPI/bank in {fmt(report?.upiReceived)}
                  </span>
                  {(report?.purchaseCashPaid ?? 0) > 0 && (
                    <span className="flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 ring-1 ring-orange-200/60 dark:bg-orange-950/40 dark:text-orange-300">
                      <ArrowDownRight size={13} />Supplier cash -{fmt(report?.purchaseCashPaid)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="hidden lg:block bg-border" />
          <div className="border-t p-5 sm:p-6 lg:border-t-0">
            <p className="app-muted-label">Cash vs UPI split</p>
            {loading ? (
              <Skeleton className="mt-3 h-24 w-full" />
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">Cash in</span>
                    <span className="font-black tabular-nums">{fmt(report?.cashReceived)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${cashPct}%` }} />
                  </div>
                  <p className="mt-0.5 text-right text-[11px] text-muted-foreground">{cashPct}%</p>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-sky-700 dark:text-sky-400">UPI/bank in</span>
                    <span className="font-black tabular-nums">{fmt(report?.upiReceived)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${upiPct}%` }} />
                  </div>
                  <p className="mt-0.5 text-right text-[11px] text-muted-foreground">{upiPct}%</p>
                </div>
                {(report?.oldUdharPaymentReceived ?? 0) > 0 && (
                  <div className="rounded-xl border bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
                    <span className="text-muted-foreground">Old udhar recovered </span>
                    <span className="font-bold text-amber-700 dark:text-amber-400">{fmt(report?.oldUdharPaymentReceived)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Income & Outgoing Flow ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Income */}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <TrendingUp size={16} />
              </span>
              <div>
                <h2 className="font-display text-base font-black tracking-tight">Income today</h2>
                <p className="text-[11px] text-muted-foreground">Everything that came in</p>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="p-5"><Skeleton className="h-40 w-full" /></div>
          ) : (
            <div className="divide-y">
              <FlowRow
                label="Total sales"
                value={fmt(report?.totalSales)}
                direction="in"
                highlight
                hint="All bills for the day"
              />
              <FlowRow label="Cash sales" value={fmt(report?.cashSales)} direction="in" />
              <FlowRow label="UPI / digital sales" value={fmt(report?.upiSales)} direction="in" />
              <FlowRow
                label="Old udhar recovered"
                value={fmt(report?.oldUdharPaymentReceived)}
                direction="in"
                hint={`Cash ${fmt(report?.oldUdharCashReceived)} / UPI ${fmt(report?.oldUdharUpiReceived)}`}
              />
            </div>
          )}
        </div>

        {/* Outgoing */}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                <ArrowDownRight size={16} />
              </span>
              <div>
                <h2 className="font-display text-base font-black tracking-tight">Credit & outgoing</h2>
                <p className="text-[11px] text-muted-foreground">What went out or remains due</p>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="p-5"><Skeleton className="h-40 w-full" /></div>
          ) : (
            <div className="divide-y">
              <FlowRow
                label="Udhar given today"
                value={fmt(report?.udharGiven)}
                direction="out"
                hint="Credit extended to customers"
              />
              <FlowRow label="Supplier cash paid" value={fmt(report?.purchaseCashPaid)} direction="out" />
              <FlowRow label="Supplier UPI/bank paid" value={fmt(report?.purchaseUpiPaid)} direction="out" />
              <FlowRow
                label="Supplier due (unpaid)"
                value={fmt(report?.purchaseDue)}
                direction="pending"
                hint="Purchase bills not yet paid"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Tables: Top products + Low stock ────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ClosingTable title="Top sold products" icon={<TrendingUp size={15} className="text-emerald-600" />} empty="No product sales for this date" loading={loading} headers={["Product", "Qty", "Sales"]}>
          {report?.topSoldProducts.map((row, index) => (
            <tr key={row.productId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black", index === 0 ? "bg-amber-50 text-amber-700" : "bg-muted text-muted-foreground")}>{index + 1}</span>
                  <span className="font-semibold">{row.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.quantitySold}</td>
              <td className="px-4 py-3 text-right font-bold">{fmt(row.revenue)}</td>
            </tr>
          ))}
        </ClosingTable>

        <ClosingTable title="Low-stock items" icon={<AlertTriangle size={15} className="text-amber-600" />} empty="No low-stock items" loading={loading} headers={["Product", "Stock", "Alert"]}>
          {report?.lowStockItems.map((row) => (
            <tr key={row.productId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 font-semibold">{row.name}</td>
              <td className="px-4 py-3 text-right font-bold text-destructive">{row.stock} {row.unit ?? ""}</td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.threshold}</td>
            </tr>
          ))}
        </ClosingTable>
      </div>

      {/* ── Sync check ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              <ShieldAlert size={16} />
            </span>
            <div>
              <h2 className="font-display text-base font-black tracking-tight">Sync check before closing</h2>
              <p className="text-[11px] text-muted-foreground">Ensure all data is backed up to the cloud</p>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="p-5"><Skeleton className="h-16 w-full" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-px bg-border">
            <SyncCell label="Pending backup" count={report?.pendingSyncCount ?? 0} />
            <SyncCell label="Failed sync" count={report?.failedSyncCount ?? 0} critical />
            <SyncCell label="Conflicts" count={report?.conflictCount ?? 0} critical />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Local components ────────────────────────────────────────────────────── */

function FlowRow({ label, value, direction, hint, highlight }: { label: string; value: string; direction: "in" | "out" | "pending"; hint?: string; highlight?: boolean }) {
  const dirIcon = direction === "in"
    ? <ArrowUpRight size={15} className="text-emerald-500" />
    : direction === "out"
      ? <ArrowDownRight size={15} className="text-orange-500" />
      : <span className="h-3.5 w-3.5 rounded-full border-2 border-amber-400" />;
  const valueColor = direction === "in" ? "text-emerald-700 dark:text-emerald-400" : direction === "out" ? "text-orange-600 dark:text-orange-400" : "text-amber-600 dark:text-amber-400";
  return (
    <div className={cn("flex items-center justify-between gap-4 px-5 py-3.5", highlight && "bg-primary/[0.04]")}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0">{dirIcon}</span>
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold", highlight && "font-black")}>{label}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <p className={cn("font-display shrink-0 font-black tabular-nums", highlight ? "text-xl text-foreground" : `text-base ${valueColor}`)}>{value}</p>
    </div>
  );
}

function SyncCell({ label, count, critical }: { label: string; count: number; critical?: boolean }) {
  const ok = count === 0;
  return (
    <div className="flex flex-col items-center gap-1.5 bg-card p-5 text-center">
      {ok
        ? <CheckCircle2 size={22} className="text-emerald-500" />
        : critical
          ? <XCircle size={22} className="text-destructive" />
          : <AlertTriangle size={22} className="text-amber-500" />}
      <p className={cn("font-display text-2xl font-black tabular-nums", ok ? "text-emerald-600" : critical ? "text-destructive" : "text-amber-600")}>{count}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ClosingTable({ title, icon, empty, headers, loading, children }: { title: string; icon?: React.ReactNode; empty: string; headers: string[]; loading: boolean; children?: React.ReactNode }) {
  const hasRows = Boolean(children && (!Array.isArray(children) || (children as React.ReactNode[]).filter(Boolean).length > 0));
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b px-5 py-4">
        {icon && <span className="grid h-7 w-7 place-items-center rounded-lg bg-muted">{icon}</span>}
        <h2 className="font-display text-base font-black tracking-tight">{title}</h2>
      </div>
      {loading ? (
        <div className="p-5"><Skeleton className="h-28 w-full" /></div>
      ) : !hasRows ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {headers.map((header, index) => (
                <th key={header} className={cn("px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground", index === 0 ? "text-left" : "text-right")}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  );
}
