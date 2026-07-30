import { ChangeEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  Landmark,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Unlink2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { UpgradePrompt, useFeature } from "@/features/subscription";
import {
  getBankReconciliation,
  ignoreBankTransaction,
  importBankStatement,
  matchBankTransaction,
  restoreBankTransaction,
  unmatchBankTransaction,
  type BankReconciliationCandidate,
  type BankStatementImportInput,
  type BankStatementImportRecord,
  type BankStatementTransaction,
} from "@/features/reports/bank-reconciliation-api";
import { useToast } from "@/hooks/use-toast";
import { ApiClientError } from "@/lib/api/http";
import { cn } from "@/lib/utils";

type FilterStatus = "all" | "unmatched" | "partial" | "matched" | "ignored";
type AccountFilter = "all" | "bank" | "upi";
type Approval =
  | { kind: "import"; payload: BankStatementImportInput }
  | { kind: "match"; transaction: BankStatementTransaction; ledgerRowIds: string[]; reasonRequired: boolean }
  | { kind: "unmatch"; transaction: BankStatementTransaction; allocationIds: string[] }
  | { kind: "ignore"; transaction: BankStatementTransaction }
  | { kind: "restore"; transaction: BankStatementTransaction };

const PAGE_SIZE = 10;
const MAX_CSV_BYTES = 1_750_000;

function periodBoundary(date: string, end = false) {
  return new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
}

function money(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "The server could not complete this reconciliation action.";
}

function statusTone(status: BankStatementTransaction["matchStatus"]) {
  if (status === "matched") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "partial") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "ignored") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function approvalCopy(approval: Approval | null) {
  if (!approval) return { title: "Approve reconciliation", description: "", confirmLabel: "Confirm", reasonRequired: false };
  if (approval.kind === "import") return {
    title: "Import bank statement",
    description: "The complete CSV is validated before any row is saved. Exact file replays and duplicate transactions are detected server-side.",
    confirmLabel: "Import statement",
    reasonRequired: false,
  };
  if (approval.kind === "match") return {
    title: "Confirm ledger allocation",
    description: `${approval.ledgerRowIds.length} recorded ledger impact${approval.ledgerRowIds.length === 1 ? "" : "s"} will be linked to ${approval.transaction.reference || approval.transaction.description}. No automatic match is performed.`,
    confirmLabel: "Confirm allocation",
    reasonRequired: approval.reasonRequired,
  };
  if (approval.kind === "unmatch") return {
    title: "Reverse reconciliation",
    description: "The active links will be reversed, not deleted. Their prior evidence remains in the append-only reconciliation history.",
    confirmLabel: "Reverse links",
    reasonRequired: true,
  };
  if (approval.kind === "ignore") return {
    title: "Ignore statement row",
    description: "Use this only when the row is intentionally outside the recorded ledger. The reason remains visible in the audit history.",
    confirmLabel: "Ignore row",
    reasonRequired: true,
  };
  return {
    title: "Restore statement row",
    description: "This returns the ignored row to the unmatched queue so it can be reconciled normally.",
    confirmLabel: "Restore row",
    reasonRequired: true,
  };
}

export function BankReconciliationPanel({ from, to }: { from: string; to: string }) {
  const feature = useFeature("csv_import_export");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<FilterStatus>("all");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [offset, setOffset] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [accountType, setAccountType] = useState<"bank" | "upi">("bank");
  const [accountName, setAccountName] = useState("");
  const [accountLast4, setAccountLast4] = useState("");
  const [csvFile, setCsvFile] = useState<{ name: string; text: string; size: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastImport, setLastImport] = useState<BankStatementImportRecord | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  const query = useQuery({
    queryKey: ["bank-reconciliation", from, to, status, accountFilter, offset],
    queryFn: () => getBankReconciliation({
      from: periodBoundary(from),
      to: periodBoundary(to, true),
      status,
      accountType: accountFilter === "all" ? undefined : accountFilter,
      limit: PAGE_SIZE,
      offset,
    }),
    enabled: feature.allowed && !feature.loading,
    retry: false,
  });

  const report = query.data;
  const copy = approvalCopy(approval);
  const currentSelection = (transactionId: string) => selections[transactionId] ?? [];

  async function readCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileError(null);
    setCsvFile(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("Choose a .csv statement file.");
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      setFileError("CSV exceeds the 1.75 MB protected import limit.");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("The selected CSV is empty.");
      setCsvFile({ name: file.name, text, size: file.size });
    } catch (error) {
      setFileError(errorMessage(error));
    }
  }

  function requestImport() {
    const cleanName = accountName.trim();
    if (cleanName.length < 2) return setFileError("Enter the bank or UPI account name.");
    if (accountLast4 && !/^\d{4}$/.test(accountLast4)) return setFileError("Account last four must contain exactly four digits.");
    if (!csvFile) return setFileError("Choose a CSV statement file first.");
    setApprovalError(null);
    setApproval({
      kind: "import",
      payload: {
        accountType,
        accountName: cleanName,
        ...(accountLast4 ? { accountLast4 } : {}),
        fileName: csvFile.name,
        csvText: csvFile.text,
      },
    });
  }

  function toggleLedger(transactionId: string, ledgerRowId: string, checked: boolean) {
    setSelections((current) => {
      const values = new Set(current[transactionId] ?? []);
      if (checked) values.add(ledgerRowId);
      else values.delete(ledgerRowId);
      return { ...current, [transactionId]: [...values] };
    });
  }

  function requestSelectedMatch(transaction: BankStatementTransaction) {
    const ids = currentSelection(transaction.id);
    const selectedCandidates = transaction.allocationOptions.filter((candidate) => ids.includes(candidate.ledgerRowId));
    const totalPaise = selectedCandidates.reduce((sum, candidate) => sum + candidate.amount.paise, 0);
    if (!ids.length) return;
    if (totalPaise > transaction.remainingAmount.paise) {
      toast({ title: "Selection exceeds statement amount", description: "Remove one or more ledger rows before confirming.", variant: "destructive" });
      return;
    }
    setApprovalError(null);
    setApproval({
      kind: "match",
      transaction,
      ledgerRowIds: ids,
      reasonRequired: ids.length > 1 || totalPaise < transaction.remainingAmount.paise
        || selectedCandidates.some((candidate) => candidate.dateDeltaDays > 3),
    });
  }

  async function refreshAfterAction() {
    await queryClient.invalidateQueries({ queryKey: ["bank-reconciliation"] });
  }

  async function confirmApproval(ownerPin: string, reason: string) {
    if (!approval) return;
    const cleanReason = reason.trim();
    if (copy.reasonRequired && cleanReason.length < 5) {
      setApprovalError("Enter at least five characters so the audit reason is useful.");
      return;
    }
    setBusy(true);
    setApprovalError(null);
    try {
      if (approval.kind === "import") {
        const imported = await importBankStatement({
          ...approval.payload,
          ...(cleanReason ? { note: cleanReason } : {}),
        }, ownerPin);
        setLastImport(imported);
        setCsvFile(null);
        setFileInputKey((value) => value + 1);
        toast({
          title: imported.idempotentReplay ? "Statement already imported" : "Statement imported",
          description: imported.idempotentReplay
            ? "The exact file replay was detected; no rows were duplicated."
            : `${imported.importedCount} rows added · ${imported.duplicateCount} duplicates skipped.`,
        });
      } else if (approval.kind === "match") {
        await matchBankTransaction(approval.transaction.id, {
          ledgerRowIds: approval.ledgerRowIds,
          ...(cleanReason ? { note: cleanReason } : {}),
        }, ownerPin);
        setSelections((current) => ({ ...current, [approval.transaction.id]: [] }));
        toast({ title: "Allocation confirmed", description: "The owner-confirmed evidence is now part of the reconciliation history." });
      } else if (approval.kind === "unmatch") {
        await unmatchBankTransaction(approval.transaction.id, {
          allocationIds: approval.allocationIds,
          reason: cleanReason,
        }, ownerPin);
        toast({ title: "Allocation reversed", description: "The ledger rows are available for review again; historical links were retained." });
      } else if (approval.kind === "ignore") {
        await ignoreBankTransaction(approval.transaction.id, cleanReason, ownerPin);
        toast({ title: "Statement row ignored", description: "The reason was retained in the audit history." });
      } else {
        await restoreBankTransaction(approval.transaction.id, cleanReason, ownerPin);
        toast({ title: "Statement row restored", description: "It is back in the unmatched queue." });
      }
      setApproval(null);
      await refreshAfterAction();
    } catch (error) {
      setApprovalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (feature.loading) {
    return <article className="rounded-[10px] border border-[#dfe7f2] bg-white p-4"><Skeleton className="h-44 w-full" /></article>;
  }

  if (!feature.allowed) {
    return (
      <article className="rounded-[10px] border border-[#dfe7f2] bg-white p-4 shadow-[0_4px_18px_rgba(31,60,110,0.045)]">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-blue-50 text-blue-700"><Landmark size={19} /></span>
          <div className="min-w-0 flex-1"><h2 className="text-sm font-black text-[#13254a]">Bank & UPI reconciliation</h2><p className="mt-1 text-xs leading-5 text-[#66758f]">Statement CSV import and owner-confirmed ledger matching are included from the Growth plan.</p></div>
        </div>
        <div className="mt-3"><UpgradePrompt compact featureName="csv_import_export" description={feature.reason} /></div>
      </article>
    );
  }

  return (
    <article className="min-w-0 overflow-hidden rounded-[10px] border border-[#dfe7f2] bg-white shadow-[0_4px_18px_rgba(31,60,110,0.045)]">
      <header className="border-b border-[#e7edf5] bg-[linear-gradient(135deg,#f7fbff_0%,#ffffff_52%,#f3fff9_100%)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-[#eaf2ff] text-[var(--brand)]"><Landmark size={19} /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-black text-[#10224a]">Bank & UPI reconciliation</h2><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-800">Owner-confirmed only</span></div>
              <p className="mt-1 text-[11px] leading-5 text-[#66758f]">Import statement evidence, inspect deterministic candidates, and explicitly link recorded ledger impacts. Suggestions never post a match.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 rounded-[7px] text-[11px]" onClick={() => setShowImport((value) => !value)}><UploadCloud size={13} />{showImport ? "Close import" : "Import CSV"}</Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-[7px]" title="Refresh reconciliation" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={14} className={query.isFetching ? "animate-spin" : ""} /></Button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-blue-200 bg-blue-50/80 p-2.5 text-[10px] leading-4 text-blue-900"><ShieldCheck size={14} className="mt-0.5 shrink-0" /><p><strong>No silent automation.</strong> Exact amount and direction are mandatory for suggestions; ties are marked ambiguous, and every allocation requires owner PIN confirmation.</p></div>
      </header>

      {showImport ? (
        <section className="border-b border-[#e7edf5] bg-[#fbfcff] p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[130px_1fr_140px_1.2fr_auto] lg:items-end">
            <Field label="Account type">
              <select value={accountType} onChange={(event) => setAccountType(event.target.value as "bank" | "upi")} className="h-9 w-full rounded-[6px] border border-[#d7e0ed] bg-white px-3 text-xs font-semibold text-[#25395f] focus:outline-none focus:ring-2 focus:ring-blue-200">
                <option value="bank">Bank / card</option>
                <option value="upi">UPI clearing</option>
              </select>
            </Field>
            <Field label="Account name">
              <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="e.g. HDFC current" className="h-9 rounded-[6px] text-xs" maxLength={100} />
            </Field>
            <Field label="Last four (optional)">
              <Input value={accountLast4} onChange={(event) => setAccountLast4(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234" className="h-9 rounded-[6px] text-xs" />
            </Field>
            <Field label="Statement CSV">
              <Input key={fileInputKey} type="file" accept=".csv,text/csv" onChange={(event) => void readCsv(event)} className="h-9 rounded-[6px] text-[11px] file:mr-2 file:border-0 file:bg-transparent file:text-[11px] file:font-bold" />
            </Field>
            <Button className="h-9 rounded-[7px] text-xs font-bold" onClick={requestImport} disabled={!csvFile || busy}><UploadCloud size={14} />Review import</Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
            <p className={fileError ? "font-semibold text-red-700" : "text-[#6c7a92]"}>{fileError ?? (csvFile ? `${csvFile.name} · ${(csvFile.size / 1024).toFixed(1)} KB ready for strict validation` : "Accepted dates: YYYY-MM-DD or DD/MM/YYYY · exact two-decimal money · maximum 5,000 rows")}</p>
            <a className="font-bold text-[var(--brand)] hover:underline" download="artha-bank-statement-template.csv" href={"data:text/csv;charset=utf-8," + encodeURIComponent("Date,Description,Reference,Debit,Credit,Balance\n2026-07-01,Customer settlement,UTR123,,1000.00,1000.00")}>Download template</a>
          </div>
          {lastImport ? <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900"><FileCheck2 size={15} className="mt-0.5 shrink-0" /><p><strong>{lastImport.idempotentReplay ? "Exact replay detected." : `${lastImport.importedCount} rows imported.`}</strong> {lastImport.duplicateCount} duplicate row{lastImport.duplicateCount === 1 ? "" : "s"} skipped from {lastImport.fileName}. No partial row import was accepted.</p></div> : null}
        </section>
      ) : null}

      {query.isLoading ? (
        <div className="p-4"><Skeleton className="h-52 w-full" /></div>
      ) : query.error || !report ? (
        <div className="p-4">
          <div className="flex items-start gap-3 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><div><p className="font-black">Reconciliation evidence is unavailable</p><p>{query.error instanceof ApiClientError && query.error.status === 403 ? "Owner access is required for shop-wide statement reconciliation." : "Connect to the server and retry. No offline or inferred reconciliation status is shown."}</p></div></div>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-px bg-[#e7edf5] sm:grid-cols-4">
            <SummaryStat label="Rows in filter" value={String(report.summary.transactionCount)} detail={`${report.summary.counts.unmatched} unmatched`} />
            <SummaryStat label="Statement value" value={money(report.summary.total.amount)} detail="Imported evidence" />
            <SummaryStat label="Owner reconciled" value={money(report.summary.reconciled.amount)} detail={`${report.summary.counts.matched} fully matched`} good={report.summary.reconciled.paise > 0} />
            <SummaryStat label="Open to reconcile" value={money(report.summary.open.amount)} detail={`${report.summary.counts.partial} partial · ${money(report.summary.ignored.amount)} ignored`} alert={report.summary.open.paise > 0} />
          </section>

          <section className="border-b border-[#e7edf5] p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
                {(["all", "unmatched", "partial", "matched", "ignored"] as const).map((value) => (
                  <button key={value} type="button" onClick={() => { setStatus(value); setOffset(0); }} className={cn("shrink-0 rounded-[6px] px-3 py-1.5 text-[10px] font-extrabold capitalize transition-colors", status === value ? "bg-[var(--brand)] text-white" : "bg-[#f1f4f9] text-[#52617c] hover:bg-[#e7edf7]")}>{value}</button>
                ))}
              </div>
              <select value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value as AccountFilter); setOffset(0); }} className="h-8 rounded-[6px] border border-[#dbe3ee] bg-white px-2 text-[10px] font-bold text-[#425472]">
                <option value="all">All accounts</option>
                <option value="bank">Bank / card</option>
                <option value="upi">UPI clearing</option>
              </select>
            </div>
            {report.candidateCoverage.truncated ? <div className="mt-2 flex items-center gap-2 rounded-[7px] border border-amber-200 bg-amber-50 p-2 text-[10px] font-semibold text-amber-900"><AlertTriangle size={13} /> Candidate scan reached 5,000 ledger rows. Narrow the date range before relying on suggestions.</div> : null}
          </section>

          <section className="space-y-3 bg-[#f8fafd] p-3 sm:p-4">
            {report.transactions.length ? report.transactions.map((transaction) => (
              <TransactionCard
                key={transaction.id}
                transaction={transaction}
                selected={currentSelection(transaction.id)}
                onToggle={(ledgerRowId, checked) => toggleLedger(transaction.id, ledgerRowId, checked)}
                onMatchSelected={() => requestSelectedMatch(transaction)}
                onQuickMatch={(candidate) => setApproval({ kind: "match", transaction, ledgerRowIds: [candidate.ledgerRowId], reasonRequired: false })}
                onUnmatch={() => setApproval({ kind: "unmatch", transaction, allocationIds: transaction.allocations.map((allocation) => allocation.id) })}
                onIgnore={() => setApproval({ kind: "ignore", transaction })}
                onRestore={() => setApproval({ kind: "restore", transaction })}
              />
            )) : (
              <div className="rounded-[9px] border border-dashed border-[#cfdae9] bg-white p-8 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={24} /><p className="mt-2 text-sm font-black text-[#1c3157]">No statement rows in this filter</p><p className="mt-1 text-[11px] text-[#718099]">Import a CSV or choose another status, account, or date range.</p></div>
            )}
          </section>

          <footer className="flex flex-col gap-3 border-t border-[#e7edf5] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <p className="text-[10px] text-[#6c7a92]">Showing {report.pagination.total ? report.pagination.offset + 1 : 0}–{Math.min(report.pagination.offset + report.transactions.length, report.pagination.total)} of {report.pagination.total} · {report.calculationVersion}</p>
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" className="h-8 text-[10px]" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft size={13} />Previous</Button><Button variant="outline" size="sm" className="h-8 text-[10px]" disabled={!report.pagination.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>Next<ChevronRight size={13} /></Button></div>
          </footer>

          <details className="border-t border-[#e7edf5] bg-white p-4 text-[11px] text-[#5d6c86]"><summary className="cursor-pointer font-black text-[#344666]">Coverage limits · read before relying on reconciliation</summary><ul className="mt-2 list-disc space-y-1 pl-4 leading-5">{report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>
        </>
      )}

      <OwnerPinModal
        open={Boolean(approval)}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        reasonRequired={copy.reasonRequired}
        reasonLabel={approval?.kind === "match" ? "Matching note for evidence" : approval?.kind === "import" ? "Import note (optional)" : "Reason for audit trail"}
        loading={busy}
        error={approvalError}
        onCancel={() => { if (!busy) { setApproval(null); setApprovalError(null); } }}
        onConfirm={({ ownerPin, reason }) => confirmApproval(ownerPin, reason)}
      />
    </article>
  );
}

function TransactionCard({
  transaction,
  selected,
  onToggle,
  onMatchSelected,
  onQuickMatch,
  onUnmatch,
  onIgnore,
  onRestore,
}: {
  transaction: BankStatementTransaction;
  selected: string[];
  onToggle: (ledgerRowId: string, checked: boolean) => void;
  onMatchSelected: () => void;
  onQuickMatch: (candidate: BankReconciliationCandidate) => void;
  onUnmatch: () => void;
  onIgnore: () => void;
  onRestore: () => void;
}) {
  const top = transaction.suggestions[0];
  const selectedTotal = transaction.allocationOptions
    .filter((candidate) => selected.includes(candidate.ledgerRowId))
    .reduce((sum, candidate) => sum + candidate.amount.amount, 0);

  return (
    <div className="overflow-hidden rounded-[9px] border border-[#dfe7f2] bg-white shadow-[0_2px_10px_rgba(31,60,110,0.035)]">
      <div className="grid gap-4 p-3 lg:grid-cols-[minmax(230px,0.9fr)_minmax(340px,1.45fr)] lg:p-4">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[7px]", transaction.direction === "credit" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>{transaction.direction === "credit" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span>
              <div className="min-w-0"><p className="truncate text-xs font-black text-[#17294d]">{transaction.description}</p><p className="mt-1 truncate text-[10px] text-[#718099]">{transaction.reference || "No statement reference"} · {dateLabel(transaction.transactionDate)}</p></div>
            </div>
            <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[9px] font-extrabold capitalize", statusTone(transaction.matchStatus))}>{transaction.matchStatus}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniValue label={transaction.direction === "credit" ? "Money in" : "Money out"} value={money(transaction.amount.amount)} />
            <MiniValue label="Remaining" value={money(transaction.remainingAmount.amount)} alert={transaction.remainingAmount.paise > 0 && transaction.matchStatus !== "ignored"} />
          </div>
          <p className="mt-2 truncate text-[9px] font-semibold uppercase tracking-wide text-[#8a96aa]">{transaction.import.accountName}{transaction.import.accountLast4 ? ` · •••• ${transaction.import.accountLast4}` : ""} · row {transaction.rowNumber}</p>
          {transaction.allocations.length ? (
            <div className="mt-3 rounded-[7px] border border-emerald-200 bg-emerald-50/70 p-2.5">
              <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black text-emerald-900">{transaction.allocations.length} active ledger link{transaction.allocations.length === 1 ? "" : "s"}</p><button type="button" onClick={onUnmatch} className="inline-flex items-center gap-1 text-[9px] font-extrabold text-rose-700 hover:underline"><Unlink2 size={11} />Reverse</button></div>
              <div className="mt-1 space-y-1">{transaction.allocations.map((allocation) => <p key={allocation.id} className="truncate text-[9px] text-emerald-800">{allocation.ledgerRow?.entryType ?? "ledger impact"} · {money(allocation.amount.amount)} · {dateLabel(allocation.ledgerRow?.businessDate ?? allocation.matchedAt)}</p>)}</div>
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            {transaction.matchStatus === "ignored" ? <Button variant="outline" size="sm" className="h-7 text-[9px]" onClick={onRestore}><RotateCcw size={11} />Restore</Button> : transaction.reconciledAmount.paise === 0 ? <Button variant="ghost" size="sm" className="h-7 text-[9px] text-[#687790]" onClick={onIgnore}>Ignore with reason</Button> : null}
          </div>
        </div>

        <div className="min-w-0 rounded-[8px] border border-[#e4eaf3] bg-[#fbfcfe] p-3">
          {transaction.matchStatus === "ignored" ? (
            <div className="flex h-full min-h-24 items-center justify-center text-center"><div><p className="text-[11px] font-black text-[#53627b]">Excluded with owner reason</p><p className="mt-1 text-[10px] leading-4 text-[#7b879b]">{transaction.ignoredReason}</p></div></div>
          ) : transaction.remainingAmount.paise === 0 ? (
            <div className="flex h-full min-h-24 items-center justify-center text-center"><div><CheckCircle2 className="mx-auto text-emerald-600" size={20} /><p className="mt-2 text-[11px] font-black text-emerald-900">Fully reconciled</p><p className="mt-1 text-[10px] text-emerald-700">Owner-confirmed links equal the statement amount.</p></div></div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wide text-[#52617c]">Recorded ledger candidates</p><p className="mt-1 text-[9px] leading-4 text-[#7b879b]">Suggestions: exact amount + direction within ±3 days · manual options up to ±30 days</p></div>{top ? <span className={cn("rounded-full px-2 py-1 text-[9px] font-extrabold", top.ambiguous ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-800")}>{top.ambiguous ? "Ambiguous tie" : "Exact candidate"}</span> : null}</div>
              {top ? (
                <div className="mt-2 flex flex-col gap-2 rounded-[7px] border border-blue-200 bg-blue-50/70 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><p className="truncate text-[10px] font-black text-blue-950">{top.entryType} · {money(top.amount.amount)}</p><p className="mt-0.5 truncate text-[9px] text-blue-800">{top.referenceMatched ? "Reference + amount + direction + date evidence" : "Amount + direction + date evidence"} · {top.dateDeltaDays}d gap</p></div>
                  <Button size="sm" className="h-7 shrink-0 rounded-[6px] text-[9px]" onClick={() => onQuickMatch(top)} disabled={Boolean(top.ambiguous)}>Review exact match</Button>
                </div>
              ) : null}
              <div className="mt-2 space-y-1.5">
                {transaction.allocationOptions.slice(0, 6).map((candidate) => (
                  <label key={candidate.ledgerRowId} className="flex cursor-pointer items-center gap-2 rounded-[6px] border border-[#e2e8f1] bg-white p-2 hover:border-blue-300">
                    <Checkbox checked={selected.includes(candidate.ledgerRowId)} onCheckedChange={(checked) => onToggle(candidate.ledgerRowId, checked === true)} aria-label={`Select ${candidate.entryType} ${money(candidate.amount.amount)}`} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-bold text-[#24385f]">{candidate.entryType} · {candidate.sourceId}</span><span className="block truncate text-[9px] text-[#7b879b]">{dateLabel(candidate.businessDate)} · {candidate.dateDeltaDays}d gap · {candidate.confidence.replaceAll("_", " ")}</span></span>
                    <strong className="shrink-0 text-[10px] text-[#17294d]">{money(candidate.amount.amount)}</strong>
                  </label>
                ))}
                {!transaction.allocationOptions.length ? <div className="rounded-[7px] border border-dashed border-[#ccd7e6] p-3 text-center text-[10px] leading-4 text-[#718099]">No direct recorded bank/UPI impact matches this direction and date window. Record the missing ledger event or review it manually; the app will not invent a match.</div> : null}
                {transaction.allocationOptions.length > 6 ? <p className="text-[9px] text-[#7b879b]">Showing the first 6 of {transaction.allocationOptions.length} deterministic options. Narrow the date range for a smaller evidence set.</p> : null}
              </div>
              {selected.length ? <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#e4eaf3] pt-2"><p className="text-[9px] font-semibold text-[#63728b]">{selected.length} selected · {money(selectedTotal)}</p><Button size="sm" className="h-7 rounded-[6px] text-[9px]" onClick={onMatchSelected}>Review allocation</Button></div> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><Label className="text-[9px] font-bold uppercase tracking-wide text-[#6e7c94]">{label}</Label><div className="mt-1">{children}</div></div>;
}

function SummaryStat({ label, value, detail, alert, good }: { label: string; value: string; detail: string; alert?: boolean; good?: boolean }) {
  return <div className="min-w-0 bg-white p-3"><p className="truncate text-[9px] font-bold uppercase tracking-wide text-[#74819a]">{label}</p><p className={cn("mt-1 truncate text-base font-black", alert ? "text-amber-700" : good ? "text-emerald-700" : "text-[#10224a]")}>{value}</p><p className="mt-0.5 truncate text-[10px] text-[#7b89a0]">{detail}</p></div>;
}

function MiniValue({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return <div className="rounded-[6px] bg-[#f4f7fb] p-2"><p className="text-[9px] text-[#74819a]">{label}</p><p className={cn("mt-0.5 truncate text-xs font-black", alert ? "text-amber-700" : "text-[#17294d]")}>{value}</p></div>;
}
