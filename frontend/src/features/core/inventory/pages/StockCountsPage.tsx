import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveX, Check, CheckCircle2, ClipboardCheck, EyeOff, Loader2, PackageSearch, Play, RefreshCw, Save, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAppLanguage } from "@/features/core/settings/i18n";
import {
  createStockCount,
  decideStockCount,
  getStockCount,
  getStockCounts,
  readStockCountMemoryCache,
  STOCK_COUNT_CACHE_KEYS,
  stockCountCacheUpdatedAt,
  submitStockCount,
  updateStockCountLines,
  type StockCountLine,
  type StockCountSession,
} from "../api";
import { useOfflineStatus } from "@/features/core/sync/useOfflineStatus";

type Draft = { quantity: string; reason: string };
type Approval = "apply" | "cancel" | null;

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.05)]";
const statusStyle: Record<StockCountSession["status"], string> = {
  counting: "bg-blue-50 text-blue-700 ring-blue-200",
  review: "bg-amber-50 text-amber-700 ring-amber-200",
  applied: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

const QTY_FORMAT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function displayQty(value: number | null | undefined) {
  const { t } = useAppLanguage();
  return value === null || value === undefined ? "—" : QTY_FORMAT.format(value);
}

function batches<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export default function StockCountsPage() {
  const { t } = useAppLanguage();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isOnline } = useOfflineStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [name, setName] = useState("");
  const [blindCount, setBlindCount] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [approval, setApproval] = useState<Approval>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const listCacheKey = STOCK_COUNT_CACHE_KEYS.list("all", 30);
  const listQ = useQuery({
    queryKey: ["stock-counts"],
    queryFn: () => getStockCounts("all", 30),
    initialData: () => readStockCountMemoryCache<StockCountSession[]>(listCacheKey),
    initialDataUpdatedAt: () => stockCountCacheUpdatedAt(listCacheKey),
  });
  const active = listQ.data?.find((item) => item.status === "counting" || item.status === "review");

  useEffect(() => {
    if (!selectedId && listQ.data?.length) setSelectedId(active?.id ?? listQ.data[0].id);
  }, [active?.id, listQ.data, selectedId]);

  const detailQ = useQuery({
    queryKey: ["stock-count", selectedId],
    queryFn: () => getStockCount(selectedId!),
    enabled: Boolean(selectedId),
    initialData: () => selectedId ? readStockCountMemoryCache<StockCountSession>(STOCK_COUNT_CACHE_KEYS.detail(selectedId)) : undefined,
    initialDataUpdatedAt: () => selectedId ? stockCountCacheUpdatedAt(STOCK_COUNT_CACHE_KEYS.detail(selectedId)) : 0,
  });
  const session = detailQ.data;

  useEffect(() => {
    if (!session) return;
    setDrafts(Object.fromEntries(session.lines.map((line) => [line.productId, {
      quantity: line.countedBaseQty === null ? "" : String(line.countedBaseQty),
      reason: line.reason ?? "",
    }])));
    setDirty(new Set());
  }, [session?.id, session?.updatedAt, session?.summary.countedLines]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (session?.lines ?? []).filter((line) => !term || line.productName.toLocaleLowerCase().includes(term));
  }, [search, session?.lines]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const effectiveCounted = session?.lines.filter((line) => (drafts[line.productId]?.quantity ?? "").trim() !== "").length ?? 0;
  const effectiveRemaining = Math.max(0, (session?.summary.totalLines ?? 0) - effectiveCounted);
  const progress = session?.summary.totalLines ? Math.round(effectiveCounted / session.summary.totalLines * 100) : 0;

  function refresh(data?: StockCountSession) {
    if (data) {
      queryClient.setQueryData(["stock-count", data.id], data);
      queryClient.setQueryData<StockCountSession[]>(["stock-counts"], (current = []) => [data, ...current.filter((row) => row.id !== data.id)]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 30));
    }
    void queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }

  const startMutation = useMutation({
    mutationFn: () => createStockCount({ name: name.trim(), blindCount }),
    onSuccess: (data) => {
      setSelectedId(data.id); setStartOpen(false); setName(""); refresh(data);
      // Naming what was left out matters more than the count that succeeded: a
      // per-pack product is missing from the list on purpose, and without this the
      // shopkeeper walks the aisle looking for a row that is never going to appear.
      const skipped = data.excludedPerPackProducts ?? [];
      const skippedNote = skipped.length
        ? ` ${skipped.length === 1 ? `${skipped[0].name} is` : `${skipped.length} products are`} counted per pack size and must be recounted on the product itself.`
        : "";
      toast({ title: t("inventory.counts.started"), description: `${data.summary.totalLines} products were snapshotted for ${data.location.name}.${skippedNote}` });
    },
    onError: (error: Error) => toast({ title: t("inventory.counts.notStarted"), description: error.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error(t("inventory.counts.chooseCountFirst"));
      const changes = [...dirty].map((productId) => ({
        productId,
        countedBaseQty: Number(drafts[productId]?.quantity),
        ...(drafts[productId]?.reason.trim() ? { reason: drafts[productId].reason.trim() } : {}),
      }));
      if (!changes.length) return session;
      if (changes.some((line) => !Number.isFinite(line.countedBaseQty) || line.countedBaseQty < 0 || drafts[line.productId]?.quantity.trim() === "")) throw new Error(t("inventory.counts.countsMustBeZeroOrMore"));
      let result = session;
      for (const chunk of batches(changes, 500)) result = await updateStockCountLines(session.id, chunk);
      return result;
    },
    onSuccess: (data) => { refresh(data); toast({ title: t("inventory.counts.progressSaved"), description: t("inventory.counts.resumeSafely") }); },
    onError: (error: Error) => toast({ title: t("inventory.counts.progressNotSaved"), description: error.message, variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error(t("inventory.counts.chooseCount"));
      if (dirty.size) await saveMutation.mutateAsync();
      return submitStockCount(session.id);
    },
    onSuccess: (data) => { refresh(data); toast({ title: t("inventory.counts.readyForReview"), description: t("inventory.counts.variancesVisible") }); },
    onError: (error: Error) => toast({ title: t("inventory.counts.notSubmitted"), description: error.message, variant: "destructive" }),
  });

  const decisionMutation = useMutation({
    mutationFn: ({ ownerPin, reason }: { ownerPin: string; reason: string }) => {
      if (!session || !approval) throw new Error(t("inventory.counts.noActionSelected"));
      return decideStockCount(session.id, approval, { ownerPin, note: reason });
    },
    onSuccess: (data) => {
      const action = approval; setApproval(null); setApprovalError(null); refresh(data);
      toast({ title: action === "apply" ? t("inventory.counts.applied") : t("inventory.counts.cancelled"), description: action === "apply" ? t("inventory.counts.appliedHelp") : t("inventory.counts.cancelledHelp") });
    },
    onError: (error: Error) => setApprovalError(error.message),
  });

  function changeLine(line: StockCountLine, field: keyof Draft, value: string) {
    setDrafts((current) => ({ ...current, [line.productId]: { quantity: current[line.productId]?.quantity ?? "", reason: current[line.productId]?.reason ?? "", [field]: value } }));
    setDirty((current) => new Set(current).add(line.productId));
  }

  const completed = (listQ.data ?? []).filter((item) => item.status === "applied" || item.status === "cancelled");

  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-[24px] border border-indigo-100 bg-[radial-gradient(circle_at_top_right,#dbeafe_0,transparent_38%),linear-gradient(135deg,#071a3b,#163d85)] p-6 text-white shadow-[0_24px_60px_rgba(15,49,104,0.18)] sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-blue-100"><ClipboardCheck size={14} /> {t("inventory.counts.eyebrow")}</div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("inventory.counts.title")}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-blue-100/90">{t("inventory.counts.subtitle")}</p>
          </div>
          <Button className="bg-white font-black text-blue-700 hover:bg-blue-50" onClick={() => setStartOpen(true)} disabled={!isOnline || Boolean(active)}><Play size={16} /> {t("inventory.counts.start")}</Button>
        </div>
      </section>

      {!isOnline && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" data-testid="stock-counts-offline-readonly"><p className="font-black">{t("inventory.counts.offlineReadOnly")}</p><p className="mt-1 text-xs leading-5">{t("inventory.counts.offlineReadOnlyHelp")}</p></div>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("inventory.counts.branchStatus")}</p><div className="mt-2 flex items-center gap-2 text-xl font-black text-slate-900">{active ? <><RefreshCw size={20} className="text-blue-600" /> {t("inventory.counts.inProgress")}</> : <><CheckCircle2 size={20} className="text-emerald-600" /> {t("inventory.counts.ready")}</>}</div><p className="mt-1 text-xs text-slate-500">{t("inventory.counts.oneOpenPerLocation")}</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("inventory.counts.progress")}</p><p className="mt-2 text-3xl font-black text-slate-900">{active ? `${active.summary.countedLines}/${active.summary.totalLines}` : "—"}</p><Progress value={active ? Math.round(active.summary.countedLines / Math.max(1, active.summary.totalLines) * 100) : 0} className="mt-2 h-1.5" /></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("inventory.counts.appliedHistory")}</p><p className="mt-2 text-3xl font-black text-slate-900">{completed.filter((item) => item.status === "applied").length}</p><p className="mt-1 text-xs text-slate-500">{t("inventory.counts.recentSessions")}</p></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className={`${card} h-fit overflow-hidden`}>
          <div className="border-b border-slate-100 p-4"><h2 className="text-sm font-black text-slate-900">{t("inventory.counts.sessions")}</h2><p className="mt-0.5 text-xs text-slate-500">{t("inventory.counts.currentBranchOnly")}</p></div>
          <div className="max-h-[610px] divide-y divide-slate-100 overflow-y-auto">
            {(listQ.data ?? []).map((item) => <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setSearch(""); setPage(1); }} className={cn("w-full p-4 text-left transition hover:bg-slate-50", selectedId === item.id && "bg-blue-50/70")}>
              <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-black text-slate-900">{item.name}</p><span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase ring-1", statusStyle[item.status])}>{item.status}</span></div>
              <p className="mt-1.5 text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString("en-IN")}</p><p className="mt-1 text-[11px] font-semibold text-slate-600">{t("inventory.counts.productsCounted", { counted: item.summary.countedLines, total: item.summary.totalLines })}</p>
            </button>)}
            {!listQ.isLoading && !listQ.data?.length && <div className="p-8 text-center"><PackageSearch className="mx-auto text-slate-300" /><p className="mt-2 text-xs font-bold text-slate-600">{t("inventory.counts.empty")}</p></div>}
          </div>
        </aside>

        <main className={`${card} min-w-0 overflow-hidden`}>
          {detailQ.isLoading && <div className="grid min-h-[420px] place-items-center"><Loader2 className="animate-spin text-blue-600" /></div>}
          {!detailQ.isLoading && !session && <div className="grid min-h-[420px] place-items-center p-8 text-center"><div><ClipboardCheck className="mx-auto text-slate-300" size={38} /><p className="mt-3 font-black text-slate-800">{t("inventory.counts.emptyHelp")}</p><p className="mt-1 text-sm text-slate-500">{t("inventory.counts.snapshotHelp")}</p></div></div>}
          {session && <>
            <div className="border-b border-slate-100 p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black text-slate-900">{session.name}</h2><span className={cn("rounded-full px-2.5 py-1 text-[10px] font-black uppercase ring-1", statusStyle[session.status])}>{session.status}</span>{session.blindCount && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700 ring-1 ring-violet-200"><EyeOff size={11} /> {t("inventory.counts.blind")}</span>}</div><p className="mt-1 text-xs text-slate-500">{session.location.name} {t("inventory.counts.startedAt", { when: new Date(session.createdAt).toLocaleString("en-IN") })}</p></div>
                <div className="flex flex-wrap gap-2">
                  {(session.status === "counting" || session.status === "review") && <Button variant="outline" disabled={!isOnline} className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => { setApprovalError(null); setApproval("cancel"); }}><ArchiveX size={15} /> {t("inventory.cancel")}</Button>}
                  {session.status === "counting" && <><Button variant="outline" disabled={!isOnline || !dirty.size || saveMutation.isPending} onClick={() => saveMutation.mutate()}><Save size={15} /> {saveMutation.isPending ? t("inventory.counts.saving") : `${t("inventory.counts.saveAction")}${dirty.size ? ` (${dirty.size})` : ""}`}</Button><Button disabled={!isOnline || effectiveRemaining > 0 || submitMutation.isPending || saveMutation.isPending} onClick={() => submitMutation.mutate()}><ClipboardCheck size={15} /> {submitMutation.isPending ? t("inventory.counts.submitting") : t("inventory.counts.submitForReview")}</Button></>}
                  {session.status === "review" && <Button disabled={!isOnline} className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setApprovalError(null); setApproval("apply"); }}><ShieldCheck size={15} /> {t("inventory.counts.apply")}</Button>}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="mb-1 flex justify-between text-[11px] font-bold text-slate-600"><span>{t("inventory.counts.countedLabel", { count: effectiveCounted })}</span><span>{progress}%</span></div><Progress value={progress} className="h-2" /></div>{session.status === "counting" && effectiveRemaining > 0 && <p className="text-xs font-bold text-amber-700">{t("inventory.counts.remainingLabel", { count: effectiveRemaining })}</p>}</div>
              {session.status === "review" && <div className={cn("mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border p-3 text-xs font-bold", session.summary.varianceLines ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}><span className="inline-flex items-center gap-1.5">{session.summary.varianceLines ? <TriangleAlert size={15} /> : <Check size={15} />}{t("inventory.counts.varianceProducts", { count: session.summary.varianceLines })}</span><span>{t("inventory.counts.netVariance", { qty: displayQty(session.summary.netVarianceBaseQty) })}</span></div>}
            </div>

            <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="bg-white pl-9" placeholder={t("inventory.counts.searchProduct")} /></div><p className="text-xs font-semibold text-slate-500">{t("inventory.counts.showingOf", { shown: visible.length, total: filtered.length })}</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">{t("inventory.col.product")}</th>{session.status !== "counting" || !session.blindCount ? <th className="px-3 py-3 text-right">{t("inventory.counts.expected")}</th> : null}<th className="px-3 py-3 text-right">{t("inventory.counts.counted")}</th>{session.status !== "counting" ? <th className="px-3 py-3 text-right">{t("inventory.counts.variance")}</th> : null}<th className="px-5 py-3">{t("inventory.col.note")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((line) => {
                    const draft = drafts[line.productId] ?? { quantity: "", reason: "" };
                    const variance = Number(line.varianceBaseQty ?? 0);
                    return <tr key={line.id} className={cn("transition", dirty.has(line.productId) && "bg-blue-50/50")}>
                      <td className="px-5 py-3"><p className="text-sm font-bold text-slate-900">{line.productName}</p><p className="text-[11px] text-slate-500">{t("inventory.counts.baseUnitLabel", { unit: line.baseUnit })}</p></td>
                      {session.status !== "counting" || !session.blindCount ? <td className="px-3 py-3 text-right text-sm font-semibold text-slate-600">{displayQty(line.expectedBaseQty)}</td> : null}
                      <td className="px-3 py-3 text-right">{session.status === "counting" ? <Input aria-label={`Counted quantity for ${line.productName}`} disabled={!isOnline} className="ml-auto w-28 text-right font-bold" type="number" min="0" step="any" value={draft.quantity} onChange={(event) => changeLine(line, "quantity", event.target.value)} placeholder="0" /> : <span className="text-sm font-black text-slate-900">{displayQty(line.countedBaseQty)}</span>}</td>
                      {session.status !== "counting" && <td className={cn("px-3 py-3 text-right text-sm font-black", Math.sign(variance) === 1 ? "text-emerald-700" : Math.sign(variance) === -1 ? "text-rose-700" : "text-slate-500")}>{variance > 0 ? "+" : ""}{displayQty(line.varianceBaseQty)}</td>}
                      <td className="px-5 py-3">{session.status === "counting" ? <Input aria-label={`Count note for ${line.productName}`} disabled={!isOnline} className="min-w-44" value={draft.reason} onChange={(event) => changeLine(line, "reason", event.target.value.slice(0, 300))} placeholder={t("inventory.counts.notePlaceholder")} /> : <span className="text-xs text-slate-600">{line.reason || "—"}</span>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && <div className="flex items-center justify-between border-t border-slate-100 p-4"><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>{t("inventory.counts.previous")}</Button><p className="text-xs font-bold text-slate-500">{t("inventory.counts.pageOf", { page: currentPage, pages: pageCount })}</p><Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>{t("inventory.counts.next")}</Button></div>}
          </>}
        </main>
      </div>

      <Dialog open={startOpen} onOpenChange={setStartOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t("inventory.counts.startTitle")}</DialogTitle><DialogDescription>{t("inventory.counts.startHelp")}</DialogDescription></DialogHeader><div className="space-y-4 py-3"><div className="space-y-2"><Label>{t("inventory.counts.name")}</Label><Input autoFocus value={name} onChange={(event) => setName(event.target.value.slice(0, 120))} placeholder={`Full count · ${new Date().toLocaleDateString("en-IN")}`} /></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4"><Checkbox checked={blindCount} onCheckedChange={(checked) => setBlindCount(checked === true)} /><span><span className="block text-sm font-black text-violet-950">{t("inventory.counts.blindRecommended")}</span><span className="mt-0.5 block text-xs leading-5 text-violet-700">{t("inventory.counts.blindHelp")}</span></span></label><p className="text-xs leading-5 text-slate-500">{t("inventory.counts.scopeHelp")}</p></div><DialogFooter><Button variant="outline" onClick={() => setStartOpen(false)} disabled={startMutation.isPending}>{t("inventory.cancel")}</Button><Button onClick={() => startMutation.mutate()} disabled={!isOnline || name.trim().length < 3 || startMutation.isPending}>{startMutation.isPending ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />} {startMutation.isPending ? "Starting…" : "Start count"}</Button></DialogFooter></DialogContent></Dialog>

      <OwnerPinModal open={Boolean(approval && isOnline)} title={approval === "apply" ? t("inventory.counts.applyTitle") : t("inventory.counts.cancelTitleAction")} description={approval === "apply" ? t("inventory.counts.applyHelp") : t("inventory.counts.cancelHelp")} confirmLabel={approval === "apply" ? t("inventory.counts.apply") : t("inventory.counts.cancelCount")} reasonRequired reasonLabel={approval === "apply" ? "Approval note for audit trail" : "Cancellation reason"} loading={decisionMutation.isPending} error={approvalError} onCancel={() => { if (!decisionMutation.isPending) { setApproval(null); setApprovalError(null); } }} onConfirm={(payload) => { if (isOnline) decisionMutation.mutate(payload); }} />
    </div>
  );
}
