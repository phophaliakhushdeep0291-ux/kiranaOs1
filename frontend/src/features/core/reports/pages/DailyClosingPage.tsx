import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, CreditCard, MessageCircle, Printer, RefreshCw, ShieldAlert, TrendingUp, Wallet, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { buildDailyClosingReport, toDateInputValue, type DailyClosingReport } from "@/features/core/reports/local-reporting";
import { buildDrawerCount, loadDrawerCounts, saveDrawerCount, type DrawerCount } from "@/features/core/reports/drawer-counts";
import {
  buildCashMovement,
  buildOpeningFloat,
  loadCashMovements,
  loadDrawerAdjustments,
  loadOpeningFloats,
  openingFloatFor,
  removeCashMovement,
  saveCashMovement,
  saveOpeningFloat,
  type CashMovement,
  type CashMovementKind,
  type OpeningFloat,
} from "@/features/core/reports/cash-drawer";
import { listExpenses } from "@/features/core/expenses/api";
import { shareDailyClosingOnWhatsapp } from "@/features/core/reports/daily-summary-share";
import { useAuth } from "@/features/core/auth/useAuth";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { cn } from "@/lib/utils";
import { useReportView } from "@/lib/activity";
import { escapeHtml } from "@/lib/escape-html";

function fmt(value: number | undefined) {
  return "₹" + Math.round(value ?? 0).toLocaleString("en-IN");
}

function printClosing(report: DailyClosingReport) {
  const html = `
    <html><head><title>Daily Closing ${report.date}</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111} h1{font-size:22px;margin:0 0 8px}.muted{color:#666;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}.box{border:1px solid #ddd;padding:10px;border-radius:8px}.label{font-size:12px;color:#666}.value{font-weight:700;font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border-bottom:1px solid #eee;padding:7px;text-align:left}th{text-transform:uppercase;font-size:11px;color:#666}.right{text-align:right}
    </style></head><body>
      <h1>Daily Closing Report</h1><div class="muted">${escapeHtml(report.date)} • ${report.isLocalEstimate ? "Local estimate" : "Local saved data"}</div>
      <div class="grid">
        <div class="box"><div class="label">Total sales</div><div class="value">${fmt(report.totalSales)}</div></div>
        <div class="box"><div class="label">Cash in (sales + old udhar)</div><div class="value">${fmt(report.cashReceived)}</div></div>
        <div class="box"><div class="label">UPI in (sales + old udhar)</div><div class="value">${fmt(report.upiReceived)}</div></div>
        <div class="box"><div class="label">Bank in (sales + old udhar)</div><div class="value">${fmt(report.bankReceived)}</div></div>
        <div class="box"><div class="label">Udhar given</div><div class="value">${fmt(report.udharGiven)}</div></div>
        <div class="box"><div class="label">Old udhar payment</div><div class="value">${fmt(report.oldUdharPaymentReceived)}</div></div>
        <div class="box"><div class="label">Supplier cash paid</div><div class="value">${fmt(report.purchaseCashPaid)}</div></div>
        <div class="box"><div class="label">Supplier UPI paid</div><div class="value">${fmt(report.purchaseUpiPaid)}</div></div>
        <div class="box"><div class="label">Supplier bank paid</div><div class="value">${fmt(report.purchaseBankPaid)}</div></div>
        <div class="box"><div class="label">Supplier due</div><div class="value">${fmt(report.purchaseDue)}</div></div>
        <div class="box"><div class="label">Expected cash in drawer</div><div class="value">${fmt(report.expectedCashInDrawer)}</div></div>
        <div class="box"><div class="label">Expected UPI net</div><div class="value">${fmt(report.expectedUpiInBank)}</div></div>
        <div class="box"><div class="label">Expected bank net</div><div class="value">${fmt(report.expectedBankInBank)}</div></div>
      </div>
      <h2>Top sold products</h2><table><tr><th>Product</th><th class="right">Qty</th><th class="right">Sales</th></tr>${report.topSoldProducts.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td class="right">${escapeHtml(p.quantitySold)}</td><td class="right">${escapeHtml(fmt(p.revenue))}</td></tr>`).join("") || "<tr><td colspan='3'>No product sales</td></tr>"}</table>
      <h2>Low-stock items</h2><table><tr><th>Product</th><th class="right">Stock</th><th class="right">Alert</th></tr>${report.lowStockItems.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td class="right">${escapeHtml(p.stock)} ${escapeHtml(p.unit)}</td><td class="right">${escapeHtml(p.threshold)}</td></tr>`).join("") || "<tr><td colspan='3'>No low-stock items</td></tr>"}</table>
    </body></html>`;
  const win = window.open("", "_blank", "width=820,height=720");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export default function DailyClosingPage() {
  useReportView("daily_closing", "Daily closing");
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
  // Only CASH expenses leave the till. A UPI or bank expense never touches the drawer,
  // so counting it here would report a phantom short. Offline the call fails and the
  // total stays 0 — the float and movements still apply.
  async function loadCashExpenseTotal(forDate: string): Promise<number> {
    try {
      const rows = await listExpenses({ from: forDate, to: forDate });
      return (rows ?? [])
        .filter((row) => String((row as { paymentMode?: string }).paymentMode ?? "cash").toLowerCase() === "cash")
        .filter((row) => !(row as { deletedAt?: string | null }).deletedAt)
        .reduce((sum, row) => sum + (Number((row as { amount?: number }).amount) || 0), 0);
    } catch {
      return 0;
    }
  }

  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [report, setReport] = useState<DailyClosingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerCounts, setDrawerCounts] = useState<DrawerCount[]>([]);
  const [countedDraft, setCountedDraft] = useState("");
  const [savingCount, setSavingCount] = useState(false);
  const [openingFloats, setOpeningFloats] = useState<OpeningFloat[]>([]);
  const [floatDraft, setFloatDraft] = useState("");
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [movementAmount, setMovementAmount] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [cashExpenses, setCashExpenses] = useState(0);
  const reportRef = useRef<DailyClosingReport | null>(null);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  const load = useCallback(async (options?: { showLoader?: boolean }) => {
    const showLoader = options?.showLoader ?? !reportRef.current;
    if (showLoader) setLoading(true);
    try {
      // The float and till movements live on this device; cash expenses are server-backed,
      // so they are fetched and handed to the same drawer calculation.
      const [drawer, expenseCash] = await Promise.all([
        loadDrawerAdjustments(date),
        loadCashExpenseTotal(date),
      ]);
      setCashExpenses(expenseCash);
      setReport(await buildDailyClosingReport(date, { ...drawer, cashExpenses: expenseCash }));
    }
    finally { if (showLoader) setLoading(false); }
  }, [date]);

  useEffect(() => {
    void load({ showLoader: !reportRef.current });
    const refresh = () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        void load({ showLoader: false });
      }, 220);
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
  }, [load]);

  useEffect(() => {
    void loadDrawerCounts().then(setDrawerCounts);
    void loadOpeningFloats().then(setOpeningFloats);
    void loadCashMovements().then(setCashMovements);
  }, []);

  // Re-prime the float box when the date changes; typing must not be overwritten.
  useEffect(() => {
    const declared = openingFloats.find((row) => row.date === date);
    setFloatDraft(declared ? String(declared.amount) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const declaredFloat = openingFloatFor(openingFloats, date);
  const movementsForDate = cashMovements.filter((row) => row.date === date);

  async function saveFloatForDate() {
    const amount = Number(floatDraft);
    if (floatDraft.trim() === "" || !Number.isFinite(amount) || amount < 0) return;
    setOpeningFloats(await saveOpeningFloat(buildOpeningFloat(date, amount)));
    await load({ showLoader: false });
  }

  async function addCashMovement(kind: CashMovementKind) {
    const amount = Number(movementAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setCashMovements(await saveCashMovement(buildCashMovement(date, kind, amount, movementNote)));
    setMovementAmount("");
    setMovementNote("");
    await load({ showLoader: false });
  }

  async function deleteCashMovement(id: string) {
    setCashMovements(await removeCashMovement(id));
    await load({ showLoader: false });
  }

  // Prefill the count input when switching to a date that was already counted.
  useEffect(() => {
    const existing = drawerCounts.find((row) => row.date === date);
    setCountedDraft(existing ? String(existing.countedCash) : "");
    // Only re-prime when the date changes — typing must not be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const savedCountForDate = drawerCounts.find((row) => row.date === date);
  const countedValue = Number(countedDraft);
  const liveVariance = countedDraft.trim() !== "" && Number.isFinite(countedValue) && report
    ? Math.round((countedValue - report.expectedCashInDrawer) * 100) / 100
    : null;

  async function saveDrawerCountForDate() {
    if (!report || countedDraft.trim() === "" || !Number.isFinite(countedValue) || countedValue < 0) return;
    setSavingCount(true);
    try {
      setDrawerCounts(await saveDrawerCount(buildDrawerCount(date, report.expectedCashInDrawer, countedValue)));
    } finally {
      setSavingCount(false);
    }
  }

  const totalIncomingTender = (report?.cashReceived ?? 0) + (report?.upiReceived ?? 0) + (report?.bankReceived ?? 0);
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
        <div className="grid grid-cols-4 gap-2 lg:flex lg:flex-wrap">
          <Button asChild variant="outline" className="h-11 min-w-0 rounded-xl px-1.5 text-xs sm:px-4 sm:text-sm">
            <Link href="/reports"><CalendarDays size={15} className="mr-1 sm:mr-1.5" />Reports</Link>
          </Button>
          <Button variant="outline" className="h-11 min-w-0 rounded-xl px-1.5 text-xs sm:px-4 sm:text-sm" onClick={() => report && printClosing(report)} disabled={!report}><Printer size={15} className="mr-1 sm:mr-1.5" />Print</Button>
          <Button variant="outline" className="h-11 min-w-0 rounded-xl border-emerald-200 px-1.5 text-xs text-emerald-700 hover:bg-emerald-50 sm:px-4 sm:text-sm" onClick={() => report && shareDailyClosingOnWhatsapp({ report, shopName: shop?.name, include: summaryInclude })} disabled={!report}><MessageCircle size={15} className="mr-1 sm:mr-1.5" />Share</Button>
          <Button onClick={() => void load({ showLoader: !reportRef.current })} disabled={loading && !report} className="h-11 min-w-0 rounded-xl px-1.5 text-xs sm:px-4 sm:text-sm"><RefreshCw size={15} className="mr-1 sm:mr-1.5" />Refresh</Button>
        </div>
      </div>

      {/* ── Date picker ─────────────────────────────────────────────────── */}
      <div className="flex items-end gap-4">
        <div className="w-full max-w-xs space-y-1.5">
          <Label className="app-muted-label">Closing date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl" />
        </div>
      </div>

      {/* ── Hero: Expected Cash in Drawer ───────────────────────────────── */}
      <div data-testid="daily-closing-cash-hero" className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-lg shadow-primary/10">
        <div className="border-b border-white/15 bg-gradient-to-r from-primary via-blue-600 to-indigo-700 px-5 py-3 text-white sm:px-6">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-white/85" />
            <p className="app-muted-label text-white/80">Expected cash in drawer tonight</p>
          </div>
        </div>
        <div className="grid gap-0 lg:grid-cols-[1fr_1px_0.9fr]">
          <div className="bg-gradient-to-br from-primary via-blue-600 to-indigo-700 p-5 text-white sm:p-6">
            {loading ? (
              <Skeleton className="h-16 w-48" />
            ) : (
              <>
                <p className="break-words font-display text-5xl font-black tracking-tight text-white tabular-nums sm:text-6xl">
                  {fmt(report?.expectedCashInDrawer)}
                </p>
                <p className="mt-2 text-sm leading-5 text-white/75">
                  Opening float + cash sales + old udhar cash recovery + cash in
                  &nbsp;-&nbsp; supplier cash paid - cash expenses - cash out
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur-sm">
                    <ArrowUpRight size={13} />Cash in {fmt(report?.cashReceived)}
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur-sm">
                    <CreditCard size={13} />UPI in {fmt(report?.upiReceived)}
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur-sm">
                    <CreditCard size={13} />Bank in {fmt(report?.bankReceived)}
                  </span>
                  {(report?.purchaseCashPaid ?? 0) > 0 && (
                    <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 backdrop-blur-sm">
                      <ArrowDownRight size={13} />Supplier cash -{fmt(report?.purchaseCashPaid)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="hidden lg:block bg-border" />
          <div className="border-t p-5 sm:p-6 lg:border-t-0">
            <p className="app-muted-label">Cash, UPI, and bank split</p>
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
                    <span className="font-semibold text-sky-700 dark:text-sky-400">UPI in</span>
                    <span className="font-black tabular-nums">{fmt(report?.upiReceived)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${upiPct}%` }} />
                  </div>
                  <p className="mt-0.5 text-right text-[11px] text-muted-foreground">{upiPct}%</p>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-indigo-700 dark:text-indigo-400">Bank in</span>
                    <span className="font-black tabular-nums">{fmt(report?.bankReceived)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${totalIncomingTender > 0 ? Math.round(((report?.bankReceived ?? 0) / totalIncomingTender) * 100) : 0}%` }} />
                  </div>
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

      {/* ── The till: money in the drawer that never went through a bill ──── */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-3 sm:px-6">
          <p className="app-muted-label">Opening float &amp; cash in / out</p>
        </div>
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Label className="app-muted-label" htmlFor="opening-float">Opening float for {date}</Label>
            <div className="mt-2 flex gap-2">
              <Input
                id="opening-float"
                data-testid="input-opening-float"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder="0"
                value={floatDraft}
                onChange={(event) => setFloatDraft(event.target.value)}
                className="h-11 text-lg font-bold tabular-nums"
              />
              <Button onClick={() => void saveFloatForDate()} className="h-11 shrink-0">Save</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The change you put in the drawer this morning. Declared each day rather than
              carried over, so yesterday&apos;s shortage never hides inside today&apos;s expected cash.
              {declaredFloat > 0 ? ` Currently ${fmt(declaredFloat)}.` : ""}
            </p>
            <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cash expenses today</span>
                <span className="font-bold tabular-nums" data-testid="text-cash-expenses">{fmt(cashExpenses)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Cash-paid expenses only — UPI and bank expenses never leave the drawer.
              </p>
            </div>
          </div>

          <div>
            <Label className="app-muted-label">Record cash in / out</Label>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[0.8fr_1.2fr]">
              <Input
                data-testid="input-cash-movement-amount"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder="Amount"
                value={movementAmount}
                onChange={(event) => setMovementAmount(event.target.value)}
                className="h-11 font-bold tabular-nums"
              />
              <Input
                data-testid="input-cash-movement-note"
                placeholder="Reason (e.g. petrol, extra change)"
                value={movementNote}
                onChange={(event) => setMovementNote(event.target.value)}
                className="h-11"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" className="h-11 flex-1" onClick={() => void addCashMovement("in")}>
                <ArrowDownRight size={15} className="mr-1.5" /> Cash in
              </Button>
              <Button variant="outline" className="h-11 flex-1" onClick={() => void addCashMovement("out")}>
                <ArrowUpRight size={15} className="mr-1.5" /> Cash out
              </Button>
            </div>

            {movementsForDate.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Nothing recorded for {date}. Log money you add to or take from the till so the
                count at closing can actually match.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {movementsForDate.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase", row.kind === "in" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                        {row.kind === "in" ? "In" : "Out"}
                      </span>
                      <span className="truncate text-muted-foreground">{row.note || "No reason given"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-bold tabular-nums">{row.kind === "in" ? "+" : "-"}{fmt(row.amount)}</span>
                      <button
                        type="button"
                        onClick={() => void deleteCashMovement(row.id)}
                        className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove ${row.kind === "in" ? "cash in" : "cash out"} of ${fmt(row.amount)}`}
                      >
                        <XCircle size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ── Drawer count: what's ACTUALLY in the drawer vs expected ───────── */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-3 sm:px-6">
          <p className="app-muted-label">Count the drawer — over / short</p>
        </div>
        <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Label className="app-muted-label" htmlFor="counted-cash">Counted cash for {date}</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="counted-cash"
                data-testid="input-counted-cash"
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="What is physically in the drawer?"
                value={countedDraft}
                onChange={(event) => setCountedDraft(event.target.value)}
                className="h-11 rounded-xl"
              />
              <Button data-testid="button-save-drawer-count" onClick={() => void saveDrawerCountForDate()} disabled={savingCount || !report || countedDraft.trim() === ""} className="h-11 rounded-xl">
                {savingCount ? "Saving..." : savedCountForDate ? "Update" : "Save"}
              </Button>
            </div>
            {liveVariance !== null && (
              <p className={cn("mt-2 text-sm font-bold", liveVariance === 0 ? "text-emerald-700" : liveVariance > 0 ? "text-sky-700" : "text-red-600")} data-testid="text-drawer-variance">
                {liveVariance === 0 ? "Drawer matches expected — perfect close." : liveVariance > 0 ? `Over by ${fmt(liveVariance)} vs expected ${fmt(report?.expectedCashInDrawer)}.` : `Short by ${fmt(Math.abs(liveVariance))} vs expected ${fmt(report?.expectedCashInDrawer)}.`}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Saved on this device and kept for 90 days — repeated shorts on the same weekday are worth investigating.</p>
          </div>
          <div>
            <p className="app-muted-label">Over / short history</p>
            {drawerCounts.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No drawer counts saved yet. Count tonight's drawer to start the history.</p>
            ) : (
              <ul className="mt-2 divide-y" data-testid="drawer-count-history">
                {drawerCounts.slice(0, 7).map((row) => (
                  <li key={row.date} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 text-sm sm:flex-nowrap">
                    <span className="font-semibold">{new Date(`${row.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                    <span className="order-3 w-full text-xs text-muted-foreground sm:order-none sm:w-auto">counted {fmt(row.countedCash)} / expected {fmt(row.expectedCash)}</span>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-black", row.variance === 0 ? "bg-emerald-50 text-emerald-700" : row.variance > 0 ? "bg-sky-50 text-sky-700" : "bg-red-50 text-red-600")}>
                      {row.variance === 0 ? "Exact" : row.variance > 0 ? `+${fmt(row.variance)}` : `−${fmt(Math.abs(row.variance))}`}
                    </span>
                  </li>
                ))}
              </ul>
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
              <FlowRow label="UPI sales" value={fmt(report?.upiSales)} direction="in" />
              <FlowRow label="Bank sales" value={fmt(report?.bankSales)} direction="in" />
              <FlowRow
                label="Old udhar recovered"
                value={fmt(report?.oldUdharPaymentReceived)}
                direction="in"
                hint={`Cash ${fmt(report?.oldUdharCashReceived)} / UPI ${fmt(report?.oldUdharUpiReceived)} / Bank ${fmt(report?.oldUdharBankReceived)}`}
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
              <FlowRow label="Supplier UPI paid" value={fmt(report?.purchaseUpiPaid)} direction="out" />
              <FlowRow label="Supplier bank paid" value={fmt(report?.purchaseBankPaid)} direction="out" />
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
