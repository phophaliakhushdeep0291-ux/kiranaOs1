import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/features/core/auth/useAuth";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useOfflineStatus } from "@/features/core/sync";
import { apiRequest } from "@/lib/api/http";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@/types/api";
import { baseQuantity, completionPayload, initialCompletion, plannedMaterial, type CompletionDraft, type ProductionBom, type ProductionRun, type QuantityDraft, type RunDetails } from "../production-run";

const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-normal";
const statusKeys = { planned: "manufacturing.production.planned", in_progress: "manufacturing.production.inProgress", quarantined: "manufacturing.production.held", completed: "manufacturing.production.completed" } as const;
const validationKeys = { quantity: "manufacturing.production.errorQuantity", batch: "manufacturing.production.errorBatch", dates: "manufacturing.production.errorDates", sourceBatch: "manufacturing.production.errorSource", stock: "manufacturing.production.errorStock" } as const;
type T = ReturnType<typeof useAppLanguage>["t"];

export default function ProductionRuns({ runs, boms, loading }: { runs: ProductionRun[]; boms: ProductionBom[]; loading: boolean }) {
  const { t } = useAppLanguage();
  const { user } = useAuth();
  const { isOnline } = useOfflineStatus();
  const client = useQueryClient();
  const { toast } = useToast();
  const [planning, setPlanning] = useState(false);
  const [selected, setSelected] = useState<ProductionRun | null>(null);
  const [releasing, setReleasing] = useState<ProductionRun | null>(null);
  const canManage = user?.role === "owner" || user?.role === "admin";
  const refreshed = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["manufacturing"] }), client.invalidateQueries({ queryKey: ["products"] }), client.invalidateQueries({ queryKey: ["inventory"] })]);
  };
  const release = useMutation({
    mutationFn: (run: ProductionRun) => apiRequest(`/manufacturing/runs/${run.id}/release`, { method: "POST", headers: { "x-location-id": run.locationId }, body: "{}" }),
    onSuccess: async () => { setReleasing(null); toast({ title: t("manufacturing.production.released") }); await refreshed(); },
  });
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
      <div><h2 className="font-display font-black text-slate-900">{t("manufacturing.production.title")}</h2><p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">{t("manufacturing.production.help")}</p></div>
      {canManage && <Button className="min-h-11 gap-2" disabled={!isOnline || !boms.some((bom) => bom.status === "active")} onClick={() => setPlanning(true)}><Plus size={16} />{t("manufacturing.production.plan")}</Button>}
    </div>
    {!isOnline && <p role="status" className="bg-amber-50 p-4 text-sm text-amber-900">{t("manufacturing.production.offline")}</p>}
    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {runs.map((run) => <article key={run.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-all font-bold text-slate-900">{run.runNumber}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${run.status === "quarantined" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{t(statusKeys[run.status as keyof typeof statusKeys] ?? "manufacturing.production.inProgress")}</span></div>
        <p className="mt-2 break-words text-sm text-slate-600">{run.bom.name}</p>
        <p className="mt-2 text-sm">{t("manufacturing.production.plannedAmount", { qty: run.plannedOutputBaseQty })}</p>
        {run.actualOutputBaseQty != null && <p className="mt-1 text-sm">{t("manufacturing.production.actualAmount", { qty: run.actualOutputBaseQty })}</p>}
        {run.finishedBatchNumber && <p className="mt-1 break-all text-xs text-slate-500">{t("manufacturing.production.batchValue", { batch: run.finishedBatchNumber })}</p>}
        {canManage && ["planned", "in_progress"].includes(run.status) && <Button variant="outline" className="mt-4 min-h-11 w-full gap-2" disabled={!isOnline} onClick={() => setSelected(run)}><ClipboardList size={16} />{t("manufacturing.production.record")}</Button>}
        {canManage && run.status === "quarantined" && <Button variant="outline" className="mt-4 min-h-11 w-full gap-2" disabled={!isOnline} onClick={() => { release.reset(); setReleasing(run); }}><ShieldCheck size={16} />{t("manufacturing.production.reviewRelease")}</Button>}
      </article>)}
      {!runs.length && <p className="py-6 text-sm text-slate-500">{t(loading ? "manufacturing.production.loading" : "manufacturing.runs.empty")}</p>}
    </div>
    <PlanRun open={planning} close={() => setPlanning(false)} boms={boms} saved={refreshed} />
    <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-h-[92vh] sm:max-w-2xl"><DialogHeader className="pr-10"><DialogTitle>{t("manufacturing.production.record")}</DialogTitle><DialogDescription>{selected?.runNumber} · {t("manufacturing.production.reviewActual")}</DialogDescription></DialogHeader>{selected && <LoadCompletion key={selected.id} run={selected} close={() => setSelected(null)} saved={refreshed} />}</DialogContent></Dialog>
    <Dialog open={!!releasing} onOpenChange={(open) => !open && !release.isPending && setReleasing(null)}><DialogContent><DialogHeader className="pr-8"><DialogTitle>{t("manufacturing.production.releaseTitle")}</DialogTitle><DialogDescription>{t("manufacturing.production.releaseHelp", { batch: releasing?.finishedBatchNumber || "" })}</DialogDescription></DialogHeader>
      <ErrorText error={release.error} />
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="min-h-11" disabled={release.isPending} onClick={() => setReleasing(null)}>{t("manufacturing.production.cancel")}</Button><Button className="min-h-11 gap-2" disabled={!isOnline || release.isPending} onClick={() => releasing && release.mutate(releasing)}><ShieldCheck size={16} />{t("manufacturing.production.release")}</Button></div>
    </DialogContent></Dialog>
  </section>;
}

function PlanRun({ open, close, boms, saved }: { open: boolean; close: () => void; boms: ProductionBom[]; saved: () => Promise<void> }) {
  const { t } = useAppLanguage();
  const { isOnline } = useOfflineStatus();
  const [bomId, setBomId] = useState("");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const mutation = useMutation({
    mutationFn: () => apiRequest("/manufacturing/runs", { method: "POST", body: JSON.stringify({ bomId, runNumber: number.trim(), plannedOutputBaseQty: Number(amount) }) }),
    onSuccess: async () => { close(); setNumber(""); setAmount(""); setBomId(""); await saved(); },
  });
  return <Dialog open={open} onOpenChange={(value) => !value && !mutation.isPending && close()}><DialogContent><DialogHeader className="pr-8"><DialogTitle>{t("manufacturing.production.plan")}</DialogTitle><DialogDescription>{t("manufacturing.production.planHelp")}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <Field label={t("manufacturing.production.runNumber")}><Input value={number} onChange={(event) => setNumber(event.target.value)} required maxLength={64} className="h-11" /></Field>
      <Field label={t("manufacturing.production.recipe")}><select required className={selectClass} value={bomId} onChange={(event) => { setBomId(event.target.value); setAmount(String(boms.find((bom) => bom.id === event.target.value)?.outputQuantityBaseQty || "")); }}><option value="">{t("manufacturing.production.chooseRecipe")}</option>{boms.filter((bom) => bom.status === "active").map((bom) => <option key={bom.id} value={bom.id}>{bom.name}</option>)}</select></Field>
      <Field label={t("manufacturing.production.plannedOutput")}><Input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" step="0.01" min="0.01" max="1000000000" required className="h-11" /></Field>
      <ErrorText error={mutation.error} />
      <Button type="submit" className="min-h-12 w-full gap-2" disabled={!isOnline || mutation.isPending || !number.trim() || !bomId || !(Number(amount) > 0)}>{mutation.isPending && <Loader2 size={16} className="animate-spin" />}{t("manufacturing.production.savePlan")}</Button>
    </form>
  </DialogContent></Dialog>;
}

function LoadCompletion({ run, close, saved }: { run: ProductionRun; close: () => void; saved: () => Promise<void> }) {
  const { t } = useAppLanguage();
  const detail = useQuery({ queryKey: ["manufacturing", "run", run.id], queryFn: () => apiRequest<RunDetails>(`/manufacturing/runs/${run.id}`, { headers: { "x-location-id": run.locationId } }), staleTime: 0 });
  if (detail.isPending) return <p role="status" className="p-6">{t("manufacturing.production.loading")}</p>;
  if (detail.isError) return <div><ErrorText error={detail.error} /><Button variant="outline" onClick={() => void detail.refetch()}>{t("manufacturing.retry")}</Button></div>;
  return <CompletionForm details={detail.data} close={close} saved={saved} />;
}

function CompletionForm({ details, close, saved }: { details: RunDetails; close: () => void; saved: () => Promise<void> }) {
  const { t } = useAppLanguage();
  const { isOnline } = useOfflineStatus();
  const [draft, setDraft] = useState<CompletionDraft>(() => initialCompletion(details));
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof completionPayload>) => apiRequest(`/manufacturing/runs/${details.run.id}/complete`, { method: "POST", headers: { "x-location-id": details.run.locationId }, body: JSON.stringify(payload) }),
    onSuccess: async () => { close(); await saved(); },
  });
  const product = (id: string) => details.products.find((entry) => entry.id === id);
  const finished = product(details.run.bom.finishedProductId);
  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault(); setValidation(null);
    try { mutation.mutate(completionPayload(details, draft)); }
    catch (error) { setValidation(t(validationKeys[(error as Error).message as keyof typeof validationKeys] ?? "manufacturing.production.errorQuantity")); }
  }}>
    <fieldset disabled={mutation.isPending} className="space-y-5">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <h3 className="font-bold">{t("manufacturing.production.output")}</h3><p className="text-sm text-slate-600">{finished?.name}</p>
        <QuantityFields product={finished} value={draft.actual} change={(actual) => setDraft((previous) => ({ ...previous, actual }))} t={t} />
        <Field label={t("manufacturing.production.finishedBatch")}><Input value={draft.batch} onChange={(event) => setDraft({ ...draft, batch: event.target.value })} required maxLength={80} className="h-11" /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label={t("manufacturing.production.manufacturedOn")}><Input type="date" required value={draft.manufacturedOn} onChange={(event) => setDraft({ ...draft, manufacturedOn: event.target.value })} className="h-11" /></Field><Field label={t("manufacturing.production.expiresOn")}><Input type="date" required value={draft.expiresOn} min={draft.manufacturedOn} onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })} className="h-11" /></Field></div>
      </section>
      <section className="space-y-3"><h3 className="font-bold">{t("manufacturing.production.materials")}</h3><p className="text-xs leading-5 text-slate-500">{t("manufacturing.production.materialHelp")}</p>
        {details.run.bom.items.map((item) => {
          const material = product(item.materialProductId);
          const value = draft.materials[item.materialProductId];
          const change = (next: QuantityDraft) => setDraft((previous) => ({ ...previous, materials: { ...previous.materials, [item.materialProductId]: next } }));
          const lots = details.lots.filter((lot) => lot.productId === item.materialProductId);
          return <fieldset key={item.materialProductId} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4"><legend className="px-1 text-sm font-bold">{material?.name || item.materialProductId}</legend>
            <p className="text-xs text-slate-500">{t("manufacturing.production.expected", { qty: plannedMaterial(details.run, item), unit: material?.baseUnit || "" })}</p>
            <QuantityFields product={material} value={value} change={change} t={t} />
            {(material?.batchTrackingEnabled || lots.length > 0) && <Field label={t("manufacturing.production.sourceBatch")}><select className={selectClass} required={!!material?.batchTrackingEnabled} value={value.inventoryLotId || ""} onChange={(event) => change({ ...value, inventoryLotId: event.target.value })}><option value="">{t(material?.batchTrackingEnabled ? "manufacturing.production.chooseBatch" : "manufacturing.production.noBatch")}</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{t("manufacturing.production.batchOption", { batch: lot.batchNumber, qty: lot.availableBaseQty, date: lot.expiresOn.slice(0, 10) })}</option>)}</select></Field>}
            {material?.batchTrackingEnabled && !lots.length && <p className="text-xs text-amber-800">{t("manufacturing.production.noSourceStock")}</p>}
          </fieldset>;
        })}
      </section>
      <Field label={t("manufacturing.production.quality")}><select className={selectClass} value={draft.qcStatus} onChange={(event) => setDraft({ ...draft, qcStatus: event.target.value as CompletionDraft["qcStatus"] })}><option value="conditional">{t("manufacturing.production.holdOption")}</option><option value="passed">{t("manufacturing.production.passOption")}</option></select></Field>
      <Field label={t("manufacturing.production.notes")}><textarea className="min-h-20 w-full rounded-lg border border-input p-3 text-sm font-normal" maxLength={1000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
    </fieldset>
    <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{t(draft.qcStatus === "conditional" ? "manufacturing.production.holdHelp" : "manufacturing.production.postHelp")}</p>
    {validation && <p role="alert" className="text-sm text-rose-700">{validation}</p>}<ErrorText error={mutation.error} />
    <div className="sticky bottom-0 grid grid-cols-[auto_1fr] gap-2 border-t bg-white py-3"><Button type="button" variant="outline" className="min-h-12" disabled={mutation.isPending} onClick={close}>{t("manufacturing.production.cancel")}</Button><Button type="submit" className="min-h-12 gap-2" disabled={!isOnline || mutation.isPending}>{mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}{t("manufacturing.production.saveOutput")}</Button></div>
  </form>;
}

function QuantityFields({ product, value, change, t }: { product: Product | undefined; value: QuantityDraft; change: (value: QuantityDraft) => void; t: T }) {
  const units = product?.sellingUnits?.filter((unit) => unit.id && unit.isActive && unit.conversionToBase > 0) ?? [];
  const base = baseQuantity(product, value);
  return <div className="grid gap-3 sm:grid-cols-2"><Field label={t("manufacturing.production.amount")}><Input value={value.amount} onChange={(event) => change({ ...value, amount: event.target.value })} required type="number" min="0.01" max="1000000000" step="0.01" className="h-11" /></Field>
    <Field label={t("manufacturing.production.unit")}><select className={selectClass} value={value.sellingUnitId} required={product?.packagingMode === "per_pack"} onChange={(event) => change({ ...value, sellingUnitId: event.target.value })}><option value="" disabled={product?.packagingMode === "per_pack"}>{product?.packagingMode === "per_pack" ? t("manufacturing.production.choosePack") : t("manufacturing.production.baseUnits", { unit: product?.baseUnit || "" })}</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
    <p className="text-xs text-slate-500 sm:col-span-2">{t("manufacturing.production.baseTotal", { qty: Number.isFinite(base) ? base : 0, unit: product?.baseUnit || "" })}</p>
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{label}</span>{children}</label>; }
function ErrorText({ error }: { error: unknown }) { return error ? <p role="alert" className="text-sm text-rose-700">{error instanceof Error ? error.message : String(error)}</p> : null; }
