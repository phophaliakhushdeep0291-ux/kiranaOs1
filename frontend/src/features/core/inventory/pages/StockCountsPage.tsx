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
import {
  createStockCount,
  decideStockCount,
  getStockCount,
  getStockCounts,
  submitStockCount,
  updateStockCountLines,
  type StockCountLine,
  type StockCountSession,
} from "../api";

type Draft = { quantity: string; reason: string };
type Approval = "apply" | "cancel" | null;

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.05)]";
const statusStyle: Record<StockCountSession["status"], string> = {
  counting: "bg-blue-50 text-blue-700 ring-blue-200",
  review: "bg-amber-50 text-amber-700 ring-amber-200",
  applied: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

function displayQty(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function batches<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export default function StockCountsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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

  const listQ = useQuery({ queryKey: ["stock-counts"], queryFn: () => getStockCounts("all", 30) });
  const active = listQ.data?.find((item) => item.status === "counting" || item.status === "review");

  useEffect(() => {
    if (!selectedId && listQ.data?.length) setSelectedId(active?.id ?? listQ.data[0].id);
  }, [active?.id, listQ.data, selectedId]);

  const detailQ = useQuery({
    queryKey: ["stock-count", selectedId],
    queryFn: () => getStockCount(selectedId!),
    enabled: Boolean(selectedId),
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
    if (data) queryClient.setQueryData(["stock-count", data.id], data);
    void queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }

  const startMutation = useMutation({
    mutationFn: () => createStockCount({ name: name.trim(), blindCount }),
    onSuccess: (data) => {
      setSelectedId(data.id); setStartOpen(false); setName(""); refresh(data);
      toast({ title: "Stock count started", description: `${data.summary.totalLines} products were snapshotted for ${data.location.name}.` });
    },
    onError: (error: Error) => toast({ title: "Count not started", description: error.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("Choose a stock count first.");
      const changes = [...dirty].map((productId) => ({
        productId,
        countedBaseQty: Number(drafts[productId]?.quantity),
        ...(drafts[productId]?.reason.trim() ? { reason: drafts[productId].reason.trim() } : {}),
      }));
      if (!changes.length) return session;
      if (changes.some((line) => !Number.isFinite(line.countedBaseQty) || line.countedBaseQty < 0 || drafts[line.productId]?.quantity.trim() === "")) throw new Error("Every changed count must be zero or more.");
      let result = session;
      for (const chunk of batches(changes, 500)) result = await updateStockCountLines(session.id, chunk);
      return result;
    },
    onSuccess: (data) => { refresh(data); toast({ title: "Progress saved", description: "This count can be resumed safely on the branch." }); },
    onError: (error: Error) => toast({ title: "Progress not saved", description: error.message, variant: "destructive" }),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("Choose a count first.");
      if (dirty.size) await saveMutation.mutateAsync();
      return submitStockCount(session.id);
    },
    onSuccess: (data) => { refresh(data); toast({ title: "Ready for owner review", description: "Expected quantities and variances are now visible." }); },
    onError: (error: Error) => toast({ title: "Count not submitted", description: error.message, variant: "destructive" }),
  });

  const decisionMutation = useMutation({
    mutationFn: ({ ownerPin, reason }: { ownerPin: string; reason: string }) => {
      if (!session || !approval) throw new Error("No stock count action is selected.");
      return decideStockCount(session.id, approval, { ownerPin, note: reason });
    },
    onSuccess: (data) => {
      const action = approval; setApproval(null); setApprovalError(null); refresh(data);
      toast({ title: action === "apply" ? "Inventory updated" : "Stock count cancelled", description: action === "apply" ? "Every variance is posted to the permanent stock ledger." : "No inventory quantities were changed." });
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
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-blue-100"><ClipboardCheck size={14} /> Audited branch inventory control</div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Stock counts without guesswork</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-blue-100/90">Count the shelf without seeing system quantities, review variances with an owner, then post one protected adjustment to the branch ledger.</p>
          </div>
          <Button className="bg-white font-black text-blue-700 hover:bg-blue-50" onClick={() => setStartOpen(true)} disabled={Boolean(active)}><Play size={16} /> Start stock count</Button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Branch status</p><div className="mt-2 flex items-center gap-2 text-xl font-black text-slate-900">{active ? <><RefreshCw size={20} className="text-blue-600" /> In progress</> : <><CheckCircle2 size={20} className="text-emerald-600" /> Ready</>}</div><p className="mt-1 text-xs text-slate-500">Only one open count per location</p></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Count progress</p><p className="mt-2 text-3xl font-black text-slate-900">{active ? `${active.summary.countedLines}/${active.summary.totalLines}` : "—"}</p><Progress value={active ? Math.round(active.summary.countedLines / Math.max(1, active.summary.totalLines) * 100) : 0} className="mt-2 h-1.5" /></div>
        <div className={`${card} p-5`}><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Applied history</p><p className="mt-2 text-3xl font-black text-slate-900">{completed.filter((item) => item.status === "applied").length}</p><p className="mt-1 text-xs text-slate-500">Most recent 30 sessions shown</p></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className={`${card} h-fit overflow-hidden`}>
          <div className="border-b border-slate-100 p-4"><h2 className="text-sm font-black text-slate-900">Count sessions</h2><p className="mt-0.5 text-xs text-slate-500">Current branch only</p></div>
          <div className="max-h-[610px] divide-y divide-slate-100 overflow-y-auto">
            {(listQ.data ?? []).map((item) => <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setSearch(""); setPage(1); }} className={cn("w-full p-4 text-left transition hover:bg-slate-50", selectedId === item.id && "bg-blue-50/70")}>
              <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-black text-slate-900">{item.name}</p><span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase ring-1", statusStyle[item.status])}>{item.status}</span></div>
              <p className="mt-1.5 text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString("en-IN")}</p><p className="mt-1 text-[11px] font-semibold text-slate-600">{item.summary.countedLines}/{item.summary.totalLines} products counted</p>
            </button>)}
            {!listQ.isLoading && !listQ.data?.length && <div className="p-8 text-center"><PackageSearch className="mx-auto text-slate-300" /><p className="mt-2 text-xs font-bold text-slate-600">No stock counts yet</p></div>}
          </div>
        </aside>

        <main className={`${card} min-w-0 overflow-hidden`}>
          {detailQ.isLoading && <div className="grid min-h-[420px] place-items-center"><Loader2 className="animate-spin text-blue-600" /></div>}
          {!detailQ.isLoading && !session && <div className="grid min-h-[420px] place-items-center p-8 text-center"><div><ClipboardCheck className="mx-auto text-slate-300" size={38} /><p className="mt-3 font-black text-slate-800">Start a count to reconcile this branch</p><p className="mt-1 text-sm text-slate-500">A frozen snapshot keeps every variance explainable.</p></div></div>}
          {session && <>
            <div className="border-b border-slate-100 p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black text-slate-900">{session.name}</h2><span className={cn("rounded-full px-2.5 py-1 text-[10px] font-black uppercase ring-1", statusStyle[session.status])}>{session.status}</span>{session.blindCount && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700 ring-1 ring-violet-200"><EyeOff size={11} /> Blind</span>}</div><p className="mt-1 text-xs text-slate-500">{session.location.name} · started {new Date(session.createdAt).toLocaleString("en-IN")}</p></div>
                <div className="flex flex-wrap gap-2">
                  {(session.status === "counting" || session.status === "review") && <Button variant="outline" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => { setApprovalError(null); setApproval("cancel"); }}><ArchiveX size={15} /> Cancel</Button>}
                  {session.status === "counting" && <><Button variant="outline" disabled={!dirty.size || saveMutation.isPending} onClick={() => saveMutation.mutate()}><Save size={15} /> {saveMutation.isPending ? "Saving…" : `Save${dirty.size ? ` (${dirty.size})` : ""}`}</Button><Button disabled={effectiveRemaining > 0 || submitMutation.isPending || saveMutation.isPending} onClick={() => submitMutation.mutate()}><ClipboardCheck size={15} /> {submitMutation.isPending ? "Submitting…" : "Submit for review"}</Button></>}
                  {session.status === "review" && <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setApprovalError(null); setApproval("apply"); }}><ShieldCheck size={15} /> Apply inventory</Button>}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="mb-1 flex justify-between text-[11px] font-bold text-slate-600"><span>{effectiveCounted} counted</span><span>{progress}%</span></div><Progress value={progress} className="h-2" /></div>{session.status === "counting" && effectiveRemaining > 0 && <p className="text-xs font-bold text-amber-700">{effectiveRemaining} remaining</p>}</div>
              {session.status === "review" && <div className={cn("mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border p-3 text-xs font-bold", session.summary.varianceLines ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}><span className="inline-flex items-center gap-1.5">{session.summary.varianceLines ? <TriangleAlert size={15} /> : <Check size={15} />}{session.summary.varianceLines} products with variance</span><span>Net variance: {displayQty(session.summary.netVarianceBaseQty)} base units</span></div>}
            </div>

            <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="bg-white pl-9" placeholder="Search product…" /></div><p className="text-xs font-semibold text-slate-500">Showing {visible.length} of {filtered.length}</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Product</th>{session.status !== "counting" || !session.blindCount ? <th className="px-3 py-3 text-right">Expected</th> : null}<th className="px-3 py-3 text-right">Counted</th>{session.status !== "counting" ? <th className="px-3 py-3 text-right">Variance</th> : null}<th className="px-5 py-3">Note</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((line) => {
                    const draft = drafts[line.productId] ?? { quantity: "", reason: "" };
                    const variance = Number(line.varianceBaseQty ?? 0);
                    return <tr key={line.id} className={cn("transition", dirty.has(line.productId) && "bg-blue-50/50")}>
                      <td className="px-5 py-3"><p className="text-sm font-bold text-slate-900">{line.productName}</p><p className="text-[11px] text-slate-500">Base unit: {line.baseUnit}</p></td>
                      {session.status !== "counting" || !session.blindCount ? <td className="px-3 py-3 text-right text-sm font-semibold text-slate-600">{displayQty(line.expectedBaseQty)}</td> : null}
                      <td className="px-3 py-3 text-right">{session.status === "counting" ? <Input aria-label={`Counted quantity for ${line.productName}`} className="ml-auto w-28 text-right font-bold" type="number" min="0" step="any" value={draft.quantity} onChange={(event) => changeLine(line, "quantity", event.target.value)} placeholder="0" /> : <span className="text-sm font-black text-slate-900">{displayQty(line.countedBaseQty)}</span>}</td>
                      {session.status !== "counting" && <td className={cn("px-3 py-3 text-right text-sm font-black", variance > 0 ? "text-emerald-700" : variance < 0 ? "text-rose-700" : "text-slate-500")}>{variance > 0 ? "+" : ""}{displayQty(line.varianceBaseQty)}</td>}
                      <td className="px-5 py-3">{session.status === "counting" ? <Input aria-label={`Count note for ${line.productName}`} className="min-w-44" value={draft.reason} onChange={(event) => changeLine(line, "reason", event.target.value.slice(0, 300))} placeholder="Optional shelf/damage note" /> : <span className="text-xs text-slate-600">{line.reason || "—"}</span>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && <div className="flex items-center justify-between border-t border-slate-100 p-4"><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><p className="text-xs font-bold text-slate-500">Page {currentPage} of {pageCount}</p><Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div>}
          </>}
        </main>
      </div>

      <Dialog open={startOpen} onOpenChange={setStartOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Start branch stock count</DialogTitle><DialogDescription>Current quantities are snapshotted now. Sales or other stock movement after this point will block posting and protect live inventory.</DialogDescription></DialogHeader><div className="space-y-4 py-3"><div className="space-y-2"><Label>Count name</Label><Input autoFocus value={name} onChange={(event) => setName(event.target.value.slice(0, 120))} placeholder={`Full count · ${new Date().toLocaleDateString("en-IN")}`} /></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4"><Checkbox checked={blindCount} onCheckedChange={(checked) => setBlindCount(checked === true)} /><span><span className="block text-sm font-black text-violet-950">Blind count (recommended)</span><span className="mt-0.5 block text-xs leading-5 text-violet-700">Counters cannot see expected stock until every product is submitted, reducing confirmation bias.</span></span></label><p className="text-xs leading-5 text-slate-500">All active products in the selected branch will be included. Switch branches from the header before starting if needed.</p></div><DialogFooter><Button variant="outline" onClick={() => setStartOpen(false)} disabled={startMutation.isPending}>Cancel</Button><Button onClick={() => startMutation.mutate()} disabled={name.trim().length < 3 || startMutation.isPending}>{startMutation.isPending ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />} {startMutation.isPending ? "Starting…" : "Start count"}</Button></DialogFooter></DialogContent></Dialog>

      <OwnerPinModal open={Boolean(approval)} title={approval === "apply" ? "Apply inventory variances" : "Cancel this stock count"} description={approval === "apply" ? "This posts every variance to the permanent branch stock ledger. Newer stock movement is checked again before commit." : "The snapshot and audit history are retained, but no product quantity will change."} confirmLabel={approval === "apply" ? "Apply inventory" : "Cancel count"} reasonRequired reasonLabel={approval === "apply" ? "Approval note for audit trail" : "Cancellation reason"} loading={decisionMutation.isPending} error={approvalError} onCancel={() => { if (!decisionMutation.isPending) { setApproval(null); setApprovalError(null); } }} onConfirm={(payload) => decisionMutation.mutate(payload)} />
    </div>
  );
}
