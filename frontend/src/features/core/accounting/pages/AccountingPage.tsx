import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpenCheck, Landmark, Loader2, Lock, RefreshCw, Scale, Unlock } from "lucide-react";
import { Link } from "wouter";
import { useAppLanguage, type TranslationKey } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/http";
import { financialYearStart, LEDGER_TABS, ledgerQueryEnabled, toIsoDate, type LedgerTab } from "../ledger-view";
import {
  ensureChartOfAccounts,
  getAccountingPeriods,
  getBalanceSheet,
  getLedgerProfitAndLoss,
  getTrialBalance,
  ledgerBoundary,
  type AccountCategory,
  type LedgerAccountRow,
  type StatementRow,
} from "../api";

/**
 * The shop's books.
 *
 * Everything on this screen comes from the POSTED general ledger. That is the
 * distinction the page has to keep making, because the Reports screen already
 * shows a profit figure and it is a different number by construction: Reports
 * reads bill columns, this reads journal lines. Both are honest; only one is
 * the books, and an owner handing figures to their accountant needs to know
 * which they are looking at.
 */

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.055)]";
const TAB_LABEL: Record<LedgerTab, TranslationKey> = {
  trialBalance: "accounting.tab.trialBalance",
  profitAndLoss: "accounting.tab.profitAndLoss",
  balanceSheet: "accounting.tab.balanceSheet",
  chartOfAccounts: "accounting.tab.chartOfAccounts",
  periods: "accounting.tab.periods",
};

const CATEGORY_LABEL: Record<AccountCategory, TranslationKey> = {
  asset: "accounting.category.asset",
  liability: "accounting.category.liability",
  equity: "accounting.category.equity",
  income: "accounting.category.income",
  expense: "accounting.category.expense",
};

const MONEY = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Paise in, rupees out. The only place this file divides by 100. */
function money(paise: number | undefined) {
  if (paise == null || !Number.isFinite(paise)) return "—";
  return MONEY.format(paise / 100);
}

function useLedgerError(error: unknown) {
  const { t } = useAppLanguage();
  if (!error) return null;
  if (error instanceof ApiClientError && error.status === 403) return t("accounting.ownerOnly");
  return t("accounting.loadFailed");
}

function Money({ paise, tone }: { paise: number; tone?: "positive" | "negative" | "muted" }) {
  const colour = tone === "negative" ? "text-rose-600" : tone === "positive" ? "text-emerald-700" : tone === "muted" ? "text-slate-500" : "text-slate-900";
  return <span className={`tabular-nums font-bold ${colour}`}>{money(paise)}</span>;
}

function StatusPill({ balanced, label }: { balanced: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${balanced ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
      {balanced ? <Scale size={12} /> : <AlertTriangle size={12} />} {label}
    </span>
  );
}

function PanelState({ loading, error, empty, emptyTitle, emptyBody, onRetry, retryLabel }: {
  loading: boolean; error: string | null; empty: boolean; emptyTitle: string; emptyBody: string; onRetry: () => void; retryLabel: string;
}) {
  if (loading) {
    return <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm font-semibold text-slate-500"><Loader2 size={16} className="animate-spin" /> {emptyTitle}</div>;
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-10">
        <p className="flex items-start gap-2 text-sm leading-6 text-slate-600"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" /> {error}</p>
        <Button variant="outline" onClick={onRetry}><RefreshCw size={14} /> {retryLabel}</Button>
      </div>
    );
  }
  if (empty) {
    return <div className="px-5 py-12 text-center"><p className="text-sm font-black text-slate-700">{emptyTitle}</p><p className="mt-1 text-xs text-slate-500">{emptyBody}</p></div>;
  }
  return null;
}

/** Every table on this page scrolls inside its own box; the app shell clips overflow-x silently. */
function TableScroll({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 overflow-x-auto"><table className="w-full min-w-[560px] text-sm">{children}</table></div>;
}

function AccountRows({ rows, amountOf }: { rows: Array<LedgerAccountRow | StatementRow>; amountOf?: (row: StatementRow) => number }) {
  const { t } = useAppLanguage();
  return (
    <tbody>
      {rows.map((row) => (
        <tr key={row.code} className="border-t border-slate-100 hover:bg-slate-50/70">
          <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-slate-500">{row.code}</td>
          <td className="px-4 py-2.5 font-semibold text-slate-800">{row.name}</td>
          <td className="px-4 py-2.5 text-xs text-slate-500">{t(CATEGORY_LABEL[row.category])}</td>
          {amountOf
            ? <td className="px-4 py-2.5 text-right"><Money paise={amountOf(row as StatementRow)} /></td>
            : <>
                <td className="px-4 py-2.5 text-right"><Money paise={row.debitPaise} tone={row.debitPaise ? undefined : "muted"} /></td>
                <td className="px-4 py-2.5 text-right"><Money paise={row.creditPaise} tone={row.creditPaise ? undefined : "muted"} /></td>
              </>}
        </tr>
      ))}
    </tbody>
  );
}

function StatementSection({ title, rows, totalLabel, totalPaise }: { title: string; rows: StatementRow[]; totalLabel: string; totalPaise: number }) {
  const { t } = useAppLanguage();
  return (
    <section className={`${card} overflow-hidden`}>
      <header className="border-b border-slate-100 px-5 py-3.5"><h2 className="text-sm font-black text-slate-900">{title}</h2></header>
      <TableScroll>
        <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-semibold">{t("accounting.col.code")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("accounting.col.account")}</th>
            <th className="px-4 py-2.5 font-semibold">{t("accounting.col.category")}</th>
            <th className="px-4 py-2.5 text-right font-semibold">{t("accounting.col.amount")}</th>
          </tr>
        </thead>
        <AccountRows rows={rows} amountOf={(row) => row.amountPaise} />
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50/60">
            <td className="px-4 py-3 font-black text-slate-700" colSpan={3}>{totalLabel}</td>
            <td className="px-4 py-3 text-right"><Money paise={totalPaise} /></td>
          </tr>
        </tfoot>
      </TableScroll>
    </section>
  );
}

export default function AccountingPage() {
  const { t } = useAppLanguage();
  const [tab, setTab] = useState<LedgerTab>("trialBalance");
  const [from, setFrom] = useState(financialYearStart());
  const [to, setTo] = useState(toIsoDate(new Date()));
  // The chart of accounts GET is a write on the server — it ensures system
  // accounts and writes an audit row — so it stays behind an explicit ask
  // rather than firing because a tab happened to mount.
  const [chartRequested, setChartRequested] = useState(false);

  const range = { from: ledgerBoundary(from), to: ledgerBoundary(to, true) };

  const mayFetch = ledgerQueryEnabled(tab, chartRequested);

  const trialQ = useQuery({ queryKey: ["accounting", "trial-balance", from, to], queryFn: () => getTrialBalance(range), enabled: mayFetch.trialBalance, retry: false });
  const pnlQ = useQuery({ queryKey: ["accounting", "pnl", from, to], queryFn: () => getLedgerProfitAndLoss(range), enabled: mayFetch.profitAndLoss, retry: false });
  const sheetQ = useQuery({ queryKey: ["accounting", "balance-sheet", to], queryFn: () => getBalanceSheet({ asOf: ledgerBoundary(to, true) }), enabled: mayFetch.balanceSheet, retry: false });
  const chartQ = useQuery({ queryKey: ["accounting", "chart-of-accounts"], queryFn: ensureChartOfAccounts, enabled: mayFetch.chartOfAccounts, retry: false });
  const periodsQ = useQuery({ queryKey: ["accounting", "periods"], queryFn: getAccountingPeriods, enabled: mayFetch.periods, retry: false });

  const trialError = useLedgerError(trialQ.error);
  const pnlError = useLedgerError(pnlQ.error);
  const sheetError = useLedgerError(sheetQ.error);
  const chartError = useLedgerError(chartQ.error);
  const periodsError = useLedgerError(periodsQ.error);

  const dateField = "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 sm:mouse:h-9";
  const showRange = tab === "trialBalance" || tab === "profitAndLoss";

  return (
    <div className="space-y-5 pb-12">
      <section className="overflow-hidden rounded-[24px] border border-indigo-100 bg-[radial-gradient(circle_at_top_right,#c7d2fe_0,transparent_36%),linear-gradient(135deg,#172554,#312e81)] p-6 text-white shadow-[0_24px_64px_rgba(30,41,110,0.24)] sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-indigo-100"><BookOpenCheck size={14} /> {t("accounting.note.version")}</div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("accounting.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-100/90">{t("accounting.subtitle")}</p>
          </div>
          <Link href="/reports"><Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20">{t("reports.settlement.backToReports")}</Button></Link>
        </div>
      </section>

      <div className="flex min-w-0 flex-wrap gap-2">
        {LEDGER_TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setTab(candidate)}
            aria-current={tab === candidate ? "page" : undefined}
            className={`h-11 rounded-xl px-4 text-sm font-black transition sm:mouse:h-9 ${tab === candidate ? "bg-indigo-700 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            {t(TAB_LABEL[candidate])}
          </button>
        ))}
      </div>

      {(showRange || tab === "balanceSheet") && (
        <div className={`${card} flex min-w-0 flex-wrap items-end gap-3 p-4`}>
          {showRange && (
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">{t("accounting.range.from")}</span>
              <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className={dateField} />
            </label>
          )}
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">{showRange ? t("accounting.range.to") : t("accounting.range.asOf")}</span>
            <input type="date" value={to} min={showRange ? from : undefined} onChange={(event) => setTo(event.target.value)} className={dateField} />
          </label>
        </div>
      )}

      {tab === "trialBalance" && (
        <section className={`${card} overflow-hidden`}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900">{t("accounting.tab.trialBalance")}</h2>
              {trialQ.data && <p className="mt-0.5 text-xs text-slate-500">{trialQ.data.status === "balanced" ? t("accounting.status.balancedHint") : t("accounting.status.attentionHint")}</p>}
            </div>
            {trialQ.data && <StatusPill balanced={trialQ.data.status === "balanced"} label={trialQ.data.status === "balanced" ? t("accounting.status.balanced") : t("accounting.status.attention")} />}
          </header>
          <PanelState
            loading={trialQ.isLoading} error={trialError} empty={!trialQ.data?.accounts.length}
            emptyTitle={trialQ.isLoading ? t("accounting.loading") : t("accounting.empty.title")} emptyBody={t("accounting.empty.body")}
            onRetry={() => void trialQ.refetch()} retryLabel={t("accounting.retry")}
          />
          {trialQ.data?.accounts.length ? (
            <TableScroll>
              <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">{t("accounting.col.code")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("accounting.col.account")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("accounting.col.category")}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{t("accounting.col.debit")}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{t("accounting.col.credit")}</th>
                </tr>
              </thead>
              <AccountRows rows={trialQ.data.accounts} />
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                  <td className="px-4 py-3 font-black text-slate-700" colSpan={3}>{t("accounting.total.debit")} · {t("accounting.total.credit")}</td>
                  <td className="px-4 py-3 text-right"><Money paise={trialQ.data.totalDebitPaise} /></td>
                  <td className="px-4 py-3 text-right"><Money paise={trialQ.data.totalCreditPaise} /></td>
                </tr>
                {trialQ.data.differencePaise !== 0 && (
                  <tr className="border-t border-amber-200 bg-amber-50/70">
                    <td className="px-4 py-3 font-black text-amber-900" colSpan={4}>{t("accounting.total.difference")}</td>
                    <td className="px-4 py-3 text-right"><Money paise={trialQ.data.differencePaise} tone="negative" /></td>
                  </tr>
                )}
              </tfoot>
            </TableScroll>
          ) : null}
        </section>
      )}

      {tab === "profitAndLoss" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
            <Landmark size={18} className="mt-0.5 shrink-0 text-indigo-700" />
            <div className="min-w-0">
              <p className="text-sm font-black text-indigo-950">{t("accounting.pnl.basisTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-indigo-800">{t("accounting.pnl.basisBody")}</p>
            </div>
          </div>
          <section className={`${card} overflow-hidden`}>
            <PanelState
              loading={pnlQ.isLoading} error={pnlError} empty={!pnlQ.data?.income.length && !pnlQ.data?.expenses.length}
              emptyTitle={pnlQ.isLoading ? t("accounting.loading") : t("accounting.empty.title")} emptyBody={t("accounting.empty.body")}
              onRetry={() => void pnlQ.refetch()} retryLabel={t("accounting.retry")}
            />
            {pnlQ.data && (pnlQ.data.income.length > 0 || pnlQ.data.expenses.length > 0) ? (
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <span className="text-sm font-black text-slate-700">{pnlQ.data.netProfitPaise >= 0 ? t("accounting.pnl.netProfit") : t("accounting.pnl.netLoss")}</span>
                <Money paise={Math.abs(pnlQ.data.netProfitPaise)} tone={pnlQ.data.netProfitPaise >= 0 ? "positive" : "negative"} />
              </div>
            ) : null}
          </section>
          {pnlQ.data?.income.length ? <StatementSection title={t("accounting.pnl.income")} rows={pnlQ.data.income} totalLabel={t("accounting.pnl.totalIncome")} totalPaise={pnlQ.data.totalIncomePaise} /> : null}
          {pnlQ.data?.expenses.length ? <StatementSection title={t("accounting.pnl.expenses")} rows={pnlQ.data.expenses} totalLabel={t("accounting.pnl.totalExpenses")} totalPaise={pnlQ.data.totalExpensePaise} /> : null}
        </div>
      )}

      {tab === "balanceSheet" && (
        <div className="space-y-4">
          <section className={`${card} overflow-hidden`}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-black text-slate-900">{t("accounting.tab.balanceSheet")}</h2>
              {sheetQ.data && <StatusPill balanced={sheetQ.data.status === "balanced"} label={sheetQ.data.status === "balanced" ? t("accounting.status.balanced") : t("accounting.status.attention")} />}
            </header>
            <PanelState
              loading={sheetQ.isLoading} error={sheetError} empty={!sheetQ.data?.assets.length && !sheetQ.data?.liabilities.length && !sheetQ.data?.equity.length}
              emptyTitle={sheetQ.isLoading ? t("accounting.loading") : t("accounting.empty.title")} emptyBody={t("accounting.empty.body")}
              onRetry={() => void sheetQ.refetch()} retryLabel={t("accounting.retry")}
            />
            {sheetQ.data && sheetQ.data.differencePaise !== 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50/70 px-5 py-3">
                <span className="text-sm font-black text-amber-900">{t("accounting.total.difference")}</span>
                <Money paise={sheetQ.data.differencePaise} tone="negative" />
              </div>
            ) : null}
          </section>
          {sheetQ.data?.assets.length ? <StatementSection title={t("accounting.bs.assets")} rows={sheetQ.data.assets} totalLabel={t("accounting.bs.totalAssets")} totalPaise={sheetQ.data.totalAssetsPaise} /> : null}
          {sheetQ.data?.liabilities.length ? <StatementSection title={t("accounting.bs.liabilities")} rows={sheetQ.data.liabilities} totalLabel={t("accounting.bs.totalLiabilities")} totalPaise={sheetQ.data.totalLiabilitiesPaise} /> : null}
          {sheetQ.data?.equity.length ? <StatementSection title={t("accounting.bs.equity")} rows={sheetQ.data.equity} totalLabel={t("accounting.bs.totalEquity")} totalPaise={sheetQ.data.totalEquityPaise} /> : null}
        </div>
      )}

      {tab === "chartOfAccounts" && (
        <section className={`${card} overflow-hidden`}>
          {!chartRequested ? (
            <div className="flex flex-col items-start gap-3 px-5 py-10">
              <p className="text-sm font-black text-slate-800">{t("accounting.coa.loadTitle")}</p>
              <p className="max-w-xl text-xs leading-5 text-slate-500">{t("accounting.coa.loadBody")}</p>
              <Button onClick={() => setChartRequested(true)}><BookOpenCheck size={15} /> {t("accounting.coa.loadAction")}</Button>
            </div>
          ) : (
            <>
              <PanelState
                loading={chartQ.isLoading} error={chartError} empty={!chartQ.data?.length}
                emptyTitle={chartQ.isLoading ? t("accounting.loading") : t("accounting.coa.empty")} emptyBody={t("accounting.empty.body")}
                onRetry={() => void chartQ.refetch()} retryLabel={t("accounting.retry")}
              />
              {chartQ.data?.length ? (
                <TableScroll>
                  <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">{t("accounting.col.code")}</th>
                      <th className="px-4 py-2.5 font-semibold">{t("accounting.col.account")}</th>
                      <th className="px-4 py-2.5 font-semibold">{t("accounting.col.category")}</th>
                      <th className="px-4 py-2.5 font-semibold">{t("accounting.col.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartQ.data.map((account) => (
                      <tr key={account.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-slate-500">{account.code}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{account.name}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{t(CATEGORY_LABEL[account.category])}</td>
                        <td className="px-4 py-2.5">
                          <span className="flex flex-wrap gap-1.5">
                            {account.systemKey && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{t("accounting.coa.systemBadge")}</span>}
                            {!account.active && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">{t("accounting.coa.inactiveBadge")}</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableScroll>
              ) : null}
            </>
          )}
        </section>
      )}

      {tab === "periods" && (
        <section className={`${card} overflow-hidden`}>
          <header className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-black text-slate-900">{t("accounting.tab.periods")}</h2></header>
          <PanelState
            loading={periodsQ.isLoading} error={periodsError} empty={!periodsQ.data?.length}
            emptyTitle={periodsQ.isLoading ? t("accounting.loading") : t("accounting.period.empty")} emptyBody=""
            onRetry={() => void periodsQ.refetch()} retryLabel={t("accounting.retry")}
          />
          {periodsQ.data?.length ? (
            <ul className="divide-y divide-slate-100">
              {periodsQ.data.map((period) => (
                <li key={period.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-black text-slate-900">{period.name}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-slate-500">{period.startsAt.slice(0, 10)} → {period.endsAt.slice(0, 10)}</p>
                    {period.status === "closed" && period.closeReason && <p className="mt-1 text-xs text-slate-500">{t("accounting.period.reason")}: {period.closeReason}</p>}
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${period.status === "closed" ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {period.status === "closed" ? <Lock size={12} /> : <Unlock size={12} />}
                    {period.status === "closed" ? t("accounting.period.closed") : t("accounting.period.open")}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </div>
  );
}
