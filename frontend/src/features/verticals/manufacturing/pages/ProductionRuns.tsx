import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Loader2, Plus, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/features/core/auth/useAuth";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useOfflineStatus } from "@/features/core/sync";
import { apiRequest } from "@/lib/api/http";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@/types/api";
import { baseQuantity, completionPayload, materialShortages, newQuantityRow, plannedMaterial, totalQuantity, type CompletionDraft, type ProductionBom, type ProductionRun, type QuantityDraft, type RunDetails } from "../production-run";
import { useProductionDraft } from "../use-production-draft";

const selectClass = "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm font-normal";
const statusKeys = { planned: "manufacturing.production.planned", in_progress: "manufacturing.production.inProgress", quarantined: "manufacturing.production.held", completed: "manufacturing.production.completed", failed: "manufacturing.production.failed", cancelled: "manufacturing.production.cancelled" } as const;
const validationKeys = { quantity: "manufacturing.production.errorQuantity", batch: "manufacturing.production.errorBatch", dates: "manufacturing.production.errorDates", sourceBatch: "manufacturing.production.errorSource", stock: "manufacturing.production.errorStock", duplicateSource: "manufacturing.production.errorDuplicateSource", duplicateOutput: "manufacturing.production.errorDuplicateOutput", sourcePack: "manufacturing.production.errorSourcePack", reason: "manufacturing.production.errorReason" } as const;
type T = ReturnType<typeof useAppLanguage>["t"];

export default function ProductionRuns({ runs, boms, products, loading }: { runs: ProductionRun[]; boms: ProductionBom[]; products: Product[]; loading: boolean }) {
  const { t } = useAppLanguage();
  // "Planned: 50000 base units" left the owner to remember that powder is
  // counted in grams. Name the finished good's own unit.
  const outputUnit = (bomId: string) => products.find((product) => product.id === boms.find((bom) => bom.id === bomId)?.finishedProductId)?.baseUnit || t("manufacturing.production.baseUnitFallback");
  const { user } = useAuth();
  const { isOnline } = useOfflineStatus();
  const client = useQueryClient();
  const { toast } = useToast();
  const [planning, setPlanning] = useState(false);
  const [selected, setSelected] = useState<ProductionRun | null>(null);
  const [releasing, setReleasing] = useState<ProductionRun | null>(null);
  const [abandoning, setAbandoning] = useState<ProductionRun | null>(null);
  const canManage = user?.role === "owner" || user?.role === "admin";
  const refreshed = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["manufacturing"] }), client.invalidateQueries({ queryKey: ["products"] }), client.invalidateQueries({ queryKey: ["inventory"] })]);
  };
  const release = useMutation({
    mutationFn: (run: ProductionRun) => apiRequest(`/manufacturing/runs/${run.id}/release`, { method: "POST", headers: { "x-location-id": run.locationId }, body: "{}" }),
    onSuccess: async () => { setReleasing(null); toast({ title: t("manufacturing.production.released") }); await refreshed(); },
  });
  // A mistaken plan used to sit in "Planned runs" for good; nothing could close it.
  const abandon = useMutation({
    mutationFn: (run: ProductionRun) => apiRequest(`/manufacturing/runs/${run.id}/cancel`, { method: "POST", headers: { "x-location-id": run.locationId }, body: "{}" }),
    onSuccess: async () => { setAbandoning(null); toast({ title: t("manufacturing.production.abandoned") }); await refreshed(); },
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
        <p className="mt-2 text-sm">{t("manufacturing.production.plannedAmount", { qty: run.plannedOutputBaseQty, unit: outputUnit(run.bomId) })}</p>
        {run.actualOutputBaseQty != null && <p className="mt-1 text-sm">{t("manufacturing.production.actualAmount", { qty: run.actualOutputBaseQty, unit: outputUnit(run.bomId) })}</p>}
        {run.finishedBatchNumber && <p className="mt-1 break-all text-xs text-slate-500">{t("manufacturing.production.batchValue", { batch: run.finishedBatchNumber })}</p>}
        {canManage && ["planned", "in_progress"].includes(run.status) && <><Button variant="outline" className="mt-4 min-h-11 w-full gap-2" disabled={!isOnline} onClick={() => setSelected(run)}><ClipboardList size={16} />{t("manufacturing.production.record")}</Button>
        <Button variant="ghost" className="mt-2 min-h-11 w-full gap-2 text-slate-600" disabled={!isOnline} onClick={() => { abandon.reset(); setAbandoning(run); }}><XCircle size={16} />{t("manufacturing.production.abandon")}</Button></>}
        {canManage && run.status === "quarantined" && <Button variant="outline" className="mt-4 min-h-11 w-full gap-2" disabled={!isOnline} onClick={() => { release.reset(); setReleasing(run); }}><ShieldCheck size={16} />{t("manufacturing.production.reviewRelease")}</Button>}
      </article>)}
      {!runs.length && <p className="py-6 text-sm text-slate-500">{t(loading ? "manufacturing.production.loading" : "manufacturing.runs.empty")}</p>}
    </div>
    <PlanRun open={planning} close={() => setPlanning(false)} boms={boms} products={products} outputUnit={outputUnit} saved={refreshed} />
    <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-h-[92vh] sm:max-w-2xl"><DialogHeader className="pr-10"><DialogTitle>{t("manufacturing.production.record")}</DialogTitle><DialogDescription>{selected?.runNumber} · {t("manufacturing.production.reviewActual")}</DialogDescription></DialogHeader>{selected && <LoadCompletion key={selected.id} run={selected} close={() => setSelected(null)} saved={refreshed} />}</DialogContent></Dialog>
    <Dialog open={!!releasing} onOpenChange={(open) => !open && !release.isPending && setReleasing(null)}><DialogContent><DialogHeader className="pr-8"><DialogTitle>{t("manufacturing.production.releaseTitle")}</DialogTitle><DialogDescription>{t("manufacturing.production.releaseHelp", { batch: releasing?.finishedBatchNumber || "" })}</DialogDescription></DialogHeader>
      <ErrorText error={release.error} />
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="min-h-11" disabled={release.isPending} onClick={() => setReleasing(null)}>{t("manufacturing.production.cancel")}</Button><Button className="min-h-11 gap-2" disabled={!isOnline || release.isPending} onClick={() => releasing && release.mutate(releasing)}><ShieldCheck size={16} />{t("manufacturing.production.release")}</Button></div>
    </DialogContent></Dialog>
    <Dialog open={!!abandoning} onOpenChange={(open) => !open && !abandon.isPending && setAbandoning(null)}><DialogContent><DialogHeader className="pr-8"><DialogTitle>{t("manufacturing.production.abandonTitle")}</DialogTitle><DialogDescription>{t("manufacturing.production.abandonHelp", { run: abandoning?.runNumber || "" })}</DialogDescription></DialogHeader>
      <ErrorText error={abandon.error} />
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="min-h-11" disabled={abandon.isPending} onClick={() => setAbandoning(null)}>{t("manufacturing.production.keepRun")}</Button><Button variant="destructive" className="min-h-11 gap-2" disabled={!isOnline || abandon.isPending} onClick={() => abandoning && abandon.mutate(abandoning)}>{abandon.isPending ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}{t("manufacturing.production.abandonConfirm")}</Button></div>
    </DialogContent></Dialog>
  </section>;
}

function PlanRun({ open, close, boms, products, outputUnit, saved }: { open: boolean; close: () => void; boms: ProductionBom[]; products: Product[]; outputUnit: (bomId: string) => string; saved: () => Promise<void> }) {
  const { t } = useAppLanguage();
  const { isOnline } = useOfflineStatus();
  const [bomId, setBomId] = useState("");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const mutation = useMutation({
    mutationFn: () => apiRequest("/manufacturing/runs", { method: "POST", body: JSON.stringify({ bomId, runNumber: number.trim(), plannedOutputBaseQty: Number(amount) }) }),
    onSuccess: async () => { close(); setNumber(""); setAmount(""); setBomId(""); await saved(); },
  });
  // Say up front what this batch size will run out of. Planning is still
  // allowed: a shop routinely plans the run and then buys for it.
  const shortages = materialShortages(boms.find((bom) => bom.id === bomId), Number(amount), products);
  return <Dialog open={open} onOpenChange={(value) => !value && !mutation.isPending && close()}><DialogContent><DialogHeader className="pr-8"><DialogTitle>{t("manufacturing.production.plan")}</DialogTitle><DialogDescription>{t("manufacturing.production.planHelp")}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <Field label={t("manufacturing.production.runNumber")}><Input value={number} onChange={(event) => setNumber(event.target.value)} required maxLength={64} className="h-11" /></Field>
      <Field label={t("manufacturing.production.recipe")}><select required className={selectClass} value={bomId} onChange={(event) => { setBomId(event.target.value); setAmount(String(boms.find((bom) => bom.id === event.target.value)?.outputQuantityBaseQty || "")); }}><option value="">{t("manufacturing.production.chooseRecipe")}</option>{boms.filter((bom) => bom.status === "active").map((bom) => <option key={bom.id} value={bom.id}>{bom.name}</option>)}</select></Field>
      <Field label={t("manufacturing.production.plannedOutput", { unit: outputUnit(bomId) })}><Input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" step="0.01" min="0.01" max="1000000000" required className="h-11" /></Field>
      {shortages.length > 0 && <div role="status" className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <p className="font-bold">{t("manufacturing.production.shortageTitle")}</p>
        <ul className="space-y-0.5">{shortages.map((row) => <li key={row.productId}>{t("manufacturing.production.shortageRow", { name: row.name, short: row.short, unit: row.unit, available: row.available, needed: row.needed })}</li>)}</ul>
        <p>{t("manufacturing.production.shortageHelp")}</p>
      </div>}
      <ErrorText error={mutation.error} />
      <Button type="submit" className="min-h-12 w-full gap-2" disabled={!isOnline || mutation.isPending || !number.trim() || !bomId || !(Number(amount) > 0)}>{mutation.isPending && <Loader2 size={16} className="animate-spin" />}{t("manufacturing.production.savePlan")}</Button>
    </form>
  </DialogContent></Dialog>;
}

function LoadCompletion({ run, close, saved }: { run: ProductionRun; close: () => void; saved: () => Promise<void> }) {
  const { t } = useAppLanguage();
  const { user, shop } = useAuth();
  const detail = useQuery({ queryKey: ["manufacturing", "run", run.id], queryFn: () => apiRequest<RunDetails>(`/manufacturing/runs/${run.id}`, { headers: { "x-location-id": run.locationId } }), staleTime: 0 });
  if (detail.isPending) return <p role="status" className="p-6">{t("manufacturing.production.loading")}</p>;
  if (detail.isError) return <div><ErrorText error={detail.error} /><Button variant="outline" onClick={() => void detail.refetch()}>{t("manufacturing.retry")}</Button></div>;
  if (!["planned", "in_progress"].includes(detail.data.run.status)) return <div className="space-y-3"><p role="status">{t("manufacturing.production.alreadyClosed")}</p><Button onClick={() => { close(); void saved(); }}>{t("manufacturing.production.closeRefresh")}</Button></div>;
  return <CompletionForm key={JSON.stringify([shop?.id, user?.id, run.id, run.bomId])} details={detail.data} close={close} saved={saved} />;
}

function CompletionForm({ details, close, saved }: { details: RunDetails; close: () => void; saved: () => Promise<void> }) {
  const { t } = useAppLanguage();
  const { isOnline } = useOfflineStatus();
  const { user, shop } = useAuth();
  const shopId = shop?.id || user?.shopId;
  const entry = useProductionDraft(details, shopId && user?.id ? { shopId, userId: user.id, locationId: details.run.locationId, runId: details.run.id, bomId: details.run.bomId } : null);
  const { draft, setDraft } = entry;
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof completionPayload>) => apiRequest(`/manufacturing/runs/${details.run.id}/complete`, { method: "POST", headers: { "x-location-id": details.run.locationId }, body: JSON.stringify(payload) }),
    onSuccess: async () => { entry.clear(); close(); await saved(); },
  });
  const product = (id: string) => details.products.find((entry) => entry.id === id);
  const finished = product(details.run.bom.finishedProductId);
  const outputUnits = (finished?.sellingUnits ?? []).filter((unit) => unit.id && unit.isActive && unit.conversionToBase > 0).map((unit) => unit.id!);
  if (finished?.packagingMode !== "per_pack") outputUnits.unshift("");
  const availableOutput = outputUnits.find((id) => !draft.outputs.some((row) => row.sellingUnitId === id));
  // A failed batch is a write-off: it is counted, but never packed, dated for a
  // shelf, or turned into stock. Only the reason for the loss is compulsory.
  const scrapped = draft.qcStatus === "failed";
  const sourceRowCount = Object.values(draft.materials).reduce((sum, rows) => sum + rows.length, 0);
  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault(); setValidation(null);
    try { mutation.mutate(completionPayload(details, draft)); }
    catch (error) { setValidation(t(validationKeys[(error as Error).message as keyof typeof validationKeys] ?? "manufacturing.production.errorQuantity")); }
  }}>
    <p role="status" className={`rounded-lg p-3 text-xs leading-5 ${entry.saved ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-900"}`}>{t(entry.saved ? "manufacturing.production.draftSaved" : "manufacturing.production.draftUnavailable")}{entry.restored && <> {t("manufacturing.production.draftRestored")}</>}</p>
    {entry.restoreProblem && <p role="alert" className="text-xs text-amber-900">{t("manufacturing.production.draftReadFailed")}</p>}
    <fieldset disabled={mutation.isPending} className="space-y-5">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <h3 className="font-bold">{t(scrapped ? "manufacturing.production.scrapTitle" : "manufacturing.production.output")}</h3><p className="text-sm text-slate-600">{finished?.name}</p>
        <p className="text-xs leading-5 text-slate-500">{t(scrapped ? "manufacturing.production.scrapHelp" : "manufacturing.production.outputHelp")}</p>
        {draft.outputs.map((value, index) => <fieldset key={value.key} className="min-w-0 space-y-3 rounded-lg border bg-white p-3"><legend className="px-1 text-xs font-bold">{t("manufacturing.production.outputNumber", { number: index + 1 })}</legend>
          <QuantityFields product={finished} value={value} excludedUnits={draft.outputs.filter((row) => row.key !== value.key).map((row) => row.sellingUnitId)} change={(next) => setDraft((previous) => ({ ...previous, outputs: previous.outputs.map((row) => row.key === value.key ? { ...next, key: value.key } : row) }))} t={t} />
          {draft.outputs.length > 1 && <Button type="button" variant="ghost" className="min-h-11 gap-2 text-rose-700" aria-label={t("manufacturing.production.removeOutputNumber", { number: index + 1 })} onClick={() => setDraft((previous) => ({ ...previous, outputs: previous.outputs.filter((row) => row.key !== value.key) }))}><Trash2 size={15} />{t("manufacturing.production.removeRow")}</Button>}
        </fieldset>)}
        {!scrapped && <Button type="button" variant="outline" className="min-h-11 w-full gap-2" disabled={availableOutput === undefined || draft.outputs.length >= 50} onClick={() => setDraft((previous) => ({ ...previous, outputs: [...previous.outputs, { ...newQuantityRow(finished), sellingUnitId: availableOutput ?? "" }] }))}><Plus size={15} />{t("manufacturing.production.addOutput")}</Button>}
        <p className="text-sm font-bold">{t("manufacturing.production.outputTotal", { qty: totalQuantity(finished, draft.outputs), unit: finished?.baseUnit || "" })}</p>
        <Field label={t("manufacturing.production.finishedBatch")}><Input value={draft.batch} onChange={(event) => setDraft({ ...draft, batch: event.target.value })} required maxLength={80} className="h-11" /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label={t("manufacturing.production.manufacturedOn")}><Input type="date" required value={draft.manufacturedOn} onChange={(event) => setDraft({ ...draft, manufacturedOn: event.target.value })} className="h-11" /></Field>{!scrapped && <Field label={t("manufacturing.production.expiresOn")}><Input type="date" required value={draft.expiresOn} min={draft.manufacturedOn} onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })} className="h-11" /></Field>}</div>
      </section>
      <section className="space-y-3"><h3 className="font-bold">{t("manufacturing.production.materials")}</h3><p className="text-xs leading-5 text-slate-500">{t("manufacturing.production.materialHelp")}</p>
        {details.run.bom.items.map((item) => {
          const material = product(item.materialProductId);
          const values = draft.materials[item.materialProductId];
          const changeRows = (update: (rows: typeof values) => typeof values) => setDraft((previous) => ({ ...previous, materials: { ...previous.materials, [item.materialProductId]: update(previous.materials[item.materialProductId]) } }));
          const lots = details.lots.filter((lot) => lot.productId === item.materialProductId);
          const units = (material?.sellingUnits ?? []).filter((unit) => unit.id && unit.isActive && unit.conversionToBase > 0).map((unit) => unit.id!);
          if (material?.packagingMode !== "per_pack") units.unshift("");
          const sourceOptions = units.reduce((sum, id) => sum + lots.filter((lot) => !lot.sellingUnitId || lot.sellingUnitId === id).length + (material?.batchTrackingEnabled ? 0 : 1), 0);
          return <fieldset key={item.materialProductId} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4"><legend className="px-1 text-sm font-bold">{material?.name || item.materialProductId}</legend>
            <p className="text-xs text-slate-500">{t("manufacturing.production.expected", { qty: plannedMaterial(details.run, item), unit: material?.baseUnit || "" })}</p>
            {values.map((value, index) => {
              const change = (next: QuantityDraft) => changeRows((rows) => rows.map((row) => row.key === value.key ? { ...next, key: value.key } : row));
              return <fieldset key={value.key} className="min-w-0 space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3"><legend className="px-1 text-xs font-bold">{t("manufacturing.production.sourceNumber", { number: index + 1 })}</legend>
                <QuantityFields product={material} value={value} change={(next) => {
                  const selectedLot = lots.find((lot) => lot.id === next.inventoryLotId);
                  change(selectedLot?.sellingUnitId && selectedLot.sellingUnitId !== next.sellingUnitId ? { ...next, inventoryLotId: "" } : next);
                }} t={t} />
                {(material?.batchTrackingEnabled || lots.length > 0) && <Field label={t("manufacturing.production.sourceBatch")}><select className={selectClass} required={!!material?.batchTrackingEnabled} value={value.inventoryLotId || ""} onChange={(event) => change({ ...value, inventoryLotId: event.target.value })}><option value="">{t(material?.batchTrackingEnabled ? "manufacturing.production.chooseBatch" : "manufacturing.production.noBatch")}</option>{lots.filter((lot) => (!lot.sellingUnitId || lot.sellingUnitId === value.sellingUnitId) && !values.some((other) => other.key !== value.key && other.inventoryLotId === lot.id && other.sellingUnitId === value.sellingUnitId)).map((lot) => <option key={lot.id} value={lot.id}>{t("manufacturing.production.batchOption", { batch: lot.batchNumber, qty: lot.availableBaseQty, date: lot.expiresOn.slice(0, 10) })}</option>)}</select></Field>}
                {values.length > 1 && <Button type="button" variant="ghost" className="min-h-11 gap-2 text-rose-700" aria-label={t("manufacturing.production.removeSourceNumber", { material: material?.name || "", number: index + 1 })} onClick={() => changeRows((rows) => rows.filter((row) => row.key !== value.key))}><Trash2 size={15} />{t("manufacturing.production.removeRow")}</Button>}
              </fieldset>;
            })}
            <p className="text-xs font-bold">{t("manufacturing.production.materialTotal", { qty: totalQuantity(material, values), unit: material?.baseUnit || "" })}</p>
            {sourceOptions > 1 && <Button type="button" variant="outline" className="min-h-11 w-full gap-2" disabled={values.length >= Math.min(sourceOptions, 50) || sourceRowCount >= 1000} onClick={() => changeRows((rows) => [...rows, newQuantityRow(material)])}><Plus size={15} />{t("manufacturing.production.addSource")}</Button>}
            {material?.batchTrackingEnabled && !lots.length && <p className="text-xs text-amber-800">{t("manufacturing.production.noSourceStock")}</p>}
          </fieldset>;
        })}
      </section>
      <Field label={t("manufacturing.production.quality")}><select className={selectClass} value={draft.qcStatus} onChange={(event) => setDraft({ ...draft, qcStatus: event.target.value as CompletionDraft["qcStatus"] })}><option value="conditional">{t("manufacturing.production.holdOption")}</option><option value="passed">{t("manufacturing.production.passOption")}</option><option value="failed">{t("manufacturing.production.failOption")}</option></select></Field>
      <Field label={t(scrapped ? "manufacturing.production.reasonLabel" : "manufacturing.production.notes")}><textarea className="min-h-20 w-full rounded-lg border border-input p-3 text-sm font-normal" required={scrapped} maxLength={1000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
    </fieldset>
    <p className={`rounded-lg p-3 text-xs leading-5 ${scrapped ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>{t(scrapped ? "manufacturing.production.failHelp" : draft.qcStatus === "conditional" ? "manufacturing.production.holdHelp" : "manufacturing.production.postHelp")}</p>
    {validation && <p role="alert" className="text-sm text-rose-700">{validation}</p>}<ErrorText error={mutation.error} />
    <div className="sticky bottom-0 grid grid-cols-[auto_1fr] gap-2 border-t bg-white py-3"><Button type="button" variant="outline" className="min-h-12" disabled={mutation.isPending} onClick={close}>{t("manufacturing.production.cancel")}</Button><Button type="submit" className="min-h-12 gap-2" disabled={!isOnline || mutation.isPending}>{mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : scrapped ? <XCircle size={16} /> : <CheckCircle2 size={16} />}{t(scrapped ? "manufacturing.production.saveScrap" : "manufacturing.production.saveOutput")}</Button></div>
  </form>;
}

function QuantityFields({ product, value, change, t, excludedUnits = [] }: { product: Product | undefined; value: QuantityDraft; change: (value: QuantityDraft) => void; t: T; excludedUnits?: string[] }) {
  const units = product?.sellingUnits?.filter((unit) => unit.id && unit.isActive && unit.conversionToBase > 0 && !excludedUnits.includes(unit.id)) ?? [];
  const base = baseQuantity(product, value);
  return <div className="grid gap-3 sm:grid-cols-2"><Field label={t("manufacturing.production.amount")}><Input value={value.amount} onChange={(event) => change({ ...value, amount: event.target.value })} required type="number" min="0.01" max="1000000000" step="0.01" className="h-11" /></Field>
    <Field label={t("manufacturing.production.unit")}><select className={selectClass} value={value.sellingUnitId} required={product?.packagingMode === "per_pack"} onChange={(event) => change({ ...value, sellingUnitId: event.target.value })}><option value="" disabled={product?.packagingMode === "per_pack" || excludedUnits.includes("")}>{product?.packagingMode === "per_pack" ? t("manufacturing.production.choosePack") : t("manufacturing.production.baseUnits", { unit: product?.baseUnit || "" })}</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
    <p className="text-xs text-slate-500 sm:col-span-2">{t("manufacturing.production.baseTotal", { qty: Number.isFinite(base) ? base : 0, unit: product?.baseUnit || "" })}</p>
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 space-y-1.5 text-xs font-bold text-slate-600"><span>{label}</span>{children}</label>; }
function ErrorText({ error }: { error: unknown }) { return error ? <p role="alert" className="text-sm text-rose-700">{error instanceof Error ? error.message : String(error)}</p> : null; }
