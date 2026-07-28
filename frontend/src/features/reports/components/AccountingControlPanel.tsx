import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Landmark } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getAccountingControl, type AccountingControlReport } from "@/features/reports/api";
import { ApiClientError } from "@/lib/api/http";
import { cn } from "@/lib/utils";

function money(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function periodBoundary(date: string, end = false) {
  return new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
}

function statusCopy(report: AccountingControlReport) {
  if (report.status === "balanced") return { label: "Balanced for mapped ledger", detail: "Every mapped source group has equal debit and credit.", tone: "green" as const };
  if (report.status === "no_data") return { label: "No ledger rows", detail: "No accounting ledger activity exists in this period.", tone: "slate" as const };
  return { label: "Review required", detail: `${report.coverage.exceptionGroups} source group${report.coverage.exceptionGroups === 1 ? "" : "s"} need accounting attention.`, tone: "amber" as const };
}

export function AccountingControlPanel({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ["accounting-control", from, to],
    queryFn: () => getAccountingControl({ from: periodBoundary(from), to: periodBoundary(to, true) }),
    retry: false,
  });

  if (query.isLoading) {
    return <article className="rounded-[10px] border border-[#dfe7f2] bg-white p-4 shadow-[0_4px_18px_rgba(31,60,110,0.045)]"><Skeleton className="h-40 w-full" /></article>;
  }

  if (query.error || !query.data) {
    const ownerOnly = query.error instanceof ApiClientError && query.error.status === 403;
    return (
      <article className="rounded-[10px] border border-[#e2e9f3] bg-white p-4 shadow-[0_4px_18px_rgba(31,60,110,0.045)]">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-slate-100 text-slate-600"><Landmark size={18} /></span>
          <div><h2 className="text-sm font-black text-[#13254a]">Accounting integrity</h2><p className="mt-1 text-xs leading-5 text-[#66758f]">{ownerOnly ? "Owner access is required for shop-wide accounting balances." : "Connect to the server to verify the accounting ledger. No offline estimate is shown as reconciled."}</p></div>
        </div>
      </article>
    );
  }

  const report = query.data;
  const status = statusCopy(report);
  const mappedPct = report.coverage.ledgerRows ? Math.round((report.coverage.mappedRows / report.coverage.ledgerRows) * 100) : 0;
  const statusClass = status.tone === "green" ? "bg-emerald-50 text-emerald-700" : status.tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700";

  return (
    <article className="min-w-0 overflow-hidden rounded-[10px] border border-[#dfe7f2] bg-white shadow-[0_4px_18px_rgba(31,60,110,0.045)]">
      <header className="flex flex-col gap-3 border-b border-[#e7edf5] bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_55%,#f3fff8_100%)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-[#eaf2ff] text-[var(--brand)]"><Landmark size={19} /></span>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-black text-[#10224a]">Accounting integrity</h2><span className={cn("rounded-full px-2 py-1 text-[10px] font-extrabold", statusClass)}>{status.label}</span></div><p className="mt-1 text-[11px] leading-5 text-[#66758f]">{status.detail} Shop-wide control · {report.calculationVersion}</p></div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold text-[#52617c]"><Landmark size={14} className="text-emerald-600" /> Integer-paise evidence</div>
      </header>

      <div className="grid grid-cols-2 gap-px bg-[#e7edf5] sm:grid-cols-4">
        <ControlStat label="Mapped coverage" value={`${mappedPct}%`} detail={`${report.coverage.mappedRows}/${report.coverage.ledgerRows} rows`} />
        <ControlStat label="Balanced groups" value={`${report.coverage.balancedGroups}/${report.coverage.sourceGroups}`} detail={`${report.coverage.exceptionGroups} exceptions`} />
        <ControlStat label="Trial difference" value={money(report.trialBalance.difference.amount)} detail={report.trialBalance.difference.paise === 0 ? "Debit equals credit" : "Needs review"} alert={report.trialBalance.difference.paise !== 0} />
        <ControlStat label="Unmapped rows" value={String(report.coverage.unmappedRows)} detail="Never auto-balanced" alert={report.coverage.unmappedRows > 0} />
      </div>

      <div className="p-3 sm:p-4">
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[650px] border-collapse text-[11px]">
            <thead><tr className="bg-[#f5f7fb] text-[#52617c]"><th className="rounded-l-[6px] px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Debit balance</th><th className="rounded-r-[6px] px-3 py-2 text-right">Credit balance</th></tr></thead>
            <tbody className="divide-y divide-[#e8edf4]">{report.trialBalance.accounts.map((account) => <tr key={account.code}><td className="px-3 py-2 font-bold text-[#17294d]">{account.code} · {account.name}</td><td className="px-3 py-2 capitalize text-[#64738e]">{account.category}</td><td className="px-3 py-2 text-right font-bold">{money(account.debitBalance.amount)}</td><td className="px-3 py-2 text-right font-bold">{money(account.creditBalance.amount)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="space-y-2 sm:hidden">{report.trialBalance.accounts.map((account) => <div key={account.code} className="rounded-[8px] border border-[#e5ebf3] p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-black text-[#17294d]">{account.name}</p><p className="mt-0.5 text-[10px] font-bold uppercase text-[#74819a]">{account.code} · {account.category}</p></div><Landmark size={15} className="text-[var(--brand)]" /></div><div className="mt-3 grid grid-cols-2 gap-2 text-[10px]"><BalanceValue label="Debit balance" value={account.debitBalance.amount} /><BalanceValue label="Credit balance" value={account.creditBalance.amount} /></div></div>)}</div>

        {report.status === "attention_required" ? <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900"><div className="flex items-center gap-2 font-black"><AlertTriangle size={14} /> Exceptions are not hidden</div><p className="mt-1">{report.coverage.exceptionGroups} source groups and {report.coverage.unmappedRows} unmapped rows remain open. Open exceptions are returned by the API for investigation.</p></div> : report.status === "balanced" ? <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 text-[11px] font-bold text-emerald-800"><Landmark size={14} /> Mapped ledger activity balances to zero for this period.</div> : null}

        <details className="mt-3 rounded-[8px] border border-[#e5ebf3] bg-[#fbfcfe] p-3 text-[11px] text-[#5d6c86]"><summary className="cursor-pointer font-black text-[#344666]">Coverage limits · read before relying on this report</summary><ul className="mt-2 list-disc space-y-1 pl-4 leading-5">{report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>
      </div>
    </article>
  );
}

function ControlStat({ label, value, detail, alert }: { label: string; value: string; detail: string; alert?: boolean }) {
  return <div className="min-w-0 bg-white p-3"><p className="truncate text-[9px] font-bold uppercase tracking-wide text-[#74819a]">{label}</p><p className={cn("mt-1 truncate text-base font-black", alert ? "text-amber-700" : "text-[#10224a]")}>{value}</p><p className="mt-0.5 truncate text-[10px] text-[#7b89a0]">{detail}</p></div>;
}

function BalanceValue({ label, value }: { label: string; value: number }) {
  return <div className="rounded-[6px] bg-[#f5f7fb] p-2"><p className="text-[#74819a]">{label}</p><p className="mt-1 font-black text-[#17294d]">{money(value)}</p></div>;
}