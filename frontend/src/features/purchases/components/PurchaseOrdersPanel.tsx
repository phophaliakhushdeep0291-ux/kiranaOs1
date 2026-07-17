import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, FileText, Loader2, PackageCheck, Plus, Printer, RotateCcw, Send, Share2, Sparkles, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { listProducts } from "@/features/products/api";
import { listSuppliers } from "@/features/suppliers/api";
import {
  cancelPurchaseOrder,
  createPurchaseReturn,
  createPurchaseOrder,
  getReorderSuggestions,
  listPurchaseOrders,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type PurchaseOrder,
} from "@/features/purchases/purchase-orders-api";
import { cn } from "@/lib/utils";

type DraftLine = { productId: string; productName: string; baseUnit: string; qty: string; rate: string };
type ReceiptLine = { purchaseOrderItemId: string; productName: string; baseUnit: string; qty: string; rate: string; remaining: number; basePerRateUnit: number; batchTrackingEnabled: boolean; batchNumber: string; manufacturedOn: string; expiresOn: string };
type Approval = { title: string; description: string; confirmLabel: string; run: (pin: string) => Promise<void> };

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-700" },
  sent: { label: "Awaiting stock", cls: "bg-blue-50 text-blue-700" },
  partially_received: { label: "Part received", cls: "bg-amber-50 text-amber-700" },
  received: { label: "Received", cls: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-rose-50 text-rose-700" },
};

const inr = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function purchaseOrderText(order: PurchaseOrder) {
  const lines = order.items.map((item) => `${item.productName}: ${item.orderedBaseQty} ${item.baseUnit} × ${inr(item.expectedRate)}`).join("\n");
  return `Purchase Order ${order.orderNumber}\nSupplier: ${order.supplierName}\nDeliver to: ${order.location.name}${order.deliveryAddress ? `, ${order.deliveryAddress}` : ""}\nExpected: ${order.expectedOn ? new Date(order.expectedOn).toLocaleDateString("en-IN") : "Not specified"}\n\n${lines}\n\nOrder total: ${inr(order.expectedTotal)}${order.paymentTerms ? `\nPayment terms: ${order.paymentTerms}` : ""}`;
}

function printPurchaseOrder(order: PurchaseOrder) {
  const popup = window.open("", "_blank", "width=960,height=760");
  if (!popup) return false;
  const rows = order.items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.productName)}</strong></td><td>${escapeHtml(item.orderedBaseQty)} ${escapeHtml(item.baseUnit)}</td><td>${escapeHtml(inr(item.expectedRate))}/${escapeHtml(item.rateUnit)}</td><td>${escapeHtml(inr(item.expectedAmount))}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(order.orderNumber)}</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#102347;margin:0;font-size:12px}.head{display:flex;justify-content:space-between;border-bottom:3px solid #075fff;padding-bottom:16px}.brand{font-size:24px;font-weight:900}.muted{color:#64748b}.badge{display:inline-block;padding:5px 9px;border-radius:999px;background:#eaf2ff;color:#075fff;font-weight:700;text-transform:uppercase}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:22px 0}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin-bottom:5px}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#f1f5fb;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em}th,td{padding:10px;border:1px solid #dfe7f3}th:nth-child(n+3),td:nth-child(n+3){text-align:right}.total{display:flex;justify-content:flex-end;margin-top:14px;font-size:19px;font-weight:900}.terms{margin-top:25px;border-top:1px solid #dfe7f3;padding-top:14px;white-space:pre-wrap}.footer{margin-top:42px;display:flex;justify-content:space-between;color:#64748b;font-size:10px}.signature{border-top:1px solid #94a3b8;padding-top:6px;width:180px;text-align:center}</style></head><body><div class="head"><div><div class="brand">Veyra</div><div class="muted">Purchase order</div></div><div style="text-align:right"><div class="badge">${escapeHtml(order.status)}</div><h2>${escapeHtml(order.orderNumber)}</h2><div class="muted">Issued ${escapeHtml(new Date(order.createdAt).toLocaleDateString("en-IN"))}</div></div></div><div class="grid"><div><div class="label">Supplier</div><strong>${escapeHtml(order.supplierName)}</strong><div class="muted">${escapeHtml(order.supplier?.mobile ?? "")}</div><div class="muted">${escapeHtml(order.supplier?.address ?? "")}</div>${order.vendorReference ? `<div style="margin-top:8px"><span class="label">Vendor reference</span> ${escapeHtml(order.vendorReference)}</div>` : ""}</div><div><div class="label">Deliver to</div><strong>${escapeHtml(order.location.name)} (${escapeHtml(order.location.code)})</strong><div class="muted">${escapeHtml(order.deliveryAddress ?? "")}</div><div style="margin-top:8px"><span class="label">Expected delivery</span> ${escapeHtml(order.expectedOn ? new Date(order.expectedOn).toLocaleDateString("en-IN") : "Not specified")}</div></div></div><table><thead><tr><th>#</th><th>Product</th><th>Quantity</th><th>Expected rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total&nbsp;&nbsp;${escapeHtml(inr(order.expectedTotal))}</div><div class="terms"><strong>Payment terms:</strong> ${escapeHtml(order.paymentTerms || "As agreed with supplier")}<br><br><strong>Terms & instructions:</strong><br>${escapeHtml(order.termsAndConditions || order.note || "Supply goods in saleable condition and quote this purchase-order number on the invoice.")}</div><div class="footer"><span>Generated by Veyra • ${escapeHtml(new Date().toLocaleString("en-IN"))}</span><span class="signature">Authorised signature</span></div><script>window.onload=()=>{window.print()}<\/script></body></html>`);
  popup.document.close();
  return true;
}

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
  const [vendorReference, setVendorReference] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Due on receipt");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [termsAndConditions, setTermsAndConditions] = useState("Supply goods in saleable condition and quote this PO number on the invoice.");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [productToAdd, setProductToAdd] = useState("");
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [viewOrder, setViewOrder] = useState<PurchaseOrder | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReceiptId, setReturnReceiptId] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnMode, setReturnMode] = useState("supplier_credit");
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
    setVendorReference("");
    setPaymentTerms("Due on receipt");
    setDeliveryAddress("");
    setTermsAndConditions("Supply goods in saleable condition and quote this PO number on the invoice.");
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
      const created = await createPurchaseOrder({ supplierId: supplier.id, supplierName: supplier.name, expectedOn: expectedOn || undefined, vendorReference: vendorReference || undefined, paymentTerms: paymentTerms || undefined, deliveryAddress: deliveryAddress || undefined, termsAndConditions: termsAndConditions || undefined, items: items.map((line) => ({ productId: line.productId, orderedBaseQty: Number(line.qty), expectedRate: Number(line.rate) })) });
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
    const lines = order.items.filter((item) => item.receivedBaseQty < item.orderedBaseQty).map((item) => ({ purchaseOrderItemId: item.id, productName: item.productName, baseUnit: item.baseUnit, qty: String(Number((item.orderedBaseQty - item.receivedBaseQty).toFixed(2))), rate: String(item.expectedRate), remaining: Number((item.orderedBaseQty - item.receivedBaseQty).toFixed(2)), basePerRateUnit: item.expectedRate > 0 && item.expectedAmount > 0 ? item.orderedBaseQty / (item.expectedAmount / item.expectedRate) : 1, batchTrackingEnabled: Boolean(item.product?.batchTrackingEnabled), batchNumber: "", manufacturedOn: "", expiresOn: "" }));
    const total = lines.reduce((sum, line) => sum + (Number(line.qty) / line.basePerRateUnit) * Number(line.rate), 0);
    setReceiptLines(lines); setSupplierInvoice(""); setPaidAmount(String(Number(total.toFixed(2)))); setPaymentMode("cash"); setReceiptKey(`po-receipt:${order.id}:${crypto.randomUUID()}`); setError(""); setReceiveOrder(order);
  };

  const receiptTotal = useMemo(() => receiptLines.reduce((sum, line) => sum + (Number(line.qty || 0) / line.basePerRateUnit) * Number(line.rate || 0), 0), [receiptLines]);

  const requestReceive = () => {
    if (!receiveOrder) return;
    const lines = receiptLines.filter((line) => Number(line.qty) > 0 && Number(line.rate) > 0);
    if (!lines.length || Number(paidAmount) > receiptTotal) { setError("Enter valid receipt quantities, rates and payment amount."); return; }
    if (lines.some((line) => line.batchTrackingEnabled && (!line.batchNumber.trim() || !line.expiresOn))) { setError("Batch number and expiry date are required for every batch-tracked product."); return; }
    setReceiveOrder(null);
    setApproval({
      title: `Receive ${receiveOrder.orderNumber}`,
      description: `Add ${lines.length} line${lines.length === 1 ? "" : "s"} worth approximately ${inr(receiptTotal)} to branch stock.`,
      confirmLabel: "Receive stock",
      run: async (pin) => {
        const result = await receivePurchaseOrder(receiveOrder.id, { idempotencyKey: receiptKey, supplierInvoiceNumber: supplierInvoice || undefined, paidAmount: Number(paidAmount || 0), paymentMode: Number(paidAmount || 0) > 0 ? paymentMode : undefined, items: lines.map((line) => ({ purchaseOrderItemId: line.purchaseOrderItemId, quantityBaseQty: Number(line.qty), actualRate: Number(line.rate), ...(line.batchTrackingEnabled ? { batchNumber: line.batchNumber.trim(), manufacturedOn: line.manufacturedOn || undefined, expiresOn: line.expiresOn } : {}) })) }, pin);
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

  const shareOrder = async (order: PurchaseOrder) => {
    const text = purchaseOrderText(order);
    try {
      if (navigator.share) await navigator.share({ title: order.orderNumber, text });
      else {
        await navigator.clipboard.writeText(text);
        toast({ title: "Purchase order copied", description: "Paste it into WhatsApp, email, or your supplier chat." });
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      toast({ title: "Could not share order", description: cause instanceof Error ? cause.message : "Try printing the order instead.", variant: "destructive" });
    }
  };

  const confirmApproval = async (pin: string) => {
    if (!approval) return;
    setBusy(true); setError("");
    try { await approval.run(pin); setApproval(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); }
    finally { setBusy(false); }
  };

  const openOrders = (ordersQ.data ?? []).filter((order) => !["received", "cancelled"].includes(order.status));
  const receiptOptions = useMemo(() => (ordersQ.data ?? []).flatMap((order) => order.receipts.map((receipt) => ({ order, receipt }))), [ordersQ.data]);
  const selectedReturn = receiptOptions.find(({ receipt }) => receipt.id === returnReceiptId);

  const reviewPurchaseReturn = () => {
    if (!selectedReturn) { setError("Choose a received supplier shipment."); return; }
    const items = selectedReturn.receipt.items.map((item) => ({ purchaseReceiptItemId: item.id, quantityBaseQty: Number(returnQuantities[item.id] || 0) })).filter((item) => item.quantityBaseQty > 0);
    if (!items.length || returnReason.trim().length < 3) { setError("Enter a return quantity and a clear reason."); return; }
    setReturnOpen(false);
    const idempotencyKey = crypto.randomUUID();
    setApproval({ title: `Return stock from ${selectedReturn.receipt.receiptNumber}`, description: `${items.length} receipt line${items.length === 1 ? "" : "s"} will leave branch stock and create a supplier credit/refund trail.`, confirmLabel: "Create supplier return", run: async (pin) => { const result = await createPurchaseReturn({ purchaseReceiptId: selectedReturn.receipt.id, refundMode: returnMode, reason: returnReason.trim(), idempotencyKey, items }, pin); await refresh(); setReturnReceiptId(""); setReturnQuantities({}); setReturnReason(""); toast({ title: result.idempotentReplay ? `${result.returnNumber} already recorded` : `${result.returnNumber} created`, description: result.idempotentReplay ? "The safe retry returned the original supplier return without changing stock twice." : `${inr(result.totalAmount)} removed from inventory with supplier settlement recorded.` }); } });
  };

  return (
    <section className="overflow-hidden rounded-[14px] border border-[#dfe7f3] bg-white shadow-[0_10px_30px_rgba(15,35,80,0.05)]">
      <div className="flex flex-col gap-3 border-b border-[#edf1f7] bg-[linear-gradient(135deg,#f8fbff,#fff)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eaf2ff] text-[#075fff]"><ClipboardCheck size={17} /></span><div><h3 className="font-display text-[15px] font-black text-[#102347]">Purchase orders</h3><p className="text-[11px] text-[#64748b]">Plan, approve and receive supplier stock without losing the audit trail</p></div></div></div>
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700"><Sparkles size={11} className="mr-1 inline" />{suggestionsQ.data?.length ?? 0} reorder suggestions</span><Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!receiptOptions.length} onClick={() => { setError(""); setReturnOpen(true); }}><RotateCcw size={13} /> Supplier return</Button><Button size="sm" className="h-9 gap-1.5" onClick={openCreate}><Plus size={13} /> New order</Button></div>
      </div>
      {ordersQ.isLoading ? <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#64748b]"><Loader2 size={15} className="animate-spin" /> Loading purchase orders…</div> : openOrders.length === 0 ? <div className="grid place-items-center px-5 py-8 text-center"><PackageCheck className="text-[#8ba8d8]" /><p className="mt-2 text-sm font-bold text-[#102347]">No open purchase orders</p><p className="mt-1 text-xs text-[#64748b]">Use reorder suggestions or add products manually to create one.</p></div> : <div className="grid gap-3 p-4 xl:grid-cols-2">{openOrders.slice(0, 6).map((order) => { const received = order.items.reduce((sum, item) => sum + item.receivedBaseQty, 0); const ordered = order.items.reduce((sum, item) => sum + item.orderedBaseQty, 0); const progress = ordered > 0 ? Math.round((received / ordered) * 100) : 0; const tone = STATUS[order.status] ?? STATUS.draft; return <article key={order.id} className="rounded-xl border border-[#e4eaf3] p-3.5"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black text-[#102347]">{order.orderNumber}</p><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", tone.cls)}>{tone.label}</span></div><p className="mt-1 text-xs font-semibold text-[#52627e]">{order.supplierName} · {order.location?.name}</p></div><p className="font-black text-[#102347]">{inr(order.expectedTotal)}</p></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]"><div className="h-full rounded-full bg-[#075fff] transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-2 flex items-center justify-between text-[10.5px] text-[#71809b]"><span>{order.items.length} products</span><span>{progress}% received</span></div><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setViewOrder(order)}><FileText size={12} /> View PO</Button><Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => printPurchaseOrder(order)}><Printer size={12} /> Print</Button>{order.status === "draft" && <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => requestSend(order)}><Send size={12} /> Mark sent</Button>}{["sent", "partially_received"].includes(order.status) && <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => openReceive(order)}><Truck size={12} /> Receive</Button>}<Button variant="outline" size="sm" className="h-8 gap-1 text-xs text-rose-600" onClick={() => requestCancel(order)}><X size={12} /> Cancel</Button></div></article>; })}</div>}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Create purchase order</DialogTitle><DialogDescription>Low-stock suggestions are prefilled. Add supplier references and delivery terms to create a document ready to send.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><Label>Supplier</Label><Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose supplier" /></SelectTrigger><SelectContent>{(suppliersQ.data ?? []).map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Expected delivery</Label><Input className="mt-1" type="date" value={expectedOn} onChange={(event) => setExpectedOn(event.target.value)} /></div><div><Label>Vendor reference</Label><Input className="mt-1" value={vendorReference} placeholder="Quotation / account reference" onChange={(event) => setVendorReference(event.target.value)} /></div><div><Label>Payment terms</Label><Input className="mt-1" value={paymentTerms} placeholder="e.g. Net 15 days" onChange={(event) => setPaymentTerms(event.target.value)} /></div></div><div><Label>Delivery address / instructions</Label><Input className="mt-1" value={deliveryAddress} placeholder="Defaults to the selected branch address" onChange={(event) => setDeliveryAddress(event.target.value)} /></div><div><Label>Terms and conditions</Label><Textarea className="mt-1 min-h-16" value={termsAndConditions} onChange={(event) => setTermsAndConditions(event.target.value)} /></div><div className="flex gap-2"><Select value={productToAdd} onValueChange={setProductToAdd}><SelectTrigger><SelectValue placeholder="Add another product" /></SelectTrigger><SelectContent>{(productsQ.data ?? []).filter((product) => !draftLines.some((line) => line.productId === product.id)).map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" onClick={addProduct} disabled={!productToAdd}>Add</Button></div><div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">{draftLines.map((line, index) => <div key={line.productId} className="grid grid-cols-[1fr_100px_110px_34px] items-end gap-2 rounded-xl border border-[#e5ebf4] p-3"><div><p className="text-sm font-bold text-[#102347]">{line.productName}</p><p className="text-[10px] text-[#8290a8]">Base unit: {line.baseUnit}</p></div><div><Label className="text-[10px]">Quantity</Label><Input className="h-9" type="number" min="0.01" value={line.qty} onChange={(event) => setDraftLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row))} /></div><div><Label className="text-[10px]">Expected rate</Label><Input className="h-9" type="number" min="0.01" value={line.rate} onChange={(event) => setDraftLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} /></div><Button variant="ghost" size="icon" className="h-9 w-9 text-rose-500" onClick={() => setDraftLines((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><X size={14} /></Button></div>)}</div>{error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={busy} onClick={saveDraft}>{busy && <Loader2 size={14} className="animate-spin" />} Save draft</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(receiveOrder)} onOpenChange={(open) => { if (!open) setReceiveOrder(null); }}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Receive {receiveOrder?.orderNumber}</DialogTitle><DialogDescription>Enter delivered quantities. Batch-tracked products require the supplier batch and expiry printed on the pack.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-3"><div><Label>Supplier invoice</Label><Input className="mt-1" value={supplierInvoice} onChange={(event) => setSupplierInvoice(event.target.value)} /></div><div><Label>Paid now</Label><Input className="mt-1" type="number" min="0" max={receiptTotal} value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} /></div><div><Label>Payment mode</Label><Select value={paymentMode} onValueChange={setPaymentMode}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="bank">Bank</SelectItem></SelectContent></Select></div></div><div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">{receiptLines.map((line, index) => <div key={line.purchaseOrderItemId} className="rounded-xl border border-[#e5ebf4] p-3"><div className="grid items-end gap-2 sm:grid-cols-[1fr_110px_110px]"><div><p className="text-sm font-bold text-[#102347]">{line.productName}</p><p className="text-[10px] text-[#8290a8]">Remaining {line.remaining} {line.baseUnit}{line.batchTrackingEnabled ? " · Batch tracking on" : ""}</p></div><div><Label className="text-[10px]">Received</Label><Input className="h-9" type="number" min="0" max={line.remaining} value={line.qty} onChange={(event) => setReceiptLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row))} /></div><div><Label className="text-[10px]">Actual rate</Label><Input className="h-9" type="number" min="0.01" value={line.rate} onChange={(event) => setReceiptLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} /></div></div>{line.batchTrackingEnabled && <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-3"><div><Label className="text-[10px]">Batch number *</Label><Input className="h-9" value={line.batchNumber} onChange={(event) => setReceiptLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, batchNumber: event.target.value } : row))} /></div><div><Label className="text-[10px]">Manufactured on</Label><Input className="h-9" type="date" value={line.manufacturedOn} onChange={(event) => setReceiptLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, manufacturedOn: event.target.value } : row))} /></div><div><Label className="text-[10px]">Expires on *</Label><Input className="h-9" type="date" value={line.expiresOn} onChange={(event) => setReceiptLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, expiresOn: event.target.value } : row))} /></div></div>}</div>)}</div><div className="flex items-center justify-between rounded-xl bg-[#f5f8fd] px-4 py-3"><span className="text-xs font-bold text-[#52627e]">Receipt estimate</span><span className="font-display text-lg font-black text-[#102347]">{inr(receiptTotal)}</span></div>{error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setReceiveOrder(null)}>Cancel</Button><Button onClick={requestReceive}>Review receipt <ArrowRight size={14} /></Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(viewOrder)} onOpenChange={(open) => { if (!open) setViewOrder(null); }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{viewOrder?.orderNumber}</DialogTitle><DialogDescription>A supplier-ready purchase order with branch delivery details and a complete receiving trail.</DialogDescription></DialogHeader>
          {viewOrder && <div className="space-y-4"><div className="grid gap-3 rounded-2xl bg-[#f5f8fd] p-4 sm:grid-cols-3"><div><p className="text-[10px] font-bold uppercase text-[#71809b]">Supplier</p><p className="mt-1 font-bold text-[#102347]">{viewOrder.supplierName}</p>{viewOrder.supplier?.mobile && <p className="text-xs text-[#64748b]">{viewOrder.supplier.mobile}</p>}</div><div><p className="text-[10px] font-bold uppercase text-[#71809b]">Deliver to</p><p className="mt-1 font-bold text-[#102347]">{viewOrder.location.name}</p><p className="text-xs text-[#64748b]">{viewOrder.deliveryAddress || "Branch address"}</p></div><div><p className="text-[10px] font-bold uppercase text-[#71809b]">Expected total</p><p className="mt-1 text-lg font-black text-[#102347]">{inr(viewOrder.expectedTotal)}</p><p className="text-xs text-[#64748b]">{viewOrder.paymentTerms || "Terms not specified"}</p></div></div><div className="overflow-hidden rounded-xl border"><table className="w-full text-left text-xs"><thead className="bg-[#f5f8fd] text-[10px] uppercase text-[#64748b]"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead><tbody className="divide-y">{viewOrder.items.map((item) => <tr key={item.id}><td className="px-3 py-2 font-bold text-[#102347]">{item.productName}</td><td className="px-3 py-2 text-right">{item.orderedBaseQty} {item.baseUnit}</td><td className="px-3 py-2 text-right">{item.receivedBaseQty}</td><td className="px-3 py-2 text-right">{inr(item.expectedRate)}</td><td className="px-3 py-2 text-right font-bold">{inr(item.expectedAmount)}</td></tr>)}</tbody></table></div>{(viewOrder.vendorReference || viewOrder.termsAndConditions || viewOrder.note) && <div className="rounded-xl border p-3 text-xs text-[#52627e]">{viewOrder.vendorReference && <p><strong>Vendor reference:</strong> {viewOrder.vendorReference}</p>}<p className="mt-1 whitespace-pre-wrap"><strong>Terms:</strong> {viewOrder.termsAndConditions || viewOrder.note}</p></div>}<DialogFooter><Button variant="outline" onClick={() => printPurchaseOrder(viewOrder)}><Printer size={14} /> Print / PDF</Button><Button onClick={() => void shareOrder(viewOrder)}><Share2 size={14} /> Share order</Button></DialogFooter></div>}
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Return stock to supplier</DialogTitle><DialogDescription>Choose the goods-received note and quantity. Veyra removes branch and batch stock, reduces supplier dues first, then records any refund due.</DialogDescription></DialogHeader><div><Label>Received shipment</Label><Select value={returnReceiptId} onValueChange={(value) => { setReturnReceiptId(value); setReturnQuantities({}); }}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose GRN / supplier invoice" /></SelectTrigger><SelectContent>{receiptOptions.map(({ order, receipt }) => <SelectItem key={receipt.id} value={receipt.id}>{receipt.receiptNumber} · {order.supplierName} · {new Date(receipt.createdAt).toLocaleDateString("en-IN")}</SelectItem>)}</SelectContent></Select></div>{selectedReturn && <div className="space-y-2">{selectedReturn.receipt.items.map((item) => { const poLine = selectedReturn.order.items.find((line) => line.id === item.purchaseOrderItemId); return <div key={item.id} className="grid grid-cols-[1fr_120px] items-end gap-3 rounded-xl border p-3"><div><p className="text-sm font-bold text-[#102347]">{poLine?.productName || "Received product"}</p><p className="text-xs text-[#64748b]">Received {item.quantityBaseQty} {poLine?.baseUnit || "units"} · {inr(item.actualRate)} rate</p></div><div><Label className="text-[10px]">Return quantity</Label><Input className="h-9" type="number" min="0" max={item.quantityBaseQty} value={returnQuantities[item.id] || ""} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></div></div>; })}</div>}<div className="grid gap-3 sm:grid-cols-2"><div><Label>Settlement</Label><Select value={returnMode} onValueChange={setReturnMode}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="supplier_credit">Reduce supplier due / credit</SelectItem><SelectItem value="bank">Bank refund</SelectItem><SelectItem value="cash">Cash refund</SelectItem></SelectContent></Select></div><div><Label>Reason</Label><Input className="mt-1" value={returnReason} placeholder="Damaged, wrong item, excess supply…" onChange={(event) => setReturnReason(event.target.value)} /></div></div>{error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button><Button onClick={reviewPurchaseReturn} disabled={!selectedReturn}>Review supplier return</Button></DialogFooter></DialogContent></Dialog>

      <OwnerPinModal open={Boolean(approval)} title={approval?.title ?? "Approve purchase order"} description={approval?.description} confirmLabel={approval?.confirmLabel} loading={busy} error={error} onCancel={() => { if (!busy) setApproval(null); }} onConfirm={({ ownerPin }) => confirmApproval(ownerPin)} />
    </section>
  );
}
