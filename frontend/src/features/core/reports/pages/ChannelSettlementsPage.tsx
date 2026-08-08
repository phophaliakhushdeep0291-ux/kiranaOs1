import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, RotateCcw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { Link } from "wouter";
import { useAppLanguage, type TranslationKey } from "@/features/core/settings/i18n";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getActiveLocationId } from "@/features/core/stores/location-context";
import {
  getChannelSettlementReport,
  importChannelSettlement,
  resolveChannelSettlementRow,
  type ChannelSettlementMapping,
  type ChannelSettlementRow,
} from "../channel-settlement-api";

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.055)]";
const fieldLabels: Array<[keyof ChannelSettlementMapping, TranslationKey, boolean]> = [
  ["externalOrderId", "reports.settlement.field.externalOrderId", true], ["orderDate", "reports.settlement.field.orderDate", true], ["orderStatus", "reports.settlement.field.orderStatus", false],
  ["gross", "reports.settlement.field.gross", true], ["merchantDiscount", "reports.settlement.field.merchantDiscount", false], ["platformCommission", "reports.settlement.field.platformCommission", false],
  ["paymentFee", "reports.settlement.field.paymentFee", false], ["taxOnFees", "reports.settlement.field.taxOnFees", false], ["tcs", "reports.settlement.field.tcs", false], ["tds", "reports.settlement.field.tds", false],
  ["adjustment", "reports.settlement.field.adjustment", false], ["refund", "reports.settlement.field.refund", false], ["expectedNet", "reports.settlement.field.expectedNet", false], ["paidNet", "reports.settlement.field.paidNet", true],
];
const aliases: Record<keyof ChannelSettlementMapping, string[]> = {
  externalOrderId: ["orderid", "externalorderid", "ordernumber"], orderDate: ["orderdate", "date", "transactiondate"], orderStatus: ["status", "orderstatus"],
  gross: ["gross", "grossamount", "ordervalue", "ordertotal"], merchantDiscount: ["merchantdiscount", "restaurantdiscount", "sellerdiscount"],
  platformCommission: ["commission", "platformcommission"], paymentFee: ["paymentfee", "gatewayfee"], taxOnFees: ["gstonfees", "taxonfees"],
  tcs: ["tcs"], tds: ["tds"], adjustment: ["adjustment", "adjustments"], refund: ["refund", "refundamount"],
  expectedNet: ["expectednet", "netpayable"], paidNet: ["paidnet", "netpaid", "payout", "settlementamount"],
};
type Approval = { type: "import" } | { type: "resolve"; row: ChannelSettlementRow; input: ResolveInput } | null;
type ResolveInput = { action: "match" | "ignore" | "reverse"; customerOrderId?: string; billId?: string; bankStatementTransactionId?: string; reason?: string };

function normalize(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""); }
function money(amount = 0) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount); }
export function parseHeader(text: string) {
  const line = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const values: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(field.trim()); field = ""; }
    else field += char;
  }
  values.push(field.trim()); return values.filter(Boolean);
}
export function automaticMapping(headers: string[]) {
  const next = {} as ChannelSettlementMapping;
  for (const [key] of fieldLabels) {
    const match = headers.find((header) => aliases[key].includes(normalize(header)));
    if (match) next[key] = match;
  }
  return next;
}
const mismatchKeys: Record<string, TranslationKey> = {
  missing_order: "reports.settlement.mismatch.missing_order",
  ambiguous_order: "reports.settlement.mismatch.ambiguous_order",
  duplicate_settlement: "reports.settlement.mismatch.duplicate_settlement",
  net_mismatch: "reports.settlement.mismatch.net_mismatch",
  expected_net_formula_mismatch: "reports.settlement.mismatch.expected_net_formula_mismatch",
  unpaid_order: "reports.settlement.mismatch.unpaid_order",
  gross_mismatch: "reports.settlement.mismatch.gross_mismatch",
  status_mismatch: "reports.settlement.mismatch.status_mismatch",
};
const limitationKeys: TranslationKey[] = [
  "reports.settlement.boundaryOwnerMapping",
  "reports.settlement.boundarySuggestions",
  "reports.settlement.boundaryContracts",
  "reports.settlement.boundaryLedger",
];
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

export default function ChannelSettlementsPage() {
  const { t } = useAppLanguage();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [resolutionStatus, setResolutionStatus] = useState<"all" | "open" | "matched" | "ignored">("all");
  const [mismatchType, setMismatchType] = useState("all");
  const reportQ = useQuery({ queryKey: ["channel-settlements", resolutionStatus, mismatchType], queryFn: () => getChannelSettlementReport({ resolutionStatus, mismatchType, limit: 100 }) });
  const [importOpen, setImportOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ChannelSettlementMapping>({} as ChannelSettlementMapping);
  const [draft, setDraft] = useState<{ row: ChannelSettlementRow; input: ResolveInput } | null>(null);
  const [approval, setApproval] = useState<Approval>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const requiredReady = Boolean(mapping.externalOrderId && mapping.orderDate && mapping.gross && mapping.paidNet && provider.trim() && csvText);
  const summary = reportQ.data?.summary;
  const biggestVariance = useMemo(() => [...(reportQ.data?.rows ?? [])].sort((a, b) => Math.abs(b.variance.paise) - Math.abs(a.variance.paise))[0], [reportQ.data?.rows]);

  const importM = useMutation({
    mutationFn: (ownerPin: string) => importChannelSettlement({ provider: provider.trim(), ...(getActiveLocationId() ? { locationId: getActiveLocationId()! } : {}), fileName, csvText, mapping }, ownerPin),
    onSuccess: (result) => {
      setApproval(null); setApprovalError(null); setImportOpen(false); setProvider(""); setFileName(""); setCsvText(""); setHeaders([]); setMapping({} as ChannelSettlementMapping);
      void queryClient.invalidateQueries({ queryKey: ["channel-settlements"] });
      toast({
        title: t(result.idempotentReplay ? "reports.settlement.alreadyImported" : "reports.settlement.imported"),
        description: t("reports.settlement.importedHint", { count: result.rowCount, amount: money(result.paidNet.amount) }),
      });
    },
    onError: (error) => setApprovalError(errorMessage(error, t("reports.settlement.genericError"))),
  });
  const resolveM = useMutation({
    mutationFn: ({ ownerPin, row, input }: { ownerPin: string; row: ChannelSettlementRow; input: ResolveInput }) => resolveChannelSettlementRow(row.id, input, ownerPin),
    onSuccess: (result) => { setApproval(null); setDraft(null); setApprovalError(null); void queryClient.invalidateQueries({ queryKey: ["channel-settlements"] }); toast({ title: t(result.resolutionStatus === "matched" ? "reports.settlement.orderMatched" : result.resolutionStatus === "ignored" ? "reports.settlement.rowIgnored" : "reports.settlement.resolutionReversed"), description: t("reports.settlement.historyUpdated") }); },
    onError: (error) => setApprovalError(errorMessage(error, t("reports.settlement.genericError"))),
  });

  async function pickFile(file?: File) {
    if (!file) return;
    const text = await file.text(); const nextHeaders = parseHeader(text);
    setFileName(file.name); setCsvText(text); setHeaders(nextHeaders); setMapping(automaticMapping(nextHeaders));
  }
  function startAction(row: ChannelSettlementRow, action: ResolveInput["action"]) {
    setDraft({ row, input: { action, ...(action === "match" && row.candidateCustomerOrderId ? { customerOrderId: row.candidateCustomerOrderId, ...(row.candidateBillId ? { billId: row.candidateBillId } : {}) } : {}) } });
  }
  function continueAction() {
    if (!draft) return;
    if (draft.input.action === "match" && !draft.input.customerOrderId?.trim()) return;
    if (draft.input.action !== "match" && (draft.input.reason?.trim().length ?? 0) < 5) return;
    setApprovalError(null); setApproval({ type: "resolve", row: draft.row, input: draft.input });
  }

  return <div className="space-y-5 pb-12">
    <section className="overflow-hidden rounded-[24px] border border-indigo-100 bg-[radial-gradient(circle_at_top_right,#c7d2fe_0,transparent_36%),linear-gradient(135deg,#172554,#312e81)] p-6 text-white shadow-[0_24px_64px_rgba(30,41,110,0.24)] sm:p-8">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div className="max-w-3xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-indigo-100"><ShieldCheck size={14} /> {t("reports.settlement.controlBadge")}</div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("reports.settlement.title")}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-100/90">{t("reports.settlement.subtitle")}</p></div><div className="flex flex-wrap gap-2"><Link href="/reports"><Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20">{t("reports.settlement.backToReports")}</Button></Link><Button className="bg-white font-black text-indigo-800 hover:bg-indigo-50" onClick={() => setImportOpen(true)}><Upload size={16} /> {t("reports.settlement.importCsv")}</Button></div></div>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[ [t("reports.settlement.orders"), summary?.rowCount ?? 0, t("reports.settlement.openCount", { count: summary?.openCount ?? 0 })], [t("reports.settlement.gross"), money(summary?.gross.amount), t("reports.settlement.channelOrderValue")], [t("reports.settlement.expectedNet"), money(summary?.calculatedNet.amount), t("reports.settlement.afterDeductions")], [t("reports.settlement.paidNet"), money(summary?.paidNet.amount), t("reports.settlement.reportedPayout")], [t("reports.settlement.variance"), money(summary?.variance.amount), biggestVariance ? t("reports.settlement.largestVariance", { orderId: biggestVariance.externalOrderId }) : t("reports.settlement.noImportedRows")] ].map(([label, value, detail]) => <div key={String(label)} className={`${card} p-4`}><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 truncate text-xl font-black text-slate-950" title={String(value)}>{value}</p><p className="mt-1 truncate text-[11px] text-slate-500">{detail}</p></div>)}
    </div>

    {(reportQ.data?.rollups.length ?? 0) > 0 && <section className={`${card} overflow-hidden`}><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-black text-slate-900">{t("reports.settlement.rollupTitle")}</h2><p className="text-xs text-slate-500">{t("reports.settlement.rollupHint")}</p></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{reportQ.data!.rollups.map((rollup) => <div key={`${rollup.provider}-${rollup.locationId ?? "all"}`} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-900">{rollup.provider}</p><p className="text-xs text-slate-500">{rollup.locationName}</p></div><span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700">{t("reports.settlement.orderCount", { count: rollup.rowCount })}</span></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><span className="text-slate-500">{t("reports.settlement.paidNet")}</span><span className="text-right font-black">{money(rollup.paidNet.amount)}</span><span className="text-slate-500">{t("reports.settlement.variance")}</span><span className={`text-right font-black ${rollup.variance.paise ? "text-rose-600" : "text-emerald-700"}`}>{money(rollup.variance.amount)}</span></div></div>)}</div></section>}

    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-black text-slate-900">{t("reports.settlement.evidenceTitle")}</h2><p className="text-xs text-slate-500">{t("reports.settlement.evidenceHint")}</p></div>
        <div className="flex flex-wrap gap-2">
          <select className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold" value={resolutionStatus} onChange={(event) => setResolutionStatus(event.target.value as typeof resolutionStatus)}><option value="all">{t("reports.settlement.filterAllResolutions")}</option><option value="open">{t("reports.settlement.filterOpen")}</option><option value="matched">{t("reports.settlement.filterMatched")}</option><option value="ignored">{t("reports.settlement.filterIgnored")}</option></select>
          <select className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold" value={mismatchType} onChange={(event) => setMismatchType(event.target.value)}><option value="all">{t("reports.settlement.filterAllMismatches")}</option>{Object.keys(mismatchKeys).map((value) => <option key={value} value={value}>{t(mismatchKeys[value])}</option>)}</select>
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label={t("reports.settlement.refresh")} onClick={() => void reportQ.refetch()}><RefreshCw size={15} className={reportQ.isFetching ? "animate-spin" : ""} /></Button>
        </div>
      </div>
      {reportQ.isLoading ? (
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 className="animate-spin" size={17} /> {t("reports.settlement.loading")}</div>
      ) : reportQ.isError ? (
        <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="mr-2 inline" size={16} />{errorMessage(reportQ.error, t("reports.settlement.genericError"))}</div>
      ) : !(reportQ.data?.rows.length) ? (
        <div className="p-12 text-center"><FileSpreadsheet className="mx-auto text-slate-300" size={34} /><p className="mt-3 font-black text-slate-700">{t("reports.settlement.emptyTitle")}</p><p className="mt-1 text-xs text-slate-500">{t("reports.settlement.emptyHint")}</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><th className="px-4 py-3">{t("reports.settlement.colOrder")}</th><th className="px-3 py-3">{t("reports.settlement.colGross")}</th><th className="px-3 py-3">{t("reports.settlement.colDeductions")}</th><th className="px-3 py-3">{t("reports.settlement.colExpected")}</th><th className="px-3 py-3">{t("reports.settlement.colPaid")}</th><th className="px-3 py-3">{t("reports.settlement.variance")}</th><th className="px-3 py-3">{t("reports.settlement.colEvidence")}</th><th className="px-4 py-3 text-right">{t("reports.settlement.colAction")}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{reportQ.data.rows.map((row) => {
              const deductions = row.gross.amount - row.calculatedExpectedNet.amount + row.adjustment.amount;
              const matchLabel = row.matchStatus === "suggested" ? t("reports.settlement.matchSuggested") : row.resolutionStatus === "matched" ? t("reports.settlement.matchConfirmed") : row.resolutionStatus === "ignored" ? t("reports.settlement.matchIgnored") : t("reports.settlement.matchNone");
              return <tr key={row.id} className="align-top hover:bg-slate-50/70">
                <td className="px-4 py-4"><p className="font-mono font-black text-slate-900">{row.externalOrderId}</p><p className="mt-1 text-[10px] text-slate-500">{row.provider} · {new Date(row.orderDate).toLocaleDateString("en-IN")}</p><p className="mt-1 text-[10px] text-slate-500">{row.import.location?.name ?? t("reports.settlement.allLocations")}</p></td>
                <td className="px-3 py-4 font-black">{money(row.gross.amount)}</td><td className="px-3 py-4 text-slate-600">{money(deductions)}</td><td className="px-3 py-4 font-bold">{money(row.calculatedExpectedNet.amount)}</td><td className="px-3 py-4 font-bold">{money(row.paidNet.amount)}</td><td className={`px-3 py-4 font-black ${row.variance.paise ? "text-rose-600" : "text-emerald-700"}`}>{money(row.variance.amount)}</td>
                <td className="max-w-[280px] px-3 py-4"><div className="flex flex-wrap gap-1">{row.mismatches.length ? row.mismatches.map((item) => <span key={item} className="rounded-full bg-rose-50 px-2 py-1 text-[9px] font-black text-rose-700 ring-1 ring-rose-100">{mismatchKeys[item] ? t(mismatchKeys[item]) : item.replaceAll("_", " ")}</span>) : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black text-emerald-700"><CheckCircle2 size={11} /> {t("reports.settlement.amountsAgree")}</span>}</div><p className="mt-2 text-[10px] font-bold text-slate-500">{matchLabel}</p></td>
                <td className="px-4 py-4 text-right">{row.resolutionStatus === "open" ? <div className="flex justify-end gap-1"><Button size="sm" className="h-9 gap-1 text-[10px]" onClick={() => startAction(row, "match")}><ArrowLeftRight size={12} /> {t(row.candidateCustomerOrderId ? "reports.settlement.confirm" : "reports.settlement.match")}</Button><Button variant="outline" size="sm" className="h-9 text-[10px] text-slate-600" onClick={() => startAction(row, "ignore")}><XCircle size={12} /> {t("reports.settlement.ignore")}</Button></div> : <Button variant="outline" size="sm" className="h-9 gap-1 text-[10px]" onClick={() => startAction(row, "reverse")}><RotateCcw size={12} /> {t("reports.settlement.reverse")}</Button>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </section>

    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4"><div className="flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" /><div><p className="text-sm font-black text-amber-950">{t("reports.settlement.boundaries")}</p><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">{limitationKeys.map((key) => <li key={key}>• {t(key)}</li>)}</ul></div></div></section>

    <Dialog open={importOpen} onOpenChange={setImportOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t("reports.settlement.importTitle")}</DialogTitle><DialogDescription>{t("reports.settlement.importHint")}</DialogDescription></DialogHeader>
        <div className="space-y-5 py-2"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>{t("reports.settlement.channelLabel")}</Label><Input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder={t("reports.settlement.providerPlaceholder")} /></div><div className="space-y-2"><Label>{t("reports.settlement.csvFile")}</Label><Input type="file" accept=".csv,text/csv" onChange={(event) => void pickFile(event.target.files?.[0])} /></div></div>
          {headers.length > 0 && <div><div className="mb-3"><p className="text-sm font-black text-slate-900">{t("reports.settlement.mapFields")}</p><p className="text-xs text-slate-500">{t("reports.settlement.mapFieldsHint")}</p></div><div className="grid gap-3 sm:grid-cols-2">{fieldLabels.map(([key, labelKey, required]) => <div key={key} className="space-y-1.5"><Label>{t(labelKey)}{required ? " *" : ""}</Label><select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={mapping[key] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [key]: event.target.value || undefined }))}><option value="">{t(required ? "reports.settlement.requiredColumn" : "reports.settlement.optionalColumn")}</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></div>)}</div></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setImportOpen(false)}>{t("reports.settlement.cancel")}</Button><Button disabled={!requiredReady} onClick={() => { setApprovalError(null); setApproval({ type: "import" }); }}>{t("reports.settlement.reviewWithPin")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t(draft?.input.action === "match" ? "reports.settlement.matchTitle" : draft?.input.action === "ignore" ? "reports.settlement.ignoreTitle" : "reports.settlement.reverseTitle")}</DialogTitle><DialogDescription>{t(draft?.input.action === "match" ? "reports.settlement.matchHint" : "reports.settlement.historyHint")}</DialogDescription></DialogHeader>
        {draft && <div className="space-y-4 py-2">{draft.input.action === "match" && <><div className="space-y-2"><Label>{t("reports.settlement.posOrderId")}</Label><Input value={draft.input.customerOrderId ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, input: { ...current.input, customerOrderId: event.target.value } } : null)} placeholder={t("reports.settlement.orderIdPlaceholder")} /></div><div className="space-y-2"><Label>{t("reports.settlement.billId")}</Label><Input value={draft.input.billId ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, input: { ...current.input, billId: event.target.value || undefined } } : null)} /></div><div className="space-y-2"><Label>{t("reports.settlement.bankTxnId")}</Label><Input value={draft.input.bankStatementTransactionId ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, input: { ...current.input, bankStatementTransactionId: event.target.value || undefined } } : null)} /></div></>}<div className="space-y-2"><Label>{t(draft.input.action === "match" ? "reports.settlement.reviewNote" : "reports.settlement.reason")}</Label><Textarea value={draft.input.reason ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, input: { ...current.input, reason: event.target.value } } : null)} placeholder={t("reports.settlement.reasonPlaceholder")} /></div></div>}
        <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>{t("reports.settlement.cancel")}</Button><Button disabled={!draft || (draft.input.action === "match" ? !draft.input.customerOrderId?.trim() : (draft.input.reason?.trim().length ?? 0) < 5)} onClick={continueAction}>{t("reports.settlement.continueSecurely")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <OwnerPinModal open={Boolean(approval)} title={t(approval?.type === "import" ? "reports.settlement.approveImport" : "reports.settlement.approveDecision")} description={t(approval?.type === "import" ? "reports.settlement.approveImportHint" : "reports.settlement.approveDecisionHint")} confirmLabel={t(approval?.type === "import" ? "reports.settlement.importEvidence" : "reports.settlement.recordDecision")} loading={importM.isPending || resolveM.isPending} error={approvalError} onCancel={() => { if (!importM.isPending && !resolveM.isPending) { setApproval(null); setApprovalError(null); } }} onConfirm={({ ownerPin }) => { if (approval?.type === "import") importM.mutate(ownerPin); else if (approval?.type === "resolve") resolveM.mutate({ ownerPin, row: approval.row, input: approval.input }); }} />
  </div>;
}
