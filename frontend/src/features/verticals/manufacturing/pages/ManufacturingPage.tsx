import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Factory,
  FlaskConical,
  Globe2,
  ClipboardList,
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
  dispatchedBills?: Array<{ id: string; billNo: string; customerName?: string | null }>;
};

type TradeOrder = {
  id: string; orderNumber: string; buyerPoNumber?: string | null; customerName: string;
  orderType: "domestic" | "export"; status: string; currencyCode: string;
  billId?: string | null;
  countryOfDestination?: string | null; items: Array<{ id: string; description: string; quantity: number; lineTotal: number }>;
};
type DraftOrderLine = { productId: string; description: string; quantity: number; unitPrice: number };
type FlipkartStatus = { enabled: boolean; configured: boolean; officialDocuments: boolean };

const panel = "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.055)]";
const tradeActionKey = {
  draft: "manufacturing.orders.action.draft",
  confirmed: "manufacturing.orders.action.confirmed",
  allocated: "manufacturing.orders.action.allocated",
} as const;

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
  const [orderNumber, setOrderNumber] = useState("");
  const [buyerPoNumber, setBuyerPoNumber] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [orderProductId, setOrderProductId] = useState("");
  const [orderQty, setOrderQty] = useState("1");
  const [orderPrice, setOrderPrice] = useState("0");
  const [orderLines, setOrderLines] = useState<DraftOrderLine[]>([]);
  const [orderType, setOrderType] = useState<"domestic" | "export">("domestic");
  const [currencyCode, setCurrencyCode] = useState("INR");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [destination, setDestination] = useState("");
  const [incoterm, setIncoterm] = useState("");
  const [dispatchOrderId, setDispatchOrderId] = useState("");
  const [dispatchNumber, setDispatchNumber] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [lrAwbNumber, setLrAwbNumber] = useState("");
  const [ewayBillNumber, setEwayBillNumber] = useState("");
  const [shippingBillNumber, setShippingBillNumber] = useState("");
  const [invoiceOrderId, setInvoiceOrderId] = useState("");
  const [invoiceBillId, setInvoiceBillId] = useState("");
  const [returnOrderId, setReturnOrderId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnOwnerPin, setReturnOwnerPin] = useState("");
  const [flipkartShipmentId, setFlipkartShipmentId] = useState("");

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
  const tradeOrdersQ = useQuery({
    queryKey: ["manufacturing", "trade-orders"],
    queryFn: () => apiRequest<TradeOrder[]>("/manufacturing/trade-orders?status=all&limit=100"),
  });
  const flipkartQ = useQuery({ queryKey: ["integrations", "flipkart", "status"], queryFn: () => apiRequest<FlipkartStatus>("/integrations/flipkart/status") });
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

  const createTradeOrder = useMutation({
    mutationFn: () => apiRequest<TradeOrder>("/manufacturing/trade-orders", {
      method: "POST",
      body: JSON.stringify({
        orderNumber, buyerPoNumber: buyerPoNumber || null, customerName: buyerName,
        orderType, currencyCode: orderType === "domestic" ? "INR" : currencyCode.toUpperCase(),
        exchangeRate: orderType === "domestic" ? 1 : Number(exchangeRate),
        countryOfDestination: orderType === "export" ? destination : null,
        incoterm: orderType === "export" ? incoterm : null,
        items: orderLines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, lineDiscount: 0 })),
      }),
    }),
    onSuccess: async () => {
      toast({ title: t("manufacturing.orders.createdTitle"), description: t("manufacturing.orders.createdDetail") });
      setOrderNumber(""); setBuyerPoNumber(""); setBuyerName(""); setOrderProductId(""); setOrderLines([]);
      await tradeOrdersQ.refetch();
    },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  const advanceTradeOrder = useMutation({
    mutationFn: async (order: TradeOrder) => {
      if (order.status === "draft") return apiRequest(`/manufacturing/trade-orders/${order.id}/confirm`, { method: "POST", body: "{}" });
      if (order.status === "confirmed") return apiRequest(`/manufacturing/trade-orders/${order.id}/auto-allocate`, { method: "POST", body: "{}" });
      if (order.status === "allocated") return apiRequest(`/manufacturing/trade-orders/${order.id}/pack`, { method: "POST", body: JSON.stringify({ items: order.items.map((item) => ({ orderItemId: item.id, packedQuantity: Number(item.quantity) })) }) });
      return null;
    },
    onSuccess: async () => { toast({ title: t("manufacturing.orders.updatedTitle"), description: t("manufacturing.orders.updatedDetail") }); await tradeOrdersQ.refetch(); },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  const dispatchTradeOrder = useMutation({
    mutationFn: () => apiRequest(`/manufacturing/trade-orders/${dispatchOrderId}/dispatch`, { method: "POST", body: JSON.stringify({ dispatchNumber, dispatchDate: new Date().toISOString().slice(0, 10), transporterName: transporterName || null, vehicleNumber: vehicleNumber || null, lrAwbNumber: lrAwbNumber || null, ewayBillNumber: ewayBillNumber || null, shippingBillNumber: shippingBillNumber || null }) }),
    onSuccess: async () => { setDispatchOrderId(""); setDispatchNumber(""); setTransporterName(""); setVehicleNumber(""); setLrAwbNumber(""); setEwayBillNumber(""); setShippingBillNumber(""); toast({ title: t("manufacturing.orders.updatedTitle"), description: t("manufacturing.orders.updatedDetail") }); await tradeOrdersQ.refetch(); },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  const linkTradeInvoice = useMutation({
    mutationFn: () => apiRequest(`/manufacturing/trade-orders/${invoiceOrderId}/invoice`, { method: "POST", body: JSON.stringify({ billId: invoiceBillId }) }),
    onSuccess: async () => { setInvoiceOrderId(""); setInvoiceBillId(""); toast({ title: t("manufacturing.orders.updatedTitle"), description: t("manufacturing.orders.invoiceLinked") }); await tradeOrdersQ.refetch(); },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  const returnTradeOrder = useMutation({
    mutationFn: () => apiRequest(`/manufacturing/trade-orders/${returnOrderId}/return`, { method: "POST", ownerPin: returnOwnerPin, body: JSON.stringify({ reason: returnReason, refundMode: "bank" }) }),
    onSuccess: async () => { setReturnOrderId(""); setReturnReason(""); setReturnOwnerPin(""); toast({ title: t("manufacturing.orders.returnedTitle"), description: t("manufacturing.orders.returnedDetail") }); await tradeOrdersQ.refetch(); },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  const addOrderLine = () => {
    const product = (productsQ.data ?? []).find((row) => row.id === orderProductId);
    if (!product || Number(orderQty) <= 0 || Number(orderPrice) < 0) return;
    setOrderLines((current) => [...current, { productId: product.id, description: product.name, quantity: Number(orderQty), unitPrice: Number(orderPrice) }]);
    setOrderProductId(""); setOrderQty("1"); setOrderPrice("0");
  };

  const openTradePdf = async (order: TradeOrder, kind: "tax-invoice" | "packing-list" | "shipping-label") => {
    try {
      const blob = await apiRequest<Blob>(`/manufacturing/trade-orders/${order.id}/documents/${kind}.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }); }
  };
  const openFlipkartPdf = async (kind: "invoice" | "label") => {
    try { const blob = await apiRequest<Blob>(`/integrations/flipkart/shipments/${encodeURIComponent(flipkartShipmentId)}/${kind}.pdf`, { responseType: "blob" }); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (error) { toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }); }
  };

  const refresh = () => {
    void Promise.all([overviewQ.refetch(), bomsQ.refetch(), productsQ.refetch(), tradeOrdersQ.refetch()]);
  };
  const summary = overviewQ.data?.summary;
  const hasLoadError = overviewQ.isError || bomsQ.isError || productsQ.isError || tradeOrdersQ.isError;

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

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className={panel}>
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 font-display font-black text-slate-900"><ClipboardList size={18} className="text-teal-700" />{t("manufacturing.orders.createTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t("manufacturing.orders.createDescription")}</p>
          </div>
          <div className="grid gap-3.5 p-4 sm:grid-cols-2 sm:p-5">
            <Field label={t("manufacturing.orders.orderNumber")}><Input className="h-11" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} /></Field>
            <Field label={t("manufacturing.orders.buyerPo")}><Input className="h-11" value={buyerPoNumber} onChange={(event) => setBuyerPoNumber(event.target.value)} /></Field>
            <Field label={t("manufacturing.orders.buyerName")}><Input className="h-11" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} /></Field>
            <Field label={t("manufacturing.orders.type")}><select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={orderType} onChange={(event) => { const next = event.target.value as "domestic" | "export"; setOrderType(next); if (next === "domestic") { setCurrencyCode("INR"); setExchangeRate("1"); } }}><option value="domestic">{t("manufacturing.orders.domestic")}</option><option value="export">{t("manufacturing.orders.export")}</option></select></Field>
            <Field label={t("manufacturing.orders.product")}><ProductSelect value={orderProductId} onChange={setOrderProductId} products={productsQ.data ?? []} emptyLabel={t("manufacturing.product.select")} unitFallback={t("manufacturing.product.unitFallback")} /></Field>
            <Field label={t("manufacturing.orders.quantity")}><Input className="h-11" type="number" min="0.001" value={orderQty} onChange={(event) => setOrderQty(event.target.value)} /></Field>
            <Field label={t("manufacturing.orders.unitPrice")}><Input className="h-11" type="number" min="0" value={orderPrice} onChange={(event) => setOrderPrice(event.target.value)} /></Field>
            <Button type="button" variant="outline" className="min-h-11 sm:col-span-2" disabled={!orderProductId || Number(orderQty) <= 0 || Number(orderPrice) < 0} onClick={addOrderLine}>{t("manufacturing.orders.addLine")}</Button>
            {orderLines.length ? <div className="space-y-2 rounded-xl bg-slate-50 p-3 sm:col-span-2">{orderLines.map((line, index) => <div key={`${line.productId}-${index}`} className="flex items-center justify-between gap-3 text-sm"><span><strong>{line.description}</strong> - {line.quantity} x {line.unitPrice.toFixed(2)}</span><Button size="sm" variant="ghost" onClick={() => setOrderLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>{t("manufacturing.orders.removeLine")}</Button></div>)}</div> : null}
            {orderType === "export" ? <><Field label={t("manufacturing.orders.currency")}><Input className="h-11 uppercase" maxLength={3} value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></Field><Field label={t("manufacturing.orders.exchangeRate")}><Input className="h-11" type="number" min="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} /></Field><Field label={t("manufacturing.orders.destination")}><Input className="h-11" value={destination} onChange={(event) => setDestination(event.target.value)} /></Field><Field label={t("manufacturing.orders.incoterm")}><Input className="h-11 uppercase" placeholder={t("manufacturing.orders.incotermPlaceholder")} value={incoterm} onChange={(event) => setIncoterm(event.target.value.toUpperCase())} /></Field></> : null}
            <Button className="min-h-12 rounded-xl font-black sm:col-span-2" disabled={!orderNumber.trim() || !buyerName.trim() || orderLines.length === 0 || (orderType === "export" && (!destination.trim() || !incoterm.trim())) || createTradeOrder.isPending} onClick={() => createTradeOrder.mutate()}>{createTradeOrder.isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}{t("manufacturing.orders.createAction")}</Button>
          </div>
        </div>

        <div className={panel}>
          <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="flex items-center gap-2 font-display font-black text-slate-900"><Globe2 size={18} className="text-teal-700" />{t("manufacturing.orders.registerTitle")}</h2></div>
          {dispatchOrderId ? <div className="grid gap-2 border-b border-amber-200 bg-amber-50 p-4 sm:grid-cols-2"><Input placeholder={t("manufacturing.orders.dispatchNumber")} value={dispatchNumber} onChange={(event) => setDispatchNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.transporter")} value={transporterName} onChange={(event) => setTransporterName(event.target.value)} /><Input placeholder={t("manufacturing.orders.vehicle")} value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.awb")} value={lrAwbNumber} onChange={(event) => setLrAwbNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.eway")} value={ewayBillNumber} onChange={(event) => setEwayBillNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.shippingBill")} value={shippingBillNumber} onChange={(event) => setShippingBillNumber(event.target.value)} /><Button disabled={!dispatchNumber.trim() || dispatchTradeOrder.isPending} onClick={() => dispatchTradeOrder.mutate()}>{t("manufacturing.orders.action.packed")}</Button><Button variant="outline" onClick={() => setDispatchOrderId("")}>{t("manufacturing.orders.cancelDispatch")}</Button></div> : null}
          {invoiceOrderId ? <div className="flex flex-col gap-2 border-b border-blue-200 bg-blue-50 p-4 sm:flex-row"><Input placeholder={t("manufacturing.orders.billId")} value={invoiceBillId} onChange={(event) => setInvoiceBillId(event.target.value)} /><Button disabled={!invoiceBillId.trim() || linkTradeInvoice.isPending} onClick={() => linkTradeInvoice.mutate()}>{t("manufacturing.orders.linkInvoice")}</Button><Button variant="outline" onClick={() => setInvoiceOrderId("")}>{t("manufacturing.orders.close")}</Button></div> : null}
          {returnOrderId ? <div className="grid gap-2 border-b border-rose-200 bg-rose-50 p-4 sm:grid-cols-2"><Input placeholder={t("manufacturing.orders.returnReason")} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /><Input type="password" inputMode="numeric" maxLength={4} placeholder={t("manufacturing.orders.ownerPin")} value={returnOwnerPin} onChange={(event) => setReturnOwnerPin(event.target.value.replace(/\D/g, ""))} /><Button disabled={returnReason.trim().length < 3 || returnOwnerPin.length !== 4 || returnTradeOrder.isPending} onClick={() => returnTradeOrder.mutate()}>{t("manufacturing.orders.createCreditNote")}</Button><Button variant="outline" onClick={() => setReturnOrderId("")}>{t("manufacturing.orders.close")}</Button></div> : null}
          <div className="divide-y divide-slate-100">
            {(tradeOrdersQ.data ?? []).map((order) => <div key={order.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_1fr_100px_100px_220px]"><div><strong className="block text-slate-900">{order.orderNumber}</strong><span className="text-xs text-slate-500">{order.buyerPoNumber || t("manufacturing.orders.noBuyerPo")}</span></div><div><strong className="block">{order.customerName}</strong><span className="text-xs text-slate-500">{order.items.length} {t("manufacturing.orders.lines")}</span></div><span className="font-bold uppercase text-slate-600">{order.orderType}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-center text-xs font-black text-slate-700">{order.status}</span><div>{order.status in tradeActionKey ? <Button size="sm" className="w-full" disabled={advanceTradeOrder.isPending} onClick={() => advanceTradeOrder.mutate(order)}>{t(tradeActionKey[order.status as keyof typeof tradeActionKey])}</Button> : order.status === "packed" ? <Button size="sm" className="w-full" onClick={() => { setDispatchOrderId(order.id); setDispatchNumber(`DSP-${order.orderNumber}`.slice(0, 64)); }}>{t("manufacturing.orders.action.packed")}</Button> : <div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => void openTradePdf(order, "tax-invoice")}>{t("manufacturing.orders.invoicePdf")}</Button><Button size="sm" variant="outline" onClick={() => void openTradePdf(order, "packing-list")}>{t("manufacturing.orders.packingPdf")}</Button><Button size="sm" variant="outline" onClick={() => void openTradePdf(order, "shipping-label")}>{t("manufacturing.orders.labelPdf")}</Button>{order.status === "dispatched" ? <Button size="sm" onClick={() => setInvoiceOrderId(order.id)}>{t("manufacturing.orders.linkInvoice")}</Button> : null}{order.status === "invoiced" ? <Button size="sm" variant="destructive" onClick={() => setReturnOrderId(order.id)}>{t("manufacturing.orders.return")}</Button> : null}</div>}</div></div>)}
            {!tradeOrdersQ.isLoading && !tradeOrdersQ.data?.length ? <div className="p-8 text-center text-slate-500">{t("manufacturing.orders.empty")}</div> : null}
          </div>
        </div>
      </section>

      <section className={panel}>
        <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="font-display font-black text-slate-900">{t("manufacturing.flipkart.title")}</h2><p className="mt-1 text-xs text-slate-500">{flipkartQ.data?.configured ? t("manufacturing.flipkart.connected") : t("manufacturing.flipkart.notConfigured")}</p></div>
        <div className="flex flex-col gap-2 p-4 sm:flex-row"><Input value={flipkartShipmentId} onChange={(event) => setFlipkartShipmentId(event.target.value)} placeholder={t("manufacturing.flipkart.shipmentId")} /><Button disabled={!flipkartQ.data?.configured || !flipkartShipmentId.trim()} onClick={() => void openFlipkartPdf("invoice")}>{t("manufacturing.flipkart.invoice")}</Button><Button disabled={!flipkartQ.data?.configured || !flipkartShipmentId.trim()} onClick={() => void openFlipkartPdf("label")}>{t("manufacturing.flipkart.label")}</Button></div>
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
