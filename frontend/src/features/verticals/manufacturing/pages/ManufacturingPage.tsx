import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Factory,
  FlaskConical,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { listProducts } from "@/features/core/products/api";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageShell } from "@/components/shared/PageShell";
import { useToast } from "@/hooks/use-toast";

type BomItem = {
  id: string;
  materialProductId: string;
  quantityBaseQty: number;
  wastagePercent: number;
};

type Bom = {
  id: string;
  name: string;
  version: number;
  status: string;
  finishedProductId: string;
  outputQuantityBaseQty: number;
  items: BomItem[];
};

type Run = {
  id: string;
  runNumber: string;
  status: string;
  qcStatus: string;
  plannedOutputBaseQty: number;
  actualOutputBaseQty?: number | null;
  finishedBatchNumber?: string | null;
  bom: { name: string };
};

type Overview = {
  summary: {
    activeBoms: number;
    plannedRuns: number;
    inProgressRuns: number;
    quarantinedLots: number;
  };
  recentRuns: Run[];
};

type Trace = {
  batchNumber: string;
  producedAs: unknown[];
  consumedBy: unknown[];
};

const panel = "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.055)]";

export default function ManufacturingPage() {
  const client = useQueryClient();
  const { toast } = useToast();
  const { t } = useAppLanguage();
  const [finishedProductId, setFinishedProductId] = useState("");
  const [materialProductId, setMaterialProductId] = useState("");
  const [bomName, setBomName] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [materialQty, setMaterialQty] = useState("1");
  const [wastage, setWastage] = useState("0");
  const [traceBatch, setTraceBatch] = useState("");
  const [traceResult, setTraceResult] = useState<Trace | null>(null);

  const overviewQ = useQuery({
    queryKey: ["manufacturing", "overview"],
    queryFn: () => apiRequest<Overview>("/manufacturing/overview"),
  });
  const bomsQ = useQuery({
    queryKey: ["manufacturing", "boms"],
    queryFn: () => apiRequest<Bom[]>("/manufacturing/boms"),
  });
  const productsQ = useQuery({
    queryKey: ["products", "manufacturing"],
    queryFn: () => listProducts({ limit: 1000 }),
  });
  const productNames = useMemo(
    () => new Map((productsQ.data ?? []).map((row) => [row.id, row.name])),
    [productsQ.data],
  );

  const createBom = useMutation({
    mutationFn: () => apiRequest<Bom>("/manufacturing/boms", {
      method: "POST",
      body: JSON.stringify({
        finishedProductId,
        name: bomName,
        outputQuantityBaseQty: Number(outputQty),
        items: [{
          materialProductId,
          quantityBaseQty: Number(materialQty),
          wastagePercent: Number(wastage),
        }],
      }),
    }),
    onSuccess: async () => {
      toast({
        title: t("manufacturing.bom.createdTitle"),
        description: t("manufacturing.bom.createdDetail"),
      });
      setBomName("");
      setMaterialProductId("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["manufacturing", "boms"] }),
        client.invalidateQueries({ queryKey: ["manufacturing", "overview"] }),
      ]);
    },
    onError: (error) => toast({
      title: t("manufacturing.bom.failedTitle"),
      description: error instanceof Error
        ? error.message
        : t("manufacturing.bom.failedDetail"),
      variant: "destructive",
    }),
  });

  const trace = useMutation({
    mutationFn: () => apiRequest<Trace>(
      `/manufacturing/trace?batchNumber=${encodeURIComponent(traceBatch)}`,
    ),
    onSuccess: setTraceResult,
    onError: (error) => toast({
      title: t("manufacturing.trace.failedTitle"),
      description: error instanceof Error
        ? error.message
        : t("manufacturing.trace.failedDetail"),
      variant: "destructive",
    }),
  });

  const refresh = () => {
    void Promise.all([overviewQ.refetch(), bomsQ.refetch(), productsQ.refetch()]);
  };
  const summary = overviewQ.data?.summary;
  const hasLoadError = overviewQ.isError || bomsQ.isError || productsQ.isError;

  return (
    <PageShell className="space-y-4 px-3 py-3 sm:px-4 sm:py-4 lg:space-y-5 lg:px-6 lg:py-5" data-testid="manufacturing-page">
      <PageHeader
        eyebrow={<span className="font-black uppercase tracking-[0.16em] text-teal-700">{t("manufacturing.eyebrow")}</span>}
        title={t("manufacturing.title")}
        description={t("manufacturing.description")}
        actions={(
          <Button
            className="min-h-11 gap-2 rounded-xl"
            onClick={() => document.getElementById("new-bom")?.scrollIntoView({ behavior: "smooth" })}
          >
            <Plus size={16} /> {t("manufacturing.newBom")}
          </Button>
        )}
      />

      {hasLoadError ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-black text-rose-900">{t("manufacturing.loadErrorTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-rose-700">{t("manufacturing.loadErrorDetail")}</p>
          </div>
          <Button variant="outline" className="min-h-11 shrink-0 gap-2 border-rose-200 bg-white" onClick={refresh}>
            <RefreshCw size={15} /> {t("manufacturing.retry")}
          </Button>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi icon={<FlaskConical size={18} />} label={t("manufacturing.kpi.activeBoms")} value={summary?.activeBoms} />
        <Kpi icon={<Factory size={18} />} label={t("manufacturing.kpi.plannedRuns")} value={summary?.plannedRuns} />
        <Kpi icon={<PackageCheck size={18} />} label={t("manufacturing.kpi.inProduction")} value={summary?.inProgressRuns} />
        <Kpi icon={<ShieldCheck size={18} />} label={t("manufacturing.kpi.qcHold")} value={summary?.quarantinedLots} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={panel} id="new-bom">
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <h2 className="font-display font-black text-slate-900">{t("manufacturing.bom.createTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t("manufacturing.bom.createDescription")}</p>
          </div>
          <div className="grid gap-3.5 p-4 sm:grid-cols-2 sm:p-5">
            <Field label={t("manufacturing.bom.name")}>
              <Input className="h-11" value={bomName} onChange={(event) => setBomName(event.target.value)} placeholder={t("manufacturing.bom.namePlaceholder")} />
            </Field>
            <Field label={t("manufacturing.bom.finishedGood")}>
              <ProductSelect
                value={finishedProductId}
                onChange={setFinishedProductId}
                products={productsQ.data ?? []}
                emptyLabel={t("manufacturing.product.select")}
                unitFallback={t("manufacturing.product.unitFallback")}
              />
            </Field>
            <Field label={t("manufacturing.bom.standardOutput")}>
              <Input className="h-11" type="number" min="0.001" value={outputQty} onChange={(event) => setOutputQty(event.target.value)} />
            </Field>
            <Field label={t("manufacturing.bom.material")}>
              <ProductSelect
                value={materialProductId}
                onChange={setMaterialProductId}
                products={(productsQ.data ?? []).filter((row) => row.id !== finishedProductId)}
                emptyLabel={t("manufacturing.product.select")}
                unitFallback={t("manufacturing.product.unitFallback")}
              />
            </Field>
            <Field label={t("manufacturing.bom.materialQty")}>
              <Input className="h-11" type="number" min="0.001" value={materialQty} onChange={(event) => setMaterialQty(event.target.value)} />
            </Field>
            <Field label={t("manufacturing.bom.wastage")}>
              <Input className="h-11" type="number" min="0" max="100" value={wastage} onChange={(event) => setWastage(event.target.value)} />
            </Field>
            <Button
              className="min-h-12 rounded-xl font-black sm:col-span-2"
              disabled={!bomName.trim() || !finishedProductId || !materialProductId || createBom.isPending}
              onClick={() => createBom.mutate()}
            >
              {createBom.isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
              {createBom.isPending
                ? t("manufacturing.bom.saving")
                : t("manufacturing.bom.createAction")}
            </Button>
          </div>
        </div>

        <div className={panel}>
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <h2 className="font-display font-black text-slate-900">{t("manufacturing.trace.title")}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t("manufacturing.trace.description")}</p>
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex gap-2">
              <Input className="h-11" value={traceBatch} onChange={(event) => setTraceBatch(event.target.value)} placeholder={t("manufacturing.trace.batchPlaceholder")} />
              <Button className="min-h-11 shrink-0 gap-2" disabled={!traceBatch.trim() || trace.isPending} onClick={() => trace.mutate()}>
                {trace.isPending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                {t("manufacturing.trace.action")}
              </Button>
            </div>
            {traceResult ? (
              <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/60 p-4 text-sm">
                <p className="font-black text-teal-950">{traceResult.batchNumber}</p>
                <p className="mt-2 text-teal-800">{t("manufacturing.trace.producedLinks", { count: traceResult.producedAs.length })}</p>
                <p className="text-teal-800">{t("manufacturing.trace.downstreamUses", { count: traceResult.consumedBy.length })}</p>
              </div>
            ) : null}
            <div className="mt-5 grid gap-2.5">
              <Flow icon={<Factory />} title={t("manufacturing.flow.produceTitle")} text={t("manufacturing.flow.produceText")} />
              <Flow icon={<PackageCheck />} title={t("manufacturing.flow.packageTitle")} text={t("manufacturing.flow.packageText")} />
              <Flow icon={<Truck />} title={t("manufacturing.flow.dispatchTitle")} text={t("manufacturing.flow.dispatchText")} />
            </div>
          </div>
        </div>
      </section>

      <section className={panel}>
        <div className="border-b border-slate-100 p-4 sm:p-5">
          <h2 className="font-display font-black text-slate-900">{t("manufacturing.register.title")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[680px] w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="p-3">{t("manufacturing.register.bom")}</th>
                <th className="p-3">{t("manufacturing.register.finishedGood")}</th>
                <th className="p-3">{t("manufacturing.register.version")}</th>
                <th className="p-3">{t("manufacturing.register.materials")}</th>
                <th className="p-3">{t("manufacturing.register.status")}</th>
              </tr>
            </thead>
            <tbody>
              {(bomsQ.data ?? []).map((bom) => (
                <tr key={bom.id} className="border-t border-slate-100">
                  <td className="p-3 font-bold text-slate-900">{bom.name}</td>
                  <td className="p-3">{productNames.get(bom.finishedProductId) ?? bom.finishedProductId}</td>
                  <td className="p-3">{t("manufacturing.register.versionValue", { version: bom.version })}</td>
                  <td className="p-3">{bom.items.length}</td>
                  <td className="p-3"><span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-bold text-teal-800">{bom.status}</span></td>
                </tr>
              ))}
              {!bomsQ.isLoading && !bomsQ.data?.length ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">{t("manufacturing.register.empty")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={panel}>
        <div className="border-b border-slate-100 p-4 sm:p-5">
          <h2 className="font-display font-black text-slate-900">{t("manufacturing.runs.title")}</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {(overviewQ.data?.recentRuns ?? []).map((run) => (
            <div key={run.id} className="grid gap-1.5 p-4 text-sm sm:grid-cols-[1fr_1fr_120px_140px] sm:gap-2">
              <strong className="text-slate-900">{run.runNumber}</strong>
              <span>{run.bom.name}</span>
              <span>{run.finishedBatchNumber ?? t("manufacturing.runs.notProduced")}</span>
              <span className="font-bold text-slate-600">{run.status} · {run.qcStatus}</span>
            </div>
          ))}
          {!overviewQ.isLoading && !overviewQ.data?.recentRuns.length ? (
            <div className="p-8 text-center text-slate-500">{t("manufacturing.runs.empty")}</div>
          ) : null}
        </div>
      </section>
    </PageShell>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value?: number }) {
  return (
    <div className={`${panel} flex min-h-[92px] items-center gap-3 p-3.5 sm:p-4`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-bold text-slate-500 sm:text-xs">{label}</p>
        <p className="font-display text-xl font-black text-slate-950">{value ?? "—"}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 text-xs font-bold text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ProductSelect({
  value,
  onChange,
  products,
  emptyLabel,
  unitFallback,
}: {
  value: string;
  onChange: (value: string) => void;
  products: Array<{ id: string; name: string; baseUnit?: string | null }>;
  emptyLabel: string;
  unitFallback: string;
}) {
  return (
    <select
      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {products.map((row) => (
        <option key={row.id} value={row.id}>{row.name} ({row.baseUnit ?? unitFallback})</option>
      ))}
    </select>
  );
}

function Flow({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 p-3.5">
      <span className="shrink-0 text-teal-700">{icon}</span>
      <div>
        <p className="font-black text-slate-900">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
      </div>
    </div>
  );
}
