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
import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageShell } from "@/components/shared/PageShell";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@/types/api";
import ProductionRuns from "./ProductionRuns";
import RecipeEditor from "./RecipeEditor";
import TradeInvoiceDialog from "./TradeInvoiceDialog";
import type { ProductionRun } from "../production-run";
import { tradeOrderLine } from "../trade-order-line";
import { canCancelTradeOrder, lineCountKey, localDay, tradeOrderDocuments, tradeOrderStatusKey } from "../trade-order-status";

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

type Overview = {
  summary: {
    activeBoms: number;
    plannedRuns: number;
    inProgressRuns: number;
    quarantinedLots: number;
  };
  recentRuns: ProductionRun[];
};

type TraceRun = { id: string; runNumber: string; manufacturedOn?: string | null };
type Trace = {
  batchNumber: string;
  producedAs: Array<{ id: string; productId: string; quantityBaseQty: number; run: TraceRun & { consumptions: Array<{ id: string; productId: string; actualBaseQty: number; sourceBatchNumber?: string | null }> } }>;
  consumedBy: Array<{ id: string; productId: string; actualBaseQty: number; run: TraceRun & { outputs: Array<{ batchNumber: string }> } }>;
  dispatchedBills?: Array<{ id: string; billNo: string; customerName?: string | null; businessDate?: string | null }>;
  tradeOrders?: Array<{ id: string; orderNumber: string; customerName: string; status: string }>;
};

type TradeOrder = {
  id: string; orderNumber: string; buyerPoNumber?: string | null; customerName: string;
  orderType: "domestic" | "export"; status: string; currencyCode: string;
  billId?: string | null; customerId?: string | null;
  countryOfDestination?: string | null; items: Array<{ id: string; description: string; quantity: number; lineTotal: number; gstRate?: number }>;
};
type DraftOrderLine = NonNullable<ReturnType<typeof tradeOrderLine>>;
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
  const [traceBatch, setTraceBatch] = useState("");
  const [traceResult, setTraceResult] = useState<Trace | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [buyerPoNumber, setBuyerPoNumber] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [orderProductId, setOrderProductId] = useState("");
  const [orderUnitId, setOrderUnitId] = useState("");
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
  const [returnRefundMode, setReturnRefundMode] = useState("bank");
  const [returnOrderId, setReturnOrderId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnOwnerPin, setReturnOwnerPin] = useState("");
  const [cancelOrderId, setCancelOrderId] = useState("");
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

  const trace = useMutation({
    mutationFn: (batchNumber: string) => apiRequest<Trace>(
      `/manufacturing/trace?batchNumber=${encodeURIComponent(batchNumber.trim())}`,
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
        items: orderLines.map((line) => ({ productId: line.productId, sellingUnitId: line.sellingUnitId, quantity: line.quantity, unitPrice: line.unitPrice, lineDiscount: 0 })),
      }),
    }),
    onSuccess: async () => {
      toast({ title: t("manufacturing.orders.createdTitle"), description: t("manufacturing.orders.createdDetail") });
      setOrderNumber(""); setBuyerPoNumber(""); setBuyerName(""); setOrderProductId(""); setOrderUnitId(""); setOrderLines([]);
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
    mutationFn: () => apiRequest(`/manufacturing/trade-orders/${dispatchOrderId}/dispatch`, { method: "POST", body: JSON.stringify({ dispatchNumber, dispatchDate: localDay(), transporterName: transporterName || null, vehicleNumber: vehicleNumber || null, lrAwbNumber: lrAwbNumber || null, ewayBillNumber: ewayBillNumber || null, shippingBillNumber: shippingBillNumber || null }) }),
    onSuccess: async () => { setDispatchOrderId(""); setDispatchNumber(""); setTransporterName(""); setVehicleNumber(""); setLrAwbNumber(""); setEwayBillNumber(""); setShippingBillNumber(""); toast({ title: t("manufacturing.orders.updatedTitle"), description: t("manufacturing.orders.updatedDetail") }); await tradeOrdersQ.refetch(); },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  const returnTradeOrder = useMutation({
    mutationFn: () => apiRequest(`/manufacturing/trade-orders/${returnOrderId}/return`, { method: "POST", ownerPin: returnOwnerPin, body: JSON.stringify({ reason: returnReason, refundMode: returnRefundMode }) }),
    onSuccess: async () => { setReturnOrderId(""); setReturnReason(""); setReturnOwnerPin(""); toast({ title: t("manufacturing.orders.returnedTitle"), description: t("manufacturing.orders.returnedDetail") }); await tradeOrdersQ.refetch(); },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  // The server has always cancelled draft-to-packed orders; the register had no
  // button for it, so an order entered by mistake stayed open for good.
  const cancelTradeOrder = useMutation({
    mutationFn: (id: string) => apiRequest(`/manufacturing/trade-orders/${id}/cancel`, { method: "POST", body: "{}" }),
    onSuccess: async () => { setCancelOrderId(""); toast({ title: t("manufacturing.orders.cancelledTitle") }); await tradeOrdersQ.refetch(); },
    onError: (error) => toast({ title: t("manufacturing.orders.failedTitle"), description: error instanceof Error ? error.message : t("manufacturing.orders.failedDetail"), variant: "destructive" }),
  });

  const orderProduct = (productsQ.data ?? []).find((row) => row.id === orderProductId);
  // Allocation, dispatch and returns all move stock by batch, so an untracked
  // product can be ordered but never shipped. Offer only what can be fulfilled.
  const orderableProducts = (productsQ.data ?? []).filter((row) => row.batchTrackingEnabled);
  const dispatchOrder = tradeOrdersQ.data?.find((order) => order.id === dispatchOrderId);
  const cancelOrder = tradeOrdersQ.data?.find((order) => order.id === cancelOrderId);
  const nextOrderLine = tradeOrderLine(orderProduct, orderUnitId, orderQty, orderPrice);
  const addOrderLine = () => {
    if (!nextOrderLine) return;
    setOrderLines((current) => [...current, nextOrderLine]);
    setOrderProductId(""); setOrderUnitId(""); setOrderQty("1"); setOrderPrice("0");
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

      <ProductionRuns runs={overviewQ.data?.recentRuns ?? []} boms={bomsQ.data ?? []} products={productsQ.data ?? []} loading={overviewQ.isLoading} />

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <RecipeEditor products={productsQ.data ?? []} />

        <div className={panel}>
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <h2 className="font-display font-black text-slate-900">{t("manufacturing.trace.title")}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{t("manufacturing.trace.description")}</p>
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex gap-2">
              <Input className="h-11" value={traceBatch} onChange={(event) => setTraceBatch(event.target.value)} placeholder={t("manufacturing.trace.batchPlaceholder")} />
              <Button className="min-h-11 shrink-0 gap-2" disabled={!traceBatch.trim() || trace.isPending} onClick={() => trace.mutate(traceBatch)}>
                {trace.isPending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                {t("manufacturing.trace.action")}
              </Button>
            </div>
            {traceResult ? <TraceDetails trace={traceResult} products={productsQ.data ?? []} t={t} onTrace={(batchNumber) => { setTraceBatch(batchNumber); trace.mutate(batchNumber); }} /> : null}
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
          <table className="trade-mobile-table min-w-[680px] w-full text-sm">
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
                  <td data-label={t("manufacturing.register.bom")} className="p-3 font-bold text-slate-900">{bom.name}</td>
                  <td data-label={t("manufacturing.register.finishedGood")} className="p-3">{productNames.get(bom.finishedProductId) ?? bom.finishedProductId}</td>
                  <td data-label={t("manufacturing.register.version")} className="p-3">{t("manufacturing.register.versionValue", { version: bom.version })}</td>
                  <td data-label={t("manufacturing.register.materials")} className="p-3">{bom.items.length}</td>
                  <td data-label={t("manufacturing.register.status")} className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${bom.status === "active" ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600"}`}>{t(bom.status === "active" ? "manufacturing.register.status.active" : "manufacturing.register.status.superseded")}</span></td>
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
            <Field label={t("manufacturing.orders.product")}><ProductSelect value={orderProductId} onChange={(id) => { setOrderProductId(id); setOrderUnitId(""); }} products={orderableProducts} emptyLabel={t("manufacturing.product.select")} unitFallback={t("manufacturing.product.unitFallback")} /></Field>
            <Field label={t("manufacturing.production.unit")}><select className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={orderUnitId} disabled={!orderProduct} onChange={(event) => setOrderUnitId(event.target.value)}><option value="" disabled={orderProduct?.packagingMode === "per_pack"}>{t(orderProduct?.packagingMode === "per_pack" ? "manufacturing.production.choosePack" : "manufacturing.production.baseUnits", { unit: orderProduct?.baseUnit || "" })}</option>{orderProduct?.sellingUnits?.filter((unit) => unit.id && unit.isActive && unit.conversionToBase > 0).map((unit) => <option value={unit.id} key={unit.id}>{unit.name}</option>)}</select></Field>
            <p className="text-xs leading-5 text-slate-500 sm:col-span-2">{t("manufacturing.orders.batchOnly")}</p>
            <Field label={t("manufacturing.orders.quantity")}><Input className="h-11" type="number" min="0.01" max="1000000000" step="0.01" value={orderQty} onChange={(event) => setOrderQty(event.target.value)} /></Field>
            <Field label={t("manufacturing.orders.unitPrice")}><Input className="h-11" type="number" min="0" max="1000000000" step="0.01" value={orderPrice} onChange={(event) => setOrderPrice(event.target.value)} /></Field>
            {nextOrderLine && <p className="text-xs text-slate-500 sm:col-span-2">{t("manufacturing.production.baseTotal", { qty: nextOrderLine.quantityBaseQty, unit: orderProduct?.baseUnit || "" })}</p>}
            <Button type="button" variant="outline" className="min-h-11 sm:col-span-2" disabled={!nextOrderLine || orderLines.length >= 500} onClick={addOrderLine}>{t("manufacturing.orders.addLine")}</Button>
            {orderLines.length ? <div className="space-y-2 rounded-xl bg-slate-50 p-3 sm:col-span-2">{orderLines.map((line, index) => <div key={`${line.productId}-${index}`} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 break-words"><strong>{line.description}</strong> - {line.quantity} {line.unitName} × {line.unitPrice.toFixed(2)}</span><Button className="min-h-11 shrink-0" size="sm" variant="ghost" onClick={() => setOrderLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>{t("manufacturing.orders.removeLine")}</Button></div>)}</div> : null}
            {orderType === "export" ? <><Field label={t("manufacturing.orders.currency")}><Input className="h-11 uppercase" maxLength={3} value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></Field><Field label={t("manufacturing.orders.exchangeRate")}><Input className="h-11" type="number" min="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} /></Field><Field label={t("manufacturing.orders.destination")}><Input className="h-11" value={destination} onChange={(event) => setDestination(event.target.value)} /></Field><Field label={t("manufacturing.orders.incoterm")}><Input className="h-11 uppercase" placeholder={t("manufacturing.orders.incotermPlaceholder")} value={incoterm} onChange={(event) => setIncoterm(event.target.value.toUpperCase())} /></Field></> : null}
            <Button className="min-h-12 rounded-xl font-black sm:col-span-2" disabled={!orderNumber.trim() || !buyerName.trim() || orderLines.length === 0 || (orderType === "export" && (!destination.trim() || !incoterm.trim())) || createTradeOrder.isPending} onClick={() => createTradeOrder.mutate()}>{createTradeOrder.isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}{t("manufacturing.orders.createAction")}</Button>
          </div>
        </div>

        <div className={panel}>
          <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="flex items-center gap-2 font-display font-black text-slate-900"><Globe2 size={18} className="text-teal-700" />{t("manufacturing.orders.registerTitle")}</h2></div>
          {dispatchOrderId ? <div className="grid gap-2 border-b border-amber-200 bg-amber-50 p-4 sm:grid-cols-2"><Input placeholder={t("manufacturing.orders.dispatchNumber")} value={dispatchNumber} onChange={(event) => setDispatchNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.transporter")} value={transporterName} onChange={(event) => setTransporterName(event.target.value)} /><Input placeholder={t("manufacturing.orders.vehicle")} value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.awb")} value={lrAwbNumber} onChange={(event) => setLrAwbNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.eway")} value={ewayBillNumber} onChange={(event) => setEwayBillNumber(event.target.value)} /><Input placeholder={t("manufacturing.orders.shippingBill")} value={shippingBillNumber} onChange={(event) => setShippingBillNumber(event.target.value)} />{dispatchOrder?.orderType === "export" ? <p role="alert" className="text-xs leading-5 text-amber-900 sm:col-span-2">{t("manufacturing.orders.exportDispatchWarning")}</p> : null}<Button disabled={!dispatchNumber.trim() || dispatchTradeOrder.isPending} onClick={() => dispatchTradeOrder.mutate()}>{t("manufacturing.orders.action.packed")}</Button><Button variant="outline" onClick={() => setDispatchOrderId("")}>{t("manufacturing.orders.cancelDispatch")}</Button></div> : null}
          {invoiceOrderId && tradeOrdersQ.data?.find(order => order.id === invoiceOrderId) ? <TradeInvoiceDialog key={invoiceOrderId} order={tradeOrdersQ.data.find(order => order.id === invoiceOrderId)!} onClose={() => setInvoiceOrderId("")} onSaved={async () => { await tradeOrdersQ.refetch(); toast({ title: t("manufacturing.invoice.saved") }); }} /> : null}
          {returnOrderId ? <div className="grid gap-2 border-b border-rose-200 bg-rose-50 p-4 sm:grid-cols-2"><label className="text-xs font-semibold">{t("manufacturing.invoice.refund")}<select className="min-h-11 w-full rounded-lg border bg-white px-3" value={returnRefundMode} onChange={event => setReturnRefundMode(event.target.value)}><option value="bank">{t("manufacturing.invoice.bankRefund")}</option><option value="cash">{t("manufacturing.invoice.cashRefund")}</option><option value="upi">{t("manufacturing.invoice.upiRefund")}</option></select><span className="mt-1 block font-normal">{t("manufacturing.invoice.returnCreditNotice")}</span></label><Input placeholder={t("manufacturing.orders.returnReason")} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /><Input type="password" inputMode="numeric" maxLength={4} placeholder={t("manufacturing.orders.ownerPin")} value={returnOwnerPin} onChange={(event) => setReturnOwnerPin(event.target.value.replace(/\D/g, ""))} /><Button disabled={returnReason.trim().length < 3 || returnOwnerPin.length !== 4 || returnTradeOrder.isPending} onClick={() => returnTradeOrder.mutate()}>{t("manufacturing.orders.createCreditNote")}</Button><Button variant="outline" onClick={() => setReturnOrderId("")}>{t("manufacturing.orders.close")}</Button></div> : null}
          <div className="divide-y divide-slate-100">
            {(tradeOrdersQ.data ?? []).map((order) => {
              const documents = tradeOrderDocuments(order);
              // Three columns that shrink, with actions on their own row. The old
              // row reserved 420px of fixed columns inside a ~520px panel, so at
              // laptop width the order number wrapped a character at a time.
              return <div key={order.id} className="grid gap-3 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div className="min-w-0"><strong className="block break-words text-slate-900">{order.orderNumber}</strong><span className="text-xs text-slate-500">{order.buyerPoNumber || t("manufacturing.orders.noBuyerPo")}</span></div>
                <div className="min-w-0"><strong className="block break-words">{order.customerName}</strong><span className="text-xs text-slate-500">{t(lineCountKey(order.items.length), { count: order.items.length })}</span></div>
                <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end"><span className="text-xs font-bold uppercase text-slate-600">{t(order.orderType === "export" ? "manufacturing.orders.export" : "manufacturing.orders.domestic")}</span><span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{t(tradeOrderStatusKey(order.status))}</span></div>
                <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
                  {order.status in tradeActionKey ? <Button size="sm" className="min-h-11" disabled={advanceTradeOrder.isPending} onClick={() => advanceTradeOrder.mutate(order)}>{t(tradeActionKey[order.status as keyof typeof tradeActionKey])}</Button> : null}
                  {order.status === "packed" ? <Button size="sm" className="min-h-11" onClick={() => { setDispatchOrderId(order.id); setDispatchNumber(`DSP-${order.orderNumber}`.slice(0, 64)); }}>{t("manufacturing.orders.action.packed")}</Button> : null}
                  {order.status === "dispatched" && order.orderType === "domestic" ? <Button size="sm" className="min-h-11" onClick={() => setInvoiceOrderId(order.id)}>{t("manufacturing.invoice.create")}</Button> : null}
                  {documents.invoice ? <Button size="sm" className="min-h-11" variant="outline" onClick={() => void openTradePdf(order, "tax-invoice")}>{t("manufacturing.orders.invoicePdf")}</Button> : null}
                  {documents.packingList ? <Button size="sm" className="min-h-11" variant="outline" onClick={() => void openTradePdf(order, "packing-list")}>{t("manufacturing.orders.packingPdf")}</Button> : null}
                  {documents.label ? <Button size="sm" className="min-h-11" variant="outline" onClick={() => void openTradePdf(order, "shipping-label")}>{t("manufacturing.orders.labelPdf")}</Button> : null}
                  {order.status === "invoiced" ? <Button size="sm" className="min-h-11" variant="destructive" onClick={() => setReturnOrderId(order.id)}>{t("manufacturing.orders.return")}</Button> : null}
                  {canCancelTradeOrder(order.status) ? <Button size="sm" className="min-h-11 text-rose-700" variant="ghost" disabled={cancelTradeOrder.isPending} onClick={() => setCancelOrderId(order.id)}>{t("manufacturing.orders.cancel")}</Button> : null}
                  {order.status === "dispatched" && order.orderType === "export" ? <p className="basis-full text-xs leading-5 text-amber-800">{t("manufacturing.invoice.exportPending")}</p> : null}
                </div>
              </div>;
            })}
            {!tradeOrdersQ.isLoading && !tradeOrdersQ.data?.length ? <div className="p-8 text-center text-slate-500">{t("manufacturing.orders.empty")}</div> : null}
          </div>
        </div>
      </section>

      <section className={panel}>
        <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="font-display font-black text-slate-900">{t("manufacturing.flipkart.title")}</h2><p className="mt-1 text-xs text-slate-500">{flipkartQ.data?.configured ? t("manufacturing.flipkart.connected") : t("manufacturing.flipkart.notConfigured")}</p></div>
        <div className="flex flex-col gap-2 p-4 sm:flex-row"><Input value={flipkartShipmentId} onChange={(event) => setFlipkartShipmentId(event.target.value)} placeholder={t("manufacturing.flipkart.shipmentId")} /><Button disabled={!flipkartQ.data?.configured || !flipkartShipmentId.trim()} onClick={() => void openFlipkartPdf("invoice")}>{t("manufacturing.flipkart.invoice")}</Button><Button disabled={!flipkartQ.data?.configured || !flipkartShipmentId.trim()} onClick={() => void openFlipkartPdf("label")}>{t("manufacturing.flipkart.label")}</Button></div>
      </section>

      <Dialog open={Boolean(cancelOrder)} onOpenChange={(open) => { if (!open && !cancelTradeOrder.isPending) setCancelOrderId(""); }}>
        <DialogContent>
          <DialogHeader className="pr-8"><DialogTitle>{t("manufacturing.orders.cancelTitle")}</DialogTitle><DialogDescription>{t("manufacturing.orders.cancelDetail", { order: cancelOrder?.orderNumber ?? "" })}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="min-h-11" disabled={cancelTradeOrder.isPending} onClick={() => setCancelOrderId("")}>{t("manufacturing.orders.keepOrder")}</Button><Button variant="destructive" className="min-h-11 gap-2" disabled={cancelTradeOrder.isPending || !cancelOrder} onClick={() => cancelOrder && cancelTradeOrder.mutate(cancelOrder.id)}>{cancelTradeOrder.isPending ? <Loader2 size={16} className="animate-spin" /> : null}{t("manufacturing.orders.cancel")}</Button></div>
        </DialogContent>
      </Dialog>

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

/**
 * A recall asks two questions of a batch: what went into it, and where did it
 * go. The panel used to answer both with a count ("Downstream production uses:
 * 1"), though the server already returned the runs, source lots and buyers.
 */
function TraceDetails({ trace, products, t, onTrace }: { trace: Trace; products: Product[]; t: Translate; onTrace: (batchNumber: string) => void }) {
  const product = (id: string) => products.find((row) => row.id === id);
  const name = (id: string) => product(id)?.name ?? id;
  const unit = (id: string) => product(id)?.baseUnit ?? "";
  const runs = [...new Map(trace.producedAs.map((row) => [row.run.id, row])).values()];
  const sources = runs.flatMap((row) => row.run.consumptions);
  const bills = trace.dispatchedBills ?? [];
  const orders = trace.tradeOrders ?? [];
  const nothing = !runs.length && !trace.consumedBy.length && !bills.length && !orders.length;
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-teal-100 bg-teal-50/60 p-4 text-sm" data-testid="manufacturing-trace-result">
      <p className="break-all font-black text-teal-950">{trace.batchNumber}</p>
      {nothing ? <p className="text-teal-800">{t("manufacturing.trace.nothing")}</p> : null}
      <TraceList title={t("manufacturing.trace.producedTitle")} rows={runs.map((row) => ({ key: row.run.id, text: t("manufacturing.trace.producedRow", { run: row.run.runNumber, date: row.run.manufacturedOn?.slice(0, 10) ?? "-", qty: trace.producedAs.filter((output) => output.run.id === row.run.id).reduce((sum, output) => sum + Number(output.quantityBaseQty), 0), unit: unit(row.productId) }) }))} />
      {/* A recall walks the chain one hop at a time: raw lot → finished batch → buyers. */}
      <TraceList title={t("manufacturing.trace.sourcesTitle")} rows={sources.map((row) => ({ key: row.id, next: row.sourceBatchNumber ?? undefined, text: row.sourceBatchNumber ? t("manufacturing.trace.sourceRow", { material: name(row.productId), batch: row.sourceBatchNumber, qty: row.actualBaseQty, unit: unit(row.productId) }) : t("manufacturing.trace.untrackedSource", { material: name(row.productId), qty: row.actualBaseQty, unit: unit(row.productId) }) }))} onTrace={onTrace} />
      <TraceList title={t("manufacturing.trace.usedTitle")} rows={trace.consumedBy.map((row) => { const batches = [...new Set(row.run.outputs.map((output) => output.batchNumber))]; return { key: row.id, next: batches.length === 1 ? batches[0] : undefined, text: t("manufacturing.trace.usedRow", { run: row.run.runNumber, batch: batches.join(", ") || "-", qty: row.actualBaseQty, unit: unit(row.productId) }) }; })} onTrace={onTrace} />
      <TraceList title={t("manufacturing.trace.ordersTitle")} rows={orders.map((order) => ({ key: order.id, text: t("manufacturing.trace.orderRow", { order: order.orderNumber, customer: order.customerName, status: t(tradeOrderStatusKey(order.status)) }) }))} />
      <TraceList title={t("manufacturing.trace.billsTitle")} rows={bills.map((bill) => ({ key: bill.id, text: t("manufacturing.trace.billRow", { bill: bill.billNo, customer: bill.customerName || "-", date: bill.businessDate?.slice(0, 10) ?? "-" }) }))} />
    </div>
  );
}

function TraceList({ title, rows, onTrace }: { title: string; rows: Array<{ key: string; text: string; next?: string }>; onTrace?: (batchNumber: string) => void }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-teal-900">{title}</p>
      <ul className="mt-1 space-y-1 text-teal-800">{rows.map((row) => <li key={row.key} className="break-words">{row.next && onTrace
        ? <button type="button" className="min-h-11 text-left underline decoration-dotted underline-offset-4 hover:text-teal-950" onClick={() => onTrace(row.next!)}>{row.text}</button>
        : row.text}</li>)}</ul>
    </div>
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
