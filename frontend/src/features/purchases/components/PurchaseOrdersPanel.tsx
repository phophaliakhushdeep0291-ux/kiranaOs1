import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, Loader2, PackageCheck, Plus, Send, Sparkles, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { listProducts } from "@/features/products/api";
import { listSuppliers } from "@/features/suppliers/api";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getReorderSuggestions,
  listPurchaseOrders,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type PurchaseOrder,
} from "@/features/purchases/purchase-orders-api";
import { cn } from "@/lib/utils";

type DraftLine = { productId: string; productName: string; baseUnit: string; qty: string; rate: string };
type ReceiptLine = { purchaseOrderItemId: string; productName: string; baseUnit: string; qty: string; rate: string; remaining: number; basePerRateUnit: number };
type Approval = { title: string; description: string; confirmLabel: string; run: (pin: string) => Promise<void> };

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-700" },
  sent: { label: "Awaiting stock", cls: "bg-blue-50 text-blue-700" },
  partially_received: { label: "Part received", cls: "bg-amber-50 text-amber-700" },
  received: { label: "Received", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-rose-50 text-rose-700" },
};

const inr = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function PurchaseOrdersPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const ordersQ = useQuery({ queryKey: ["purchase-orders"], queryFn: listPurchaseOrders });
  const suggestionsQ = useQuery({ queryKey: ["purchase-order-suggestions"], queryFn: getReorderSuggestions });
  const suppliersQ = useQuery({ queryKey: ["suppliers", "purchase-orders"], queryFn: listSuppliers });
  const productsQ = useQuery({ queryKey: ["products", "purchase-orders"], queryFn: () => listProducts({ limit: 1000 }) });
  const [createOpen, setCreateOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [expectedOn, setExpectedOn] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [productToAdd, setProductToAdd] = useState("");
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [supplierInvoice, setSupplierInvoice] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [receiptKey, setReceiptKey] = useState("");
  const [approval, setApproval] = useState<Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["purchase-order-suggestions"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory"] }),
    ]);
  };

  const openCreate = () => {
    const suggestions = suggestionsQ.data ?? [];
    setDraftLines(suggestions.map((row) => ({ productId: row.productId, productName: row.productName, baseUnit: row.baseUnit, qty: String(row.recommendedOrderBaseQty), rate: String(row.expectedRate || "") })));
    const suggestedSupplier = suggestions.find((row) => row.supplierId)?.supplierId ?? "";
    setSupplierId(suggestedSupplier);
    setExpectedOn("");
    setError("");
    setCreateOpen(true);
  };

  const addProduct = () => {
    const product = productsQ.data?.find((row) => row.id === productToAdd);
    if (!product || draftLines.some((line) => line.productId === product.id)) return;
    setDraftLines((rows) => [...rows, { productId: product.id, productName: product.name, baseUnit: product.baseUnit || "piece", qty: String(product.reorderLevel || 1), rate: String(product.costPerRateUnit || "") }]);
    setProductToAdd("");
  };

  const saveDraft = async () => {
    const supplier = suppliersQ.data?.find((row) => row.id === supplierId);
    const items = draftLines.filter((line) => Number(line.qty) > 0 && Number(line.rate) > 0);
    if (!supplier || items.length === 0) { setError("Choose a supplier and add at least one line with quantity and rate."); return; }
    setBusy(true); setError("");
    try {
      const created = await createPurchaseOrder({ supplierId: supplier.id, supplierName: supplier.name, expectedOn: expectedOn || undefined, items: items.map((line) => ({ productId: line.productId, orderedBaseQty: Number(line.qty), expectedRate: Number(line.rate) })) });
      setCreateOpen(false);
      await refresh();
      toast({ title: `${created.orderNumber} created`, description: "Draft purchase order is ready for approval and sending." });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create purchase order."); }
    finally { setBusy(false); }
  };

  const requestSend = (order: PurchaseOrder) => setApproval({
    title: `Send ${order.orderNumber}`,
    description: `Approve this ${inr(order.expectedTotal)} order for ${order.supplierName}.`,
    confirmLabel: "Send order",
    run: async (pin) => { await sendPurchaseOrder(order.id, pin); await refresh(); toast({ title: "Purchase order sent" }); },
  });

  const openReceive = (order: PurchaseOrder) => {
    const lines = order.items.filter((item) => item.receivedBaseQty < item.orderedBaseQty).map((item) => ({ purchaseOrderItemId: item.id, productName: item.productName, baseUnit: item.baseUnit, qty: String(Number((item.orderedBaseQty - item.receivedBaseQty).toFixed(2))), rate: String(item.expectedRate), remaining: Number((item.orderedBaseQty - item.receivedBaseQty).toFixed(2)), basePerRateUnit: item.expectedRate > 0 && item.expectedAmount > 0 ? item.orderedBaseQty / (item.expectedAmount / item.expectedRate) : 1 }));
    const total = lines.reduce((sum, line) => sum + (Number(line.qty) / line.basePerRateUnit) * Number(line.rate), 0);
    setReceiptLines(lines); setSupplierInvoice(""); setPaidAmount(String(Number(total.toFixed(2)))); setPaymentMode("cash"); setReceiptKey(`po-receipt:${order.id}:${crypto.randomUUID()}`); setError(""); setReceiveOrder(order);
  };

  const receiptTotal = useMemo(() => receiptLines.reduce((sum, line) => sum + (Number(line.qty || 0) / line.basePerRateUnit) * Number(line.rate || 0), 0), [receiptLines]);

  const requestReceive = () => {
    if (!receiveOrder) return;
    const lines = receiptLines.filter((line) => Number(line.qty) > 0 && Number(line.rate) > 0);
    if (!lines.length || Number(paidAmount) > receiptTotal) { setError("Enter valid receipt quantities, rates and payment amount."); return; }
    setReceiveOrder(null);
    setApproval({
      title: `Receive ${receiveOrder.orderNumber}`,
      description: `Add ${lines.length} line${lines.length === 1 ? "" : "s"} worth approximately ${inr(receiptTotal)} to branch stock.`,
      confirmLabel: "Receive stock",
      run: async (pin) => {
        const result = await receivePurchaseOrder(receiveOrder.id, { idempotencyKey: receiptKey, supplierInvoiceNumber: supplierInvoice || undefined, paidAmount: Number(paidAmount || 0), paymentMode: Number(paidAmount || 0) > 0 ? paymentMode : undefined, items: lines.map((line) => ({ purchaseOrderItemId: line.purchaseOrderItemId, quantityBaseQty: Number(line.qty), actualRate: Number(line.rate) })) }, pin);
        await refresh();
        toast({ title: `${result.receipt.receiptNumber} saved`, description: result.purchaseOrder.status === "received" ? "Order completed and stock updated." : "Partial receipt saved; remaining stock stays open." });
      },
    });
  };

  const requestCancel = (order: PurchaseOrder) => setApproval({
    title: `Cancel ${order.orderNumber}`,
    description: "Received stock remains in inventory; only the unreceived balance will be closed.",
    confirmLabel: "Cancel order",
    run: async (pin) => { await cancelPurchaseOrder(order.id, "Cancelled by owner from purchase workspace", pin); await refresh(); toast({ title: "Purchase order cancelled" }); },
  });

  const confirmApproval = async (pin: string) => {
    if (!approval) return;
    setBusy(true); setError("");
    try { await approval.run(pin); setApproval(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); }
    finally { setBusy(false); }
  };

  const openOrders = (ordersQ.data ?? []).filter((order) => !["received", "cancelled"].includes(order.status));

  return (
    <section className="overflow-hidden rounded-[14px] border border-[#dfe7f3] bg-white shadow-[0_10px_30px_rgba(15,35,80,0.05)]">
      <div className="flex flex-col gap-3 border-b border-[#edf1f7] bg-[linear-gradient(135deg,#f8fbff,#fff)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf2ff] text-[#075fff]"><ClipboardCheck size={17} /></span><div><h3 className="font-display text-[15px] font-black text-[#102347]">Purchase orders</h3><p className="text-[11px] text-[#64748b]">Plan, approve and receive supplier stock without losing the audit trail</p></div></div></div>
        <div className="flex items-center gap-2"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700"><Sparkles size={11} className="mr-1 inline" />{suggestionsQ.data?.length ?? 0} reorder suggestions</span><Button size="sm" className="h-9 gap-1.5" onClick={openCreate}><Plus size={13} /> New order</Button></div>
      </div>
      {ordersQ.isLoading ? <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#64748b]"><Loader2 size={15} className="animate-spin" /> Loading purchase orders…</div> : openOrders.length === 0 ? <div className="grid place-items-center px-5 py-8 text-center"><PackageCheck className="text-[#8ba8d8]" /><p className="mt-2 text-sm font-bold text-[#102347]">No open purchase orders</p><p className="mt-1 text-xs text-[#64748b]">Use reorder suggestions or add products manually to create one.</p></div> : <div className="grid gap-3 p-4 xl:grid-cols-2">{openOrders.slice(0, 6).map((order) => { const received = order.items.reduce((sum, item) => sum + item.receivedBaseQty, 0); const ordered = order.items.reduce((sum, item) => sum + item.orderedBaseQty, 0); const progress = ordered > 0 ? Math.round((received / ordered) * 100) : 0; const tone = STATUS[order.status] ?? STATUS.draft; return <article key={order.id} className="rounded-xl border border-[#e4eaf3] p-3.5"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black text-[#102347]">{order.orderNumber}</p><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", tone.cls)}>{tone.label}</span></div><p className="mt-1 text-xs font-semibold text-[#52627e]">{order.supplierName} · {order.location?.name}</p></div><p className="font-black text-[#102347]">{inr(order.expectedTotal)}</p></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]"><div className="h-full rounded-full bg-[#075fff] transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-2 flex items-center justify-between text-[10.5px] text-[#71809b]"><span>{order.items.length} products</span><span>{progress}% received</span></div><div className="mt-3 flex flex-wrap gap-2">{order.status === "draft" && <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => requestSend(order)}><Send size={12} /> Send</Button>}{["sent", "partially_received"].includes(order.status) && <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => openReceive(order)}><Truck size={12} /> Receive</Button>}<Button variant="outline" size="sm" className="h-8 gap-1 text-xs text-rose-600" onClick={() => requestCancel(order)}><X size={12} /> Cancel</Button></div></article>; })}</div>}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Create purchase order</DialogTitle><DialogDescription>Low-stock suggestions are prefilled. Adjust quantities and expected supplier rates before saving the draft.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><Label>Supplier</Label><Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger><SelectContent>{(suppliersQ.data ?? []).map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Expected delivery</Label><Input className="mt-1" type="date" value={expectedOn} onChange={(event) => setExpectedOn(event.target.value)} /></div></div><div className="flex gap-2"><Select value={productToAdd} onValueChange={setProductToAdd}><SelectTrigger><SelectValue placeholder="Add another product" /></SelectTrigger><SelectContent>{(productsQ.data ?? []).filter((product) => !draftLines.some((line) => line.productId === product.id)).map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" onClick={addProduct} disabled={!productToAdd}>Add</Button></div><div className="max-h-[330px] space-y-2 overflow-y-auto pr-1">{draftLines.map((line, index) => <div key={line.productId} className="grid grid-cols-[1fr_100px_110px_34px] items-end gap-2 rounded-xl border border-[#e5ebf4] p-3"><div><p className="text-sm font-bold text-[#102347]">{line.productName}</p><p className="text-[10px] text-[#8290a8]">Base unit: {line.baseUnit}</p></div><div><Label className="text-[10px]">Quantity</Label><Input className="h-9" type="number" min="0.01" value={line.qty} onChange={(event) => setDraftLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row))} /></div><div><Label className="text-[10px]">Expected rate</Label><Input className="h-9" type="number" min="0.01" value={line.rate} onChange={(event) => setDraftLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} /></div><Button variant="ghost" size="icon" className="h-9 w-9 text-rose-500" onClick={() => setDraftLines((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><X size={14} /></Button></div>)}</div>{error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={busy} onClick={saveDraft}>{busy && <Loader2 size={14} className="animate-spin" />} Save draft</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(receiveOrder)} onOpenChange={(open) => { if (!open) setReceiveOrder(null); }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Receive {receiveOrder?.orderNumber}</DialogTitle><DialogDescription>Enter the quantity actually delivered. Partial receipts keep the remaining balance open.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-3"><div><Label>Supplier invoice</Label><Input className="mt-1" value={supplierInvoice} onChange={(event) => setSupplierInvoice(event.target.value)} /></div><div><Label>Paid now</Label><Input className="mt-1" type="number" min="0" max={receiptTotal} value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} /></div><div><Label>Payment mode</Label><Select value={paymentMode} onValueChange={setPaymentMode}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="bank">Bank</SelectItem></SelectContent></Select></div></div><div className="max-h-[330px] space-y-2 overflow-y-auto pr-1">{receiptLines.map((line, index) => <div key={line.purchaseOrderItemId} className="grid grid-cols-[1fr_110px_110px] items-end gap-2 rounded-xl border border-[#e5ebf4] p-3"><div><p className="text-sm font-bold text-[#102347]">{line.productName}</p><p className="text-[10px] text-[#8290a8]">Remaining {line.remaining} {line.baseUnit}</p></div><div><Label className="text-[10px]">Received</Label><Input className="h-9" type="number" min="0" max={line.remaining} value={line.qty} onChange={(event) => setReceiptLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row))} /></div><div><Label className="text-[10px]">Actual rate</Label><Input className="h-9" type="number" min="0.01" value={line.rate} onChange={(event) => setReceiptLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} /></div></div>)}</div><div className="flex items-center justify-between rounded-xl bg-[#f5f8fd] px-4 py-3"><span className="text-xs font-bold text-[#52627e]">Receipt estimate</span><span className="font-display text-lg font-black text-[#102347]">{inr(receiptTotal)}</span></div>{error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setReceiveOrder(null)}>Cancel</Button><Button onClick={requestReceive}>Review receipt <ArrowRight size={14} /></Button></DialogFooter></DialogContent></Dialog>

      <OwnerPinModal open={Boolean(approval)} title={approval?.title ?? "Approve purchase order"} description={approval?.description} confirmLabel={approval?.confirmLabel} loading={busy} error={error} onCancel={() => { if (!busy) setApproval(null); }} onConfirm={({ ownerPin }) => confirmApproval(ownerPin)} />
    </section>
  );
}
