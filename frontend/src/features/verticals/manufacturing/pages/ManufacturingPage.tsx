import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory, FlaskConical, PackageCheck, Plus, Search, ShieldCheck, Truck } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { listProducts } from "@/features/core/products/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type BomItem = { id: string; materialProductId: string; quantityBaseQty: number; wastagePercent: number };
type Bom = { id: string; name: string; version: number; status: string; finishedProductId: string; outputQuantityBaseQty: number; items: BomItem[] };
type Run = { id: string; runNumber: string; status: string; qcStatus: string; plannedOutputBaseQty: number; actualOutputBaseQty?: number | null; finishedBatchNumber?: string | null; bom: { name: string } };
type Overview = { summary: { activeBoms: number; plannedRuns: number; inProgressRuns: number; quarantinedLots: number }; recentRuns: Run[] };
type Trace = { batchNumber: string; producedAs: unknown[]; consumedBy: unknown[] };

const panel = "rounded-2xl border border-slate-200 bg-white shadow-sm";

export default function ManufacturingPage() {
  const client = useQueryClient();
  const { toast } = useToast();
  const [finishedProductId, setFinishedProductId] = useState("");
  const [materialProductId, setMaterialProductId] = useState("");
  const [bomName, setBomName] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [materialQty, setMaterialQty] = useState("1");
  const [wastage, setWastage] = useState("0");
  const [traceBatch, setTraceBatch] = useState("");
  const [traceResult, setTraceResult] = useState<Trace | null>(null);

  const overviewQ = useQuery({ queryKey: ["manufacturing", "overview"], queryFn: () => apiRequest<Overview>("/manufacturing/overview") });
  const bomsQ = useQuery({ queryKey: ["manufacturing", "boms"], queryFn: () => apiRequest<Bom[]>("/manufacturing/boms") });
  const productsQ = useQuery({ queryKey: ["products", "manufacturing"], queryFn: () => listProducts({ limit: 1000 }) });
  const productNames = useMemo(() => new Map((productsQ.data ?? []).map((row) => [row.id, row.name])), [productsQ.data]);

  const createBom = useMutation({
    mutationFn: () => apiRequest<Bom>("/manufacturing/boms", { method: "POST", body: JSON.stringify({
      finishedProductId, name: bomName, outputQuantityBaseQty: Number(outputQty),
      items: [{ materialProductId, quantityBaseQty: Number(materialQty), wastagePercent: Number(wastage) }],
    }) }),
    onSuccess: async () => {
      toast({ title: "BOM version created", description: "The previous active version was preserved for production history." });
      setBomName(""); setMaterialProductId("");
      await Promise.all([client.invalidateQueries({ queryKey: ["manufacturing", "boms"] }), client.invalidateQueries({ queryKey: ["manufacturing", "overview"] })]);
    },
    onError: (error) => toast({ title: "Could not create BOM", description: error instanceof Error ? error.message : "Review the material quantities.", variant: "destructive" }),
  });

  const trace = useMutation({
    mutationFn: () => apiRequest<Trace>(`/manufacturing/trace?batchNumber=${encodeURIComponent(traceBatch)}`),
    onSuccess: setTraceResult,
    onError: (error) => toast({ title: "Trace failed", description: error instanceof Error ? error.message : "Batch could not be traced.", variant: "destructive" }),
  });

  const summary = overviewQ.data?.summary;
  return <div className="space-y-5 p-4 sm:p-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[.18em] text-teal-700">Manufacturing vertical</p><h1 className="mt-1 text-2xl font-black text-slate-950">Factory operations</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">Convert traceable raw-material batches into QC-controlled finished batches, then package and dispatch them to wholesale or export buyers.</p></div>
      <Button className="gap-2" onClick={() => document.getElementById("new-bom")?.scrollIntoView({ behavior: "smooth" })}><Plus size={16}/>New BOM</Button>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi icon={<FlaskConical size={18}/>} label="Active BOMs" value={summary?.activeBoms ?? 0}/>
      <Kpi icon={<Factory size={18}/>} label="Planned runs" value={summary?.plannedRuns ?? 0}/>
      <Kpi icon={<PackageCheck size={18}/>} label="In production" value={summary?.inProgressRuns ?? 0}/>
      <Kpi icon={<ShieldCheck size={18}/>} label="QC hold / recall" value={summary?.quarantinedLots ?? 0}/>
    </section>

    <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <div className={panel} id="new-bom"><div className="border-b border-slate-100 p-5"><h2 className="font-black text-slate-900">Create BOM version</h2><p className="mt-1 text-xs text-slate-500">This first line establishes the recipe. Add further materials through subsequent API/UI expansion without changing historical versions.</p></div><div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="BOM name"><Input value={bomName} onChange={(e) => setBomName(e.target.value)} placeholder="Turmeric 500 g production"/></Field>
        <Field label="Finished good"><ProductSelect value={finishedProductId} onChange={setFinishedProductId} products={productsQ.data ?? []}/></Field>
        <Field label="Standard output (base units)"><Input type="number" min="0.001" value={outputQty} onChange={(e) => setOutputQty(e.target.value)}/></Field>
        <Field label="Raw / packaging material"><ProductSelect value={materialProductId} onChange={setMaterialProductId} products={(productsQ.data ?? []).filter((row) => row.id !== finishedProductId)}/></Field>
        <Field label="Material quantity (base units)"><Input type="number" min="0.001" value={materialQty} onChange={(e) => setMaterialQty(e.target.value)}/></Field>
        <Field label="Expected wastage %"><Input type="number" min="0" max="100" value={wastage} onChange={(e) => setWastage(e.target.value)}/></Field>
        <Button className="sm:col-span-2" disabled={!bomName.trim() || !finishedProductId || !materialProductId || createBom.isPending} onClick={() => createBom.mutate()}>{createBom.isPending ? "Saving…" : "Create controlled BOM version"}</Button>
      </div></div>

      <div className={panel}><div className="border-b border-slate-100 p-5"><h2 className="font-black text-slate-900">Batch genealogy</h2><p className="mt-1 text-xs text-slate-500">Search either a supplier batch or a finished batch.</p></div><div className="p-5"><div className="flex gap-2"><Input value={traceBatch} onChange={(e) => setTraceBatch(e.target.value)} placeholder="Batch number"/><Button className="gap-2" disabled={!traceBatch.trim() || trace.isPending} onClick={() => trace.mutate()}><Search size={15}/>Trace</Button></div>{traceResult && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><p className="font-black">{traceResult.batchNumber}</p><p className="mt-2 text-slate-600">Produced output links: <strong>{traceResult.producedAs.length}</strong></p><p className="text-slate-600">Downstream production uses: <strong>{traceResult.consumedBy.length}</strong></p></div>}<div className="mt-5 grid gap-3"><Flow icon={<Factory/>} title="Produce" text="Consume approved material lots and record actual yield and process loss."/><Flow icon={<PackageCheck/>} title="Package" text="Split finished output across pouch, box and carton SKUs."/><Flow icon={<Truck/>} title="Dispatch" text="Use released batches for domestic wholesale or export invoices."/></div></div></div>
    </section>

    <section className={panel}><div className="border-b border-slate-100 p-5"><h2 className="font-black">BOM register</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-3">BOM</th><th className="p-3">Finished good</th><th className="p-3">Version</th><th className="p-3">Materials</th><th className="p-3">Status</th></tr></thead><tbody>{(bomsQ.data ?? []).map((bom) => <tr key={bom.id} className="border-t border-slate-100"><td className="p-3 font-bold">{bom.name}</td><td className="p-3">{productNames.get(bom.finishedProductId) ?? bom.finishedProductId}</td><td className="p-3">v{bom.version}</td><td className="p-3">{bom.items.length}</td><td className="p-3"><span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-bold text-teal-800">{bom.status}</span></td></tr>)}{!bomsQ.isLoading && !(bomsQ.data?.length) && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No BOMs yet.</td></tr>}</tbody></table></div></section>

    <section className={panel}><div className="border-b border-slate-100 p-5"><h2 className="font-black">Recent production runs</h2></div><div className="divide-y divide-slate-100">{(overviewQ.data?.recentRuns ?? []).map((run) => <div key={run.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_1fr_120px_140px]"><strong>{run.runNumber}</strong><span>{run.bom.name}</span><span>{run.finishedBatchNumber ?? "Not produced"}</span><span className="font-bold text-slate-600">{run.status} · {run.qcStatus}</span></div>)}{!overviewQ.isLoading && !(overviewQ.data?.recentRuns.length) && <div className="p-8 text-center text-slate-500">Production runs will appear here.</div>}</div></section>
  </div>;
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) { return <div className={`${panel} flex items-center gap-3 p-4`}><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700">{icon}</span><div><p className="text-xs font-bold text-slate-500">{label}</p><p className="text-xl font-black">{value}</p></div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1.5 text-xs font-bold text-slate-600"><span>{label}</span>{children}</label>; }
function ProductSelect({ value, onChange, products }: { value: string; onChange: (value: string) => void; products: Array<{ id: string; name: string; baseUnit?: string | null }> }) { return <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select product</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.baseUnit ?? "unit"})</option>)}</select>; }
function Flow({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="flex gap-3 rounded-xl border border-slate-200 p-3"><span className="text-teal-700">{icon}</span><div><p className="font-black">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p></div></div>; }
