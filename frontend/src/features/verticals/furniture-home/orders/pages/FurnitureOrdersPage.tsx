import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Ban, CalendarClock, CheckCircle2, Hammer, IndianRupee,
  Loader2, NotebookPen, Plus, Search, Sofa, Trash2, Truck, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useOfflineStatus } from "@/features/core/sync";
import {
  addFurnitureOrderPayment, cancelFurnitureOrder, createFurnitureOrder, deleteFurnitureOrder,
  getFurnitureOrderSummary, listFurnitureOrders, setFurnitureOrderStatus, updateFurnitureOrder,
} from "@/features/verticals/furniture-home/orders/api";
import { OrderPanel } from "@/features/verticals/furniture-home/orders/components/OrderPanel";
import type { FurnitureOrder, FurnitureOrderInput, FurnitureOrderStatus } from "@/types/api";

function inr(n: number) {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDay(key?: string | null) {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

const STATUS_CHIP: Record<FurnitureOrderStatus, { tone: keyof typeof CHIP_TONES }> = {
  quote: { tone: "gray" },
  confirmed: { tone: "blue" },
  in_production: { tone: "violet" },
  ready: { tone: "amber" },
  delivered: { tone: "green" },
  installed: { tone: "green" },
  cancelled: { tone: "gray" },
};

const NEXT_LABEL: Record<FurnitureOrderStatus, string> = {
  quote: "Quote",
  confirmed: "Confirm",
  in_production: "Start making",
  ready: "Mark ready",
  delivered: "Delivered",
  installed: "Installed",
  cancelled: "Cancel",
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "open", label: "Open" },
  { key: "quote", label: "Quotes" },
  { key: "in_production", label: "Being made" },
  { key: "ready", label: "Ready" },
  { key: "delivered", label: "Delivered" },
  { key: "all", label: "Everything" },
];

export default function FurnitureOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineStatus();

  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<FurnitureOrder | null>(null);
  const [paying, setPaying] = useState<FurnitureOrder | null>(null);
  const [deleting, setDeleting] = useState<FurnitureOrder | null>(null);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:furniture-order-panel-width", { defaultWidth: 540 });

  const ordersQ = useQuery({ queryKey: ["furniture-orders"], queryFn: () => listFurnitureOrders() });
  const summaryQ = useQuery({ queryKey: ["furniture-orders", "summary"], queryFn: getFurnitureOrderSummary });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["furniture-orders"] });
    // A confirmed order holds floor stock, so what is actually for sale changes.
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  function failure(title: string) {
    return (err: unknown) => {
      if (!isOnline) {
        return toast({
          title: "You're offline",
          description: "The order book needs a connection so two desks cannot promise the same piece or double-count an advance. Reconnect and try again.",
          variant: "destructive",
        });
      }
      toast({ title, description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    };
  }

  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; data: FurnitureOrderInput }) =>
      (vars.id ? updateFurnitureOrder(vars.id, vars.data) : createFurnitureOrder(vars.data)),
    onSuccess: (order) => {
      invalidate();
      setPanelOpen(false);
      setEditing(null);
      toast({ title: editing ? `${order.orderNumber} updated` : `${order.orderNumber} created`, description: inr(order.grandTotal) });
    },
    onError: failure("Could not save the order"),
  });

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: FurnitureOrderStatus }) => setFurnitureOrderStatus(vars.id, vars.status),
    onSuccess: (order) => {
      invalidate();
      toast({
        title: `${order.orderNumber} — ${order.statusLabel.toLowerCase()}`,
        description: order.balanceDue > 0 ? `${inr(order.balanceDue)} still to collect.` : undefined,
      });
    },
    onError: failure("Could not move the order along"),
  });

  const payMut = useMutation({
    mutationFn: (vars: { id: string; amount: number; mode: string }) => addFurnitureOrderPayment(vars.id, vars),
    onSuccess: (order) => {
      invalidate();
      setPaying(null);
      toast({ title: order.isPaidUp ? "Paid in full" : `${inr(order.balanceDue)} still to collect` });
    },
    onError: failure("Could not record the payment"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFurnitureOrder(id),
    onSuccess: () => { invalidate(); toast({ title: "Order cancelled" }); },
    onError: failure("Could not cancel"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFurnitureOrder(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Order moved to recycle bin" }); },
    onError: failure("Could not delete"),
  });

  const orders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (ordersQ.data ?? [])
      .filter((order) => {
        if (filter === "all") return true;
        if (filter === "open") return order.isOpen;
        return order.status === filter;
      })
      .filter((order) => (!overdueOnly || order.isOverdue))
      .filter((order) => {
        if (!term) return true;
        return [order.customerName, order.customerPhone, order.orderNumber, order.billNumber ?? "",
          ...order.items.map((item) => item.name)].join(" ").toLowerCase().includes(term);
      });
  }, [ordersQ.data, filter, search, overdueOnly]);

  const summary = summaryQ.data;

  return (
    <div
      className={cn("app-docked-page", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={panelOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      <div className="space-y-4">
        {!isOnline && (
          <div role="status" className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-900">
            Showing the order book last saved on this device. Writing an order or an advance needs a connection, so two desks can never promise the same piece.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<NotebookPen size={16} />} label="Open orders" value={String(summary?.openOrders ?? 0)} tone="blue" />
          <Kpi
            icon={<AlertTriangle size={16} />}
            label="Past the promised date"
            value={String(summary?.overdue ?? 0)}
            tone={summary?.overdue ? "rose" : "green"}
          />
          <Kpi icon={<Wallet size={16} />} label="Advances held" value={inr(summary?.advancesHeld ?? 0)} tone="violet" />
          <Kpi icon={<IndianRupee size={16} />} label="Still to collect" value={inr(summary?.pendingCollection ?? 0)} tone="green" />
        </div>

        {summary && summary.orderBookValue > 0 && (
          <div className="rounded-[12px] border border-[#e6ecf4] bg-white px-4 py-3 text-[12px] text-[#52627e] shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <span className="font-bold text-[var(--brand-ink)]">{inr(summary.orderBookValue)}</span> of work promised and not yet delivered
            {summary.readyToDeliver > 0 && <> · <span className="font-bold text-amber-700">{summary.readyToDeliver} ready to go out</span></>}
            {summary.inProduction > 0 && <> · {summary.inProduction} being made</>}
            {summary.reservedProducts > 0 && <> · {summary.reservedProducts} product{summary.reservedProducts === 1 ? "" : "s"} held off the floor</>}
          </div>
        )}

        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f8] px-5 py-3.5">
            <div>
              <h3 className="font-display text-[14px] font-black tracking-tight text-[var(--brand-ink)]">Order book</h3>
              <p className="mt-0.5 text-[11.5px] text-[#64748b]">Quote, advance, make, deliver, install — and what is still owed at every step.</p>
            </div>
            <Button
              onClick={() => { setEditing(null); setPanelOpen(true); }}
              style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
              className="h-11 lg:mouse:h-9 gap-2 rounded-[9px] font-bold text-white hover:opacity-95"
            >
              <Plus size={15} /> New Order
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f8] px-5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "inline-flex h-11 items-center rounded-[8px] px-3 text-[11.5px] font-bold transition-colors lg:mouse:h-auto lg:mouse:px-2.5 lg:mouse:py-1.5",
                    filter === f.key ? "bg-[var(--brand)] text-white" : "bg-[#f1f5fa] text-[#52627e] hover:bg-[#e6ecf4]",
                  )}
                >
                  {f.label}
                </button>
              ))}
              <button
                onClick={() => setOverdueOnly((value) => !value)}
                className={cn(
                  "inline-flex h-11 items-center rounded-[8px] px-3 text-[11.5px] font-bold transition-colors lg:mouse:h-auto lg:mouse:px-2.5 lg:mouse:py-1.5",
                  overdueOnly ? "bg-rose-600 text-white" : "bg-[#f1f5fa] text-[#52627e] hover:bg-[#e6ecf4]",
                )}
              >
                Late only
              </button>
            </div>
            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <Input className="h-11 lg:mouse:h-9 pl-8" placeholder="Customer, order no., item" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {ordersQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : ordersQ.isError ? (
            <div className="py-12 text-center text-[13px] text-rose-600">Couldn't load the order book. Check your connection.</div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Sofa size={22} /></span>
              <p className="text-[13px] font-bold text-[var(--brand-ink)]">
                {(ordersQ.data ?? []).length === 0 ? "No orders yet" : "Nothing matches this filter"}
              </p>
              <p className="max-w-[440px] text-[12px] text-[#64748b]">
                {(ordersQ.data ?? []).length === 0
                  ? "Write a quotation, take an advance against it, and the app keeps track of what was promised, what has been paid and when it is due — right through to installation."
                  : "Try another status, or turn off \"Late only\"."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#eef2f8]">
              {orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  busy={statusMut.isPending}
                  onAdvance={(status) => statusMut.mutate({ id: order.id, status })}
                  onPay={() => setPaying(order)}
                  onEdit={() => { setEditing(order); setPanelOpen(true); }}
                  onCancel={() => cancelMut.mutate(order.id)}
                  onDelete={() => setDeleting(order)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <OrderPanel
        open={panelOpen}
        editing={editing}
        saving={saveMut.isPending}
        width={panelWidth}
        onResizeStart={onResizeStart}
        onClose={() => { setPanelOpen(false); setEditing(null); }}
        onSubmit={(data) => saveMut.mutate({ id: editing?.id, data })}
      />

      <PaymentDialog
        order={paying}
        saving={payMut.isPending}
        onClose={() => setPaying(null)}
        onConfirm={(amount, mode) => paying && payMut.mutate({ id: paying.id, amount, mode })}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Delete this order?</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[#52627e]">
            {deleting?.orderNumber} for {deleting?.customerName} will move to the recycle bin.
            {deleting && deleting.paidTotal > 0
              ? ` ${inr(deleting.paidTotal)} has been paid against it — cancel it instead if the customer is owed that back.`
              : ""}
          </p>
          <div className="flex gap-2.5 pt-2">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={deleteMut.isPending} onClick={() => deleting && deleteMut.mutate(deleting.id)}>
              {deleteMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderRow({ order, busy, onAdvance, onPay, onEdit, onCancel, onDelete }: {
  order: FurnitureOrder;
  busy: boolean;
  onAdvance: (status: FurnitureOrderStatus) => void;
  onPay: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const chip = STATUS_CHIP[order.status] ?? STATUS_CHIP.quote;
  // "cancelled" is offered as its own button, so it is kept out of the forward move.
  const forward = order.nextStatuses.filter((status) => status !== "cancelled");

  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((value) => !value)}>
          <p className="font-bold text-[var(--brand-ink)]">
            {order.customerName}
            {order.isCustom && <span className="ml-1.5 text-[11px] font-semibold text-violet-600">made to order</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#8492ac]">
            <span className="rounded-[5px] bg-[#f1f5fa] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#52627e]">{order.orderNumber}</span>
            <span>{order.items.length} item{order.items.length === 1 ? "" : "s"}</span>
            {order.promisedOnKey && (
              <span className="flex items-center gap-1"><CalendarClock size={11} /> {fmtDay(order.promisedOnKey)}</span>
            )}
          </p>
        </button>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES[chip.tone])}>{order.statusLabel}</span>
          {order.isOverdue && (
            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.red)}>
              {Math.abs(order.daysToPromised ?? 0)} day{Math.abs(order.daysToPromised ?? 0) === 1 ? "" : "s"} late
            </span>
          )}
          {!order.isOverdue && order.isDueSoon && (
            <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", CHIP_TONES.amber)}>Due now</span>
          )}
          <div className="text-right">
            <p className="text-[13px] font-black text-[var(--brand-ink)]">{inr(order.grandTotal)}</p>
            <p className={cn("text-[11px] font-semibold", order.isPaidUp ? "text-emerald-700" : "text-[#8492ac]")}>
              {order.isPaidUp ? "paid up" : `${inr(order.balanceDue)} due`}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 lg:mouse:gap-1.5">
        {forward.map((status) => (
          <Button
            key={status}
            variant="outline"
            className="h-11 lg:mouse:h-8 gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-bold"
            disabled={busy}
            onClick={() => onAdvance(status)}
          >
            {status === "delivered" ? <Truck size={13} /> : status === "in_production" ? <Hammer size={13} /> : status === "installed" ? <CheckCircle2 size={13} /> : <ArrowRight size={13} />}
            {NEXT_LABEL[status]}
          </Button>
        ))}
        {order.status !== "cancelled" && (
          <Button
            variant="outline"
            className="h-11 lg:mouse:h-8 gap-1.5 rounded-[8px] border-emerald-200 px-2.5 text-[11.5px] font-bold text-emerald-700 hover:bg-emerald-50"
            onClick={onPay}
          >
            <Wallet size={13} /> Take payment
          </Button>
        )}
        {order.isOpen && (
          <button onClick={onEdit} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Edit ${order.orderNumber}`}><NotebookPen size={14} /></button>
        )}
        {order.canCancel && (
          <button onClick={onCancel} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Cancel ${order.orderNumber}`}><Ban size={14} /></button>
        )}
        <button onClick={onDelete} className="grid h-11 w-11 place-items-center lg:mouse:h-8 lg:mouse:w-8 rounded-[8px] text-rose-500 hover:bg-rose-50" aria-label={`Delete ${order.orderNumber}`}><Trash2 size={14} /></button>
      </div>

      {open && (
        <div className="mt-2.5 space-y-2 rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5">
          <ul className="space-y-1">
            {order.items.map((item, index) => (
              <li key={item.id ?? index} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-[#344668]">
                  <span className="font-semibold">{item.qty}</span> × {item.name}
                  {item.variant && <span className="text-[#8492ac]"> · {item.variant}</span>}
                  {item.reserveStock && <span className="ml-1 text-[10.5px] text-violet-600">held</span>}
                </span>
                <span className="font-semibold text-[var(--brand-ink)]">{inr(item.amount)}</span>
              </li>
            ))}
          </ul>

          {(order.discount > 0 || order.deliveryCharge > 0 || order.installCharge > 0) && (
            <p className="border-t border-[#e2e8f0] pt-2 text-[11px] text-[#64748b]">
              {order.discount > 0 && <>Discount {inr(order.discount)} · </>}
              {order.deliveryCharge > 0 && <>Delivery {inr(order.deliveryCharge)} · </>}
              {order.installCharge > 0 && <>Installation {inr(order.installCharge)}</>}
            </p>
          )}

          {order.payments.length > 0 && (
            <div className="border-t border-[#e2e8f0] pt-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8492ac]">Paid so far</p>
              <ul className="mt-1 space-y-0.5">
                {order.payments.map((payment) => (
                  <li key={payment.id} className="flex items-baseline justify-between text-[11.5px] text-[#52627e]">
                    <span>{fmtDay(payment.paidOn.slice(0, 10))} · {payment.mode}{payment.reference ? ` · ${payment.reference}` : ""}</span>
                    <span className="font-semibold">{inr(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {order.isOverpaid && (
            <p className="rounded-[8px] bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
              More has been taken than this order is worth — {inr(order.paidTotal - order.grandTotal)} is owed back.
            </p>
          )}

          {order.deliveryAddress && <p className="text-[11px] text-[#8492ac]">Deliver to: {order.deliveryAddress}</p>}
          {order.notes && <p className="whitespace-pre-line text-[11px] text-[#8492ac]">{order.notes}</p>}
        </div>
      )}
    </div>
  );
}

function PaymentDialog({ order, saving, onClose, onConfirm }: {
  order: FurnitureOrder | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: (amount: number, mode: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("cash");

  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => { if (!open) { setAmount(""); setMode("cash"); onClose(); } }}
    >
      <DialogContent className="max-w-[400px]">
        <DialogHeader><DialogTitle className="font-display text-[16px] font-black text-[var(--brand-ink)]">Take a payment</DialogTitle></DialogHeader>
        {order && (
          <div className="space-y-3">
            <div className="rounded-[10px] bg-[#f7f9fd] px-3.5 py-2.5 text-[12px] text-[#52627e]">
              <p className="font-bold text-[var(--brand-ink)]">{order.customerName} · {order.orderNumber}</p>
              <p className="mt-0.5">{inr(order.grandTotal)} total · {inr(order.paidTotal)} paid · <span className="font-bold">{inr(order.balanceDue)} due</span></p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Amount (₹)</Label>
                <Input className="h-10" type="number" min="0" step="0.01" placeholder={String(order.balanceDue)} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">Mode</Label>
                <select
                  className="h-11 lg:mouse:h-10 w-full rounded-[8px] border border-[#e2e8f0] bg-white px-2.5 text-[13px] text-[#344668] outline-none focus:border-[var(--brand)]"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  {["cash", "upi", "bank", "card", "other"].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                </select>
              </div>
            </div>
            <button
              type="button"
              className="text-[11.5px] font-bold text-[var(--brand)] hover:underline"
              onClick={() => setAmount(String(order.balanceDue))}
            >
              Collect the whole balance ({inr(order.balanceDue)})
            </button>
            <p className="text-[11px] text-[#8492ac]">
              This records money taken against the order. The bill itself is rung when the goods go out.
            </p>
            <div className="flex gap-2.5 pt-1">
              <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
              <Button
                className="h-11 flex-1 gap-2 rounded-[10px] bg-emerald-600 font-black text-white hover:bg-emerald-700"
                disabled={saving || !(Number(amount) > 0)}
                onClick={() => onConfirm(Number(amount) || 0, mode)}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />} Record
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ icon, label, value, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "blue" | "violet" | "green" | "rose";
}) {
  const ring =
    tone === "blue" ? "bg-[var(--brand-soft)] text-[var(--brand)]"
      : tone === "violet" ? "bg-violet-50 text-violet-600"
        : tone === "rose" ? "bg-rose-50 text-rose-600"
          : "bg-emerald-50 text-emerald-600";
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${ring}`}>{icon}</span>
      </div>
      <p className="mt-1.5 truncate font-display text-[24px] font-black leading-none text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}
