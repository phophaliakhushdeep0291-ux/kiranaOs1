import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLocation } from "wouter";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Copy,
  Inbox,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  Printer,
  QrCode,
  RefreshCw,
  ShoppingCart,
  StickyNote,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/features/core/auth/useAuth";
import { useListProducts } from "@/lib/api/client";
import { offlineDB } from "@/lib/offline/db";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY, billingDraftFromHeldBill, heldBillFromBillingDraft, upsertOpenBill, billFromImportedCart, importedCartFingerprint } from "@/features/core/billing/pages/open-bills";
import type { BillingDraft, HeldBill } from "@/features/core/billing/pages/billing-types";
import { alertCustomerOnWhatsapp } from "../notify";
import { listCustomerOrders, updateCustomerOrder, type CustomerOrder } from "../api";
import { getActiveLocationId, LOCATION_CHANGED_EVENT } from "@/features/core/stores/location-context";

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: "new", label: "New" },
  { value: "accepted", label: "Accepted" },
  { value: "ready", label: "Ready" },
  { value: "fulfilled", label: "Done" },
  { value: "all", label: "All" },
];

const STATUS_STYLE: Record<CustomerOrder["status"], string> = {
  new: "bg-[#eaf2ff] text-[var(--brand)]",
  accepted: "bg-[#fff7ed] text-[#c2410c]",
  ready: "bg-[#f3efff] text-[#7c3aed]",
  fulfilled: "bg-[#e9fbf0] text-[#16a34a]",
  rejected: "bg-[#f1f5f9] text-[#64748b]",
  cancelled: "bg-[#fff1f2] text-[#be123c]",
};

const STATUS_LABEL: Record<CustomerOrder["status"], string> = {
  new: "Received",
  accepted: "Preparing",
  ready: "Ready",
  fulfilled: "Done",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const CHANNEL_LABEL: Record<CustomerOrder["sourceChannel"], string> = { pos: "POS", customer_portal: "QR order", api: "API", marketplace: "Marketplace" };
const PAYMENT_LABEL: Record<CustomerOrder["paymentStatus"], string> = { unpaid: "Unpaid", partially_paid: "Part paid", paid: "Paid", refunded: "Refunded" };
const PAYMENT_STYLE: Record<CustomerOrder["paymentStatus"], string> = {
  unpaid: "bg-amber-50 text-amber-700", partially_paid: "bg-orange-50 text-orange-700", paid: "bg-emerald-50 text-emerald-700", refunded: "bg-slate-100 text-slate-600",
};

const fmtRs = (n: number) => `Rs ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtMoney = (n: number) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Friendly display code for a cuid order id, e.g. ORD-9B2AK4. */
const orderCode = (id: string) => `ORD-${id.slice(-6).toUpperCase()}`;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function fullDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function isSameLocalDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

// Short two-note chime so a busy owner hears a new order arrive. Web Audio only — no asset to
// bundle — and fully best-effort (blocked autoplay / no AudioContext just no-ops).
function playNewOrderChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1174].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.14);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 600);
  } catch {
    /* audio unavailable — the toast is still the signal */
  }
}

export default function OrdersReceivedPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { shop } = useAuth();
  const shopName = shop?.name ?? "";
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("new");
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeLocationId, setActiveLocationId] = useState(() => getActiveLocationId());

  useEffect(() => {
    const handleLocationChange = () => {
      setActiveLocationId(getActiveLocationId());
      setSelectedId(null);
    };
    window.addEventListener(LOCATION_CHANGED_EVENT, handleLocationChange);
    return () => window.removeEventListener(LOCATION_CHANGED_EVENT, handleLocationChange);
  }, []);

  // Cursor-paginated so a busy shop's inbox no longer truncates silently at 200 orders.
  // Key is namespaced under "list" so it can't collide with the stats query below.
  const ordersQuery = useInfiniteQuery({
    queryKey: ["customer-orders", "list", activeLocationId, status],
    queryFn: ({ pageParam }) => listCustomerOrders(status, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
    refetchInterval: 20_000, // poll so new customer orders surface without a manual refresh
  });

  // Unfiltered list for the stats strip and for keeping the detail view live even when the
  // selected order moves out of the active tab (e.g. accepting it while on "New").
  const allOrdersQuery = useQuery({
    queryKey: ["customer-orders", "all", activeLocationId],
    queryFn: () => listCustomerOrders("all"),
    refetchInterval: 20_000,
  });

  // Chime + toast when the count of new orders climbs while the owner is watching. newCount is the
  // shop-wide "new" total (independent of the active tab), so it's a reliable arrival signal.
  const prevNewCountRef = useRef<number | null>(null);
  const newCount = ordersQuery.data?.pages[0]?.newCount ?? null;
  useEffect(() => {
    if (newCount == null) return;
    const prev = prevNewCountRef.current;
    if (prev != null && newCount > prev) {
      playNewOrderChime();
      const added = newCount - prev;
      toast({ title: `${added} new order${added === 1 ? "" : "s"} received`, description: "Open the New tab to review." });
    }
    prevNewCountRef.current = newCount;
  }, [newCount, toast]);

  const productsQuery = useListProducts({ limit: 500 }, { query: { staleTime: 60_000 } });
  const products = useMemo(() => (productsQuery.data ?? []).filter((p) => p.deletedAt == null), [productsQuery.data]);

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: CustomerOrder["status"] }) => updateCustomerOrder(id, { status: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
    },
    onError: (err: unknown) => toast({ title: "Could not update order", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  // Primary action: open the order in Billing so the owner can adjust items, rates,
  // discounts, and payment mode before making the final bill. WhatsApp is separate.
  function acceptAndBill(order: CustomerOrder) {
    if (openingOrderId) return;
    setOpeningOrderId(order.id);
    void loadIntoBilling(order)
      .catch((error: unknown) => {
        toast({
          title: "Could not open order",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      })
      .finally(() => setOpeningOrderId(null));
  }

  /** Standalone "let the customer know it's ready" — no state change, just opens WhatsApp. */
  function messageCustomer(order: CustomerOrder, kind: "received" | "ready") {
    const { targetedCustomer } = alertCustomerOnWhatsapp(order, shopName, kind);
    if (!targetedCustomer) {
      toast({ title: "Opened WhatsApp", description: "Pick the customer's chat to send the message." });
    }
  }

  async function loadIntoBilling(order: CustomerOrder) {
    const requestedItems = order.items.map((item) => ({
      productId: item.productId,
      qty: item.qty,
      variation: item.variation,
      addons: item.addons,
    }));
    const requestedFingerprint = importedCartFingerprint(requestedItems);
    let catalogProducts = products;
    if (catalogProducts.length === 0 && productsQuery.isFetching) {
      const refreshed = await productsQuery.refetch();
      catalogProducts = (refreshed.data ?? []).filter((p) => p.deletedAt == null);
    }
    if (catalogProducts.length === 0) {
      throw new Error("Product catalog is still loading. Please try again in a moment.");
    }

    const [currentHeldBills, activeDraft] = await Promise.all([
      offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
      offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY).catch(() => null),
    ]);
    const heldBills = currentHeldBills ?? [];
    const existingHeldOrder = heldBills.find((entry) => entry.sourceOrderId === order.id);
    const activeOrderAlreadyOpen = activeDraft?.sourceOrderId === order.id
      && activeDraft.sourceOrderFingerprint === requestedFingerprint
      && (activeDraft.cart?.length ?? 0) > 0;

    if (activeOrderAlreadyOpen) {
      if (order.status === "new") statusMutation.mutate({ id: order.id, next: "accepted" });
      toast({ title: "Order already open", description: "Taking you back to Billing." });
      navigate("/billing");
      return;
    }

    const activeAsHeld = heldBillFromBillingDraft(activeDraft);
    let nextHeldBills = heldBills.filter((entry) => entry.sourceOrderId !== order.id && entry.id !== activeAsHeld?.id);
    // A legacy/partial draft for this same order is replaced below. Preserve an
    // unrelated active bill, but do not park the broken order copy again.
    if (activeAsHeld && activeAsHeld.sourceOrderId !== order.id) nextHeldBills = upsertOpenBill(nextHeldBills, activeAsHeld);

    if (existingHeldOrder?.sourceOrderFingerprint === requestedFingerprint) {
      await Promise.all([
        offlineDB.setSetting(HELD_BILLS_KEY, nextHeldBills),
        offlineDB.setSetting(BILLING_DRAFT_KEY, billingDraftFromHeldBill(existingHeldOrder)),
      ]);
      if (order.status === "new") statusMutation.mutate({ id: order.id, next: "accepted" });
      toast({ title: "Order already in Billing", description: "Opened the existing bill instead of adding another copy." });
      navigate("/billing");
      return;
    }

    const importOrder = () => billFromImportedCart(
      catalogProducts,
      requestedItems,
      { label: `${order.customerName} (order)`, sourceOrderId: order.id },
    );
    let imported = importOrder();
    // A non-empty cache can still be partial (for example after a location or
    // device switch). If any requested product is missing, refresh the complete
    // catalog and rebuild before deciding that an item is unavailable.
    if (imported.skipped.length > 0) {
      const refreshed = await productsQuery.refetch();
      catalogProducts = (refreshed.data ?? catalogProducts).filter((product) => product.deletedAt == null);
      imported = importOrder();
    }
    const { bill, matched, skipped } = imported;
    if (matched === 0) {
      toast({ title: "No matching products", description: "These items are not in your catalog anymore.", variant: "destructive" });
      return;
    }
    const withCustomer: HeldBill = { ...bill, customerName: order.customerName, customerMobile: order.customerMobile };
    await Promise.all([
      offlineDB.setSetting(HELD_BILLS_KEY, nextHeldBills),
      offlineDB.setSetting(BILLING_DRAFT_KEY, billingDraftFromHeldBill(withCustomer)),
    ]);
    statusMutation.mutate({ id: order.id, next: "accepted" });
    toast({
      title: "Order sent to Billing",
      description: `${matched} item${matched === 1 ? "" : "s"} ready — adjust the amount and save the final bill${skipped.length ? ` · ${skipped.length} unavailable` : ""}.`,
    });
    navigate("/billing");
  }

  /** Compact printable order slip (not a bill — final price is set at billing). */
  function printOrderSlip(order: CustomerOrder) {
    const popup = window.open("", "_blank", "width=420,height=640");
    if (!popup) {
      toast({ title: "Print blocked", description: "Allow pop-ups to print the order slip.", variant: "destructive" });
      return;
    }
    const rows = order.items
      .map((it, i) => `<tr><td>${i + 1}</td><td>${it.qty}× ${it.name}</td><td style="text-align:right">${fmtMoney(it.qty * it.price)}</td></tr>`)
      .join("");
    popup.document.write(
      `<!doctype html><html><head><title>Order slip ${orderCode(order.id)}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;padding:20px;margin:0;color:#111">` +
        `<h2 style="margin:0 0 2px">${shopName || "Order slip"}</h2>` +
        `<p style="margin:0 0 12px;color:#555;font-size:12px">${orderCode(order.id)} · ${fullDateTime(order.createdAt)}</p>` +
        `<p style="margin:0 0 12px;font-size:13px"><b>${order.customerName}</b> · ${order.customerMobile}` +
        `${order.customerAddress ? `<br/>${order.customerAddress}` : ""}</p>` +
        `<table style="width:100%;border-collapse:collapse;font-size:13px">` +
        `<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>#</th><th>Item</th><th style="text-align:right">Rs</th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
        `<tfoot><tr style="border-top:1px solid #ccc;font-weight:bold"><td></td><td>Estimated total</td><td style="text-align:right">${fmtMoney(order.estimatedTotal)}</td></tr></tfoot>` +
        `</table>` +
        `${order.note ? `<p style="margin-top:12px;font-size:12px;font-style:italic">"${order.note}"</p>` : ""}` +
        `<p style="margin-top:14px;font-size:11px;color:#888">Final price is set at billing.</p>` +
        `<script>window.onload=function(){window.print()}</script></body></html>`,
    );
    popup.document.close();
  }

  async function copyOrderDetails(order: CustomerOrder) {
    const lines = [
      `${orderCode(order.id)} · ${shopName}`,
      `${order.customerName} · ${order.customerMobile}`,
      ...(order.customerAddress ? [order.customerAddress] : []),
      ...order.items.map((it) => `- ${it.qty}× ${it.name} @ ${fmtMoney(it.price)} = ${fmtMoney(it.qty * it.price)}`),
      `Estimated total: ${fmtRs(order.estimatedTotal)}`,
      ...(order.note ? [`Note: ${order.note}`] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "Order copied", description: "Details are on your clipboard." });
    } catch {
      toast({ title: "Could not copy", description: "Clipboard is unavailable in this browser.", variant: "destructive" });
    }
  }

  const orders = useMemo(() => ordersQuery.data?.pages.flatMap((page) => page.orders) ?? [], [ordersQuery.data]);
  const allOrders = useMemo(() => allOrdersQuery.data?.orders ?? [], [allOrdersQuery.data?.orders]);

  // ── Stats strip (from the unfiltered list) ─────────────────────────────────
  const stats = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const todays = allOrders.filter((o) => isSameLocalDay(o.createdAt, today));
    const yesterdays = allOrders.filter((o) => isSameLocalDay(o.createdAt, yesterday));
    return {
      ordersToday: todays.length,
      yesterdayCount: yesterdays.length,
      newOrders: allOrdersQuery.data?.newCount ?? 0,
      preparing: allOrders.filter((o) => o.status === "accepted").length,
      ready: allOrders.filter((o) => o.status === "ready").length,
      doneToday: todays.filter((o) => o.status === "fulfilled").length,
    };
  }, [allOrders, allOrdersQuery.data?.newCount]);

  const todayDelta =
    stats.yesterdayCount > 0 ? Math.round(((stats.ordersToday - stats.yesterdayCount) / stats.yesterdayCount) * 100) : null;

  // Keep the detail view live across refetches and status changes.
  const selectedOrder = useMemo(() => {
    if (!selectedId) return null;
    return allOrders.find((o) => o.id === selectedId) ?? orders.find((o) => o.id === selectedId) ?? null;
  }, [selectedId, allOrders, orders]);

  return (
    <div className="app-docked-page mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-black text-[var(--brand-ink)]">Online orders</h1>
            {(stats.newOrders + stats.preparing + stats.ready) > 0 ? (
              <span className="rounded-full bg-[#eaf2ff] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[var(--brand)]">{stats.newOrders + stats.preparing + stats.ready} active</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">{stats.ordersToday} received today · Live queue refreshes every 20 seconds</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void ordersQuery.refetch();
            void allOrdersQuery.refetch();
          }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#dfe7f2] bg-white text-[#405273] shadow-sm hover:bg-[var(--brand-softer)]"
          aria-label="Refresh orders"
        >
          <RefreshCw size={16} className={ordersQuery.isFetching || allOrdersQuery.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Stats strip */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
        <StatCard
          icon={<Inbox size={18} />}
          tint="bg-[#eaf2ff] text-[var(--brand)]"
          label="Needs review"
          value={stats.newOrders}
          sub="confirm before preparing"
        />
        <StatCard
          icon={<ChefHat size={18} />}
          tint="bg-[#fff7ed] text-[#c2410c]"
          label="In preparation"
          value={stats.preparing}
          sub="accepted, being prepared"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          tint="bg-[#f3efff] text-[#7c3aed]"
          label="Ready now"
          value={stats.ready}
          sub="waiting for handover"
        />
        <StatCard
          icon={<PackageCheck size={18} />}
          tint="bg-[#e9fbf0] text-[#16a34a]"
          label="Completed today"
          value={stats.doneToday}
          sub={todayDelta == null ? "today's completed orders" : `${stats.ordersToday} total received today`}
        />
      </div>

      {selectedOrder ? (
        <OrderDetail
          order={selectedOrder}
          opening={openingOrderId === selectedOrder.id}
          mutationPending={statusMutation.isPending}
          onBack={() => setSelectedId(null)}
          onAcceptBill={() => acceptAndBill(selectedOrder)}
          onMessage={() => messageCustomer(selectedOrder, selectedOrder.status === "accepted" ? "ready" : "received")}
          onMarkReady={() => statusMutation.mutate({ id: selectedOrder.id, next: "ready" })}
          onMarkDone={() => statusMutation.mutate({ id: selectedOrder.id, next: "fulfilled" })}
          onReject={() => {
            if (window.confirm(`Reject ${orderCode(selectedOrder.id)}? The customer will see this order as declined.`)) {
              statusMutation.mutate({ id: selectedOrder.id, next: "rejected" });
            }
          }}
          onPrint={() => printOrderSlip(selectedOrder)}
          onCopy={() => void copyOrderDetails(selectedOrder)}
        />
      ) : (
        <div className="mx-auto max-w-4xl">
          <div className="sticky top-0 z-10 -mx-3 mb-4 flex gap-2 overflow-x-auto border-y border-[#e7edf5] bg-[#f7f9fc]/95 px-3 py-2.5 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatus(tab.value)}
                className={`min-h-10 whitespace-nowrap rounded-xl px-3.5 text-[12px] font-bold transition ${
                  status === tab.value ? "bg-[var(--brand)] text-white shadow-[0_8px_20px_rgba(7,95,255,0.2)]" : "border border-[#dfe7f2] bg-white text-[#536383] hover:bg-[var(--brand-softer)]"
                }`}
              >
                {tab.label}
                {tab.value === "new" && stats.newOrders > 0 ? ` ${stats.newOrders}` : ""}
                {tab.value === "accepted" && stats.preparing > 0 ? ` ${stats.preparing}` : ""}
                {tab.value === "ready" && stats.ready > 0 ? ` ${stats.ready}` : ""}
              </button>
            ))}
          </div>

          {ordersQuery.isLoading ? (
            <div className="space-y-3" aria-label="Loading orders">
              {[0, 1, 2].map((key) => <div key={key} className="h-40 animate-pulse rounded-2xl border border-[#e6ecf4] bg-white" />)}
            </div>
          ) : ordersQuery.isError ? (
            <div className="rounded-2xl border border-[#fecdd3] bg-[#fff7f7] px-5 py-10 text-center">
              <XCircle size={28} className="mx-auto text-[#e11d48]" />
              <p className="mt-3 text-sm font-black text-[#9f1239]">Could not load online orders</p>
              <p className="mt-1 text-xs text-[#7f1d1d]">Check the connection and try again. Existing billing data is unchanged.</p>
              <button type="button" onClick={() => void ordersQuery.refetch()} className="mt-4 min-h-11 rounded-xl bg-[var(--brand)] px-5 text-xs font-black text-white">Try again</button>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#eef2f8] text-[#94a3b8]"><Inbox size={26} /></div>
              <p className="mt-3 text-sm font-semibold text-[#536383]">No {status === "all" ? "" : status} orders</p>
              <p className="mt-1 max-w-xs text-[12px] text-[#8290a8]">When a customer scans your Order QR and sends an order, it shows up here.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {orders.map((order) => (
                <li
                  key={order.id}
                  onClick={() => setSelectedId(order.id)}
                  className={`cursor-pointer rounded-2xl border bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.05)] transition hover:border-[#c9dcff] ${order.status === "new" ? "border-l-4 border-l-[var(--brand)] border-y-[#dce7f8] border-r-[#dce7f8]" : order.status === "ready" ? "border-l-4 border-l-[#7c3aed] border-y-[#e6dcff] border-r-[#e6dcff]" : "border-[#e6ecf4]"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-[var(--brand-ink)]">{order.customerName}</p>
                      <a
                        href={`tel:${order.customerMobile}`}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--brand)]"
                      >
                        <Phone size={12} /> {order.customerMobile}
                      </a>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-[#6d7c98]">
                        {order.fulfillmentType === "pickup" ? <ShoppingCart size={12} /> : <MapPin size={12} />}
                        {order.fulfillmentType === "pickup" ? "Store pickup" : "Delivery"}{order.promisedSlot ? ` · ${order.promisedSlot}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-2 text-right">
                      <div>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
                        <div className="mt-1 flex justify-end gap-1">
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">{CHANNEL_LABEL[order.sourceChannel]}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${PAYMENT_STYLE[order.paymentStatus]}`}>{PAYMENT_LABEL[order.paymentStatus]}</span>
                        </div>
                        <p className="mt-1 text-[10px] font-semibold text-[#8290a8]">{timeAgo(order.createdAt)}</p>
                      </div>
                      <ChevronRight size={16} className="mt-1 text-[#9aa7bd]" />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-xl border border-[#eef2f8] bg-[#f9fbfe] px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate text-[#334364]">
                      {order.items.slice(0, 3).map((it) => `${it.qty}× ${it.name}`).join(" · ")}
                      {order.items.length > 3 ? ` +${order.items.length - 3} more` : ""}
                    </span>
                    <span className="ml-3 shrink-0 font-black text-[var(--brand-ink)]">{fmtRs(order.estimatedTotal)}</span>
                  </div>

                  {!(["rejected", "cancelled", "fulfilled"] as CustomerOrder["status"][]).includes(order.status) ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      {order.status === "new" ? (
                        <button
                          type="button"
                          onClick={(e: MouseEvent) => { e.stopPropagation(); setSelectedId(order.id); }}
                          className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 text-[12px] font-bold text-white shadow-sm sm:col-span-1"
                        >
                          <ChevronRight size={15} /> Review & confirm
                        </button>
                      ) : order.status === "accepted" ? (
                        <button
                          type="button"
                          disabled={openingOrderId != null}
                          onClick={(e: MouseEvent) => { e.stopPropagation(); acceptAndBill(order); }}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-3 text-[12px] font-bold text-white shadow-sm disabled:cursor-wait disabled:opacity-70"
                        >
                          <ShoppingCart size={14} /> {openingOrderId === order.id ? "Opening..." : "Open in Billing"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={statusMutation.isPending}
                          onClick={(e: MouseEvent) => { e.stopPropagation(); statusMutation.mutate({ id: order.id, next: "fulfilled" }); }}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#16a34a] px-3 text-[12px] font-bold text-white shadow-sm disabled:opacity-60"
                        >
                          <PackageCheck size={14} /> Complete handover
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e: MouseEvent) => { e.stopPropagation(); messageCustomer(order, order.status === "accepted" ? "ready" : "received"); }}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#bfe6cd] bg-[#f0fbf4] px-3 text-[12px] font-bold text-[#16a34a]"
                      >
                        <MessageCircle size={14} /> Message
                      </button>
                      {order.status === "accepted" ? (
                        <button
                          type="button"
                          disabled={statusMutation.isPending}
                          onClick={(e: MouseEvent) => { e.stopPropagation(); statusMutation.mutate({ id: order.id, next: "ready" }); }}
                          className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#dbe3ee] bg-white px-3 text-[12px] font-bold text-[#405273] sm:col-span-1"
                        >
                          <CheckCircle2 size={14} /> Mark ready
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {ordersQuery.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                disabled={ordersQuery.isFetchingNextPage}
                onClick={() => void ordersQuery.fetchNextPage()}
                className="rounded-xl border border-[#dfe7f2] bg-white px-5 py-2.5 text-[12.5px] font-bold text-[#405273] hover:bg-[var(--brand-softer)] disabled:cursor-wait disabled:opacity-60"
              >
                {ordersQuery.isFetchingNextPage ? "Loading..." : "Load older orders"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  tint,
  label,
  value,
  sub,
  subTone = "text-[#8290a8]",
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: number;
  sub: string;
  subTone?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e6ecf4] bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.04)]">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tint}`}>{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-[#6d7c98]">{label}</p>
          <p className="font-display text-xl font-black leading-tight text-[var(--brand-ink)]">{value}</p>
        </div>
      </div>
      <p className={`mt-2 truncate text-[11px] font-semibold ${subTone}`}>{sub}</p>
    </div>
  );
}

// ── Order detail (reference-style: banner, items table, stepper, sidebar) ─────

const BANNER: Record<CustomerOrder["status"], { title: string; desc: string; icon: React.ReactNode; tint: string }> = {
  new: {
    title: "Order Received Successfully",
    desc: "The customer order has been received and is awaiting your confirmation.",
    icon: <CheckCircle2 size={30} />,
    tint: "bg-[#e9fbf0] text-[#16a34a]",
  },
  accepted: {
    title: "Order Confirmed — Preparing",
    desc: "Open it in Billing to adjust items and rates, then save the final bill.",
    icon: <ChefHat size={30} />,
    tint: "bg-[#eaf2ff] text-[var(--brand)]",
  },
  ready: {
    title: "Order Ready for Handover",
    desc: "The customer can collect it now, or the delivery can leave the store.",
    icon: <PackageCheck size={30} />,
    tint: "bg-[#f3efff] text-[#7c3aed]",
  },
  fulfilled: {
    title: "Order Completed",
    desc: "This order has been billed and handed over.",
    icon: <PackageCheck size={30} />,
    tint: "bg-[#e9fbf0] text-[#16a34a]",
  },
  rejected: {
    title: "Order Rejected",
    desc: "This order was declined. The customer sees it as declined on their tracker.",
    icon: <XCircle size={30} />,
    tint: "bg-[#fff1f2] text-[#e11d48]",
  },
  cancelled: {
    title: "Order Cancelled",
    desc: "This order is closed and cannot be moved back into preparation.",
    icon: <XCircle size={30} />,
    tint: "bg-[#fff1f2] text-[#be123c]",
  },
};

function OrderDetail({
  order,
  opening,
  mutationPending,
  onBack,
  onAcceptBill,
  onMessage,
  onMarkReady,
  onMarkDone,
  onReject,
  onPrint,
  onCopy,
}: {
  order: CustomerOrder;
  opening: boolean;
  mutationPending: boolean;
  onBack: () => void;
  onAcceptBill: () => void;
  onMessage: () => void;
  onMarkReady: () => void;
  onMarkDone: () => void;
  onReject: () => void;
  onPrint: () => void;
  onCopy: () => void;
}) {
  const banner = BANNER[order.status];
  const totalQty = order.items.reduce((sum, it) => sum + it.qty, 0);
  const active = order.status === "new" || order.status === "accepted" || order.status === "ready";
  const initials = order.customerName
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#405273] hover:text-[var(--brand)]">
        <ArrowLeft size={14} /> All orders
      </button>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-4">
          {/* Status banner */}
          <div className="rounded-2xl border border-[#e6ecf4] bg-white p-5 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
            <div className="flex items-start gap-4">
              <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${banner.tint}`}>{banner.icon}</span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-black text-[var(--brand-ink)]">{banner.title}</h2>
                <p className="mt-0.5 text-[12.5px] text-[#5b6b85]">{banner.desc}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#eef2f8] pt-4 sm:grid-cols-4">
              <BannerField label="Order ID" value={orderCode(order.id)} />
              <BannerField label="Date & Time" value={fullDateTime(order.createdAt)} />
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8290a8]">Order Source</p>
                <p className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-bold text-[var(--brand-ink)]"><QrCode size={13} className="text-[var(--brand)]" /> {CHANNEL_LABEL[order.sourceChannel]}</p>
              </div>
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8290a8]">Status</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[order.status]}`}>
                  {STATUS_LABEL[order.status]}
                </span>
              </div>
            </div>
          </div>

          {/* Items table */}
          <div className="rounded-2xl border border-[#e6ecf4] bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.05)] sm:p-5">
            <p className="mb-3 inline-flex items-center gap-2 text-[13.5px] font-black text-[var(--brand-ink)]"><ShoppingCart size={15} className="text-[var(--brand)]" /> Order Items</p>
            <div className="space-y-2 sm:hidden">
              {order.items.map((it, i) => (
                <div key={`${it.productId}-${i}`} className="flex items-center gap-3 rounded-xl border border-[#edf2f8] bg-[#fbfdff] p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef4ff] text-sm font-black text-[var(--brand)]">{it.name.charAt(0).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-black text-[var(--brand-ink)]">{it.name}</p>
                    <p className="mt-0.5 text-[11px] font-semibold capitalize text-[#6d7c98]">{it.qty} × {it.unit} · {fmtRs(it.price)} each</p>
                  </div>
                  <span className="shrink-0 text-[13px] font-black tabular-nums text-[var(--brand-ink)]">{fmtRs(it.qty * it.price)}</span>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[430px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#eef2f8] text-left text-[10.5px] font-bold uppercase tracking-wide text-[#8290a8]">
                    <th className="pb-2 pr-2">#</th>
                    <th className="pb-2 pr-2">Item</th>
                    <th className="pb-2 pr-2 text-right">Qty</th>
                    <th className="pb-2 pr-2">Unit</th>
                    <th className="pb-2 pr-2 text-right">Rate (Rs)</th>
                    <th className="pb-2 text-right">Amount (Rs)</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it, i) => (
                    <tr key={`${it.productId}-${i}`} className="border-b border-[#f4f7fb] last:border-b-0">
                      <td className="py-2.5 pr-2 text-[#8290a8]">{i + 1}</td>
                      <td className="py-2.5 pr-2">
                        <span className="flex items-center gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#f0f4fa] text-[11px] font-black text-[#8fa0ba]">
                            {it.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 truncate font-bold text-[var(--brand-ink)]">{it.name}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-2 text-right font-bold tabular-nums text-[var(--brand-ink)]">{it.qty}</td>
                      <td className="py-2.5 pr-2 capitalize text-[#5b6b85]">{it.unit}</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-[#5b6b85]">{fmtMoney(it.price)}</td>
                      <td className="py-2.5 text-right font-bold tabular-nums text-[var(--brand-ink)]">{fmtMoney(it.qty * it.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 ml-auto w-full max-w-[300px] space-y-1.5 text-[12.5px]">
              <div className="flex items-center justify-between text-[#5b6b85]">
                <span>Subtotal</span><span className="tabular-nums">{fmtRs(order.estimatedTotal)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#f4f8ff] px-2.5 py-2 text-[13.5px] font-black text-[var(--brand-ink)]">
                <span>Estimated Total</span><span className="tabular-nums">{fmtRs(order.estimatedTotal)}</span>
              </div>
              <p className="text-[10.5px] leading-snug text-[#8290a8]">Discounts, delivery and GST are applied at billing.</p>
            </div>
          </div>

          {/* Fulfillment progress */}
          {order.status !== "rejected" && order.status !== "cancelled" && (
            <div className="rounded-2xl border border-[#e6ecf4] bg-white p-5 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
              <p className="mb-4 inline-flex items-center gap-2 text-[13.5px] font-black text-[var(--brand-ink)]"><PackageCheck size={15} className="text-[var(--brand)]" /> Fulfillment Progress</p>
              <FulfillmentStepper order={order} />
            </div>
          )}

          {/* Action bar */}
          {active && (
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,35,80,0.06)] sm:flex sm:flex-wrap">
              <button
                type="button"
                disabled={opening}
                onClick={onAcceptBill}
                className="col-span-2 inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 text-[12.5px] font-bold text-white shadow-sm disabled:cursor-wait disabled:opacity-70 sm:col-span-1"
              >
                <CheckCircle2 size={15} /> {opening ? "Opening..." : order.status === "new" ? "Confirm & Open in Billing" : "Open in Billing"}
              </button>
              <button type="button" onClick={onPrint} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#dbe3ee] bg-white px-3 text-[12.5px] font-bold text-[#405273]">
                <Printer size={15} /> Print Slip
              </button>
              <button type="button" onClick={onMessage} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#bfe6cd] bg-[#f0fbf4] px-3 text-[12.5px] font-bold text-[#16a34a]">
                <MessageCircle size={15} /> WhatsApp Customer
              </button>
              {order.status !== "new" ? (
                <button
                  type="button"
                  disabled={mutationPending}
                  onClick={order.status === "accepted" ? onMarkReady : onMarkDone}
                  className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#dbe3ee] bg-white px-3 text-[12.5px] font-bold text-[#405273] sm:col-span-1"
                >
                  <PackageCheck size={15} /> {order.status === "accepted" ? "Mark Ready" : "Complete handover"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={mutationPending}
                onClick={onReject}
                className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#f0d5d5] bg-[#fff5f5] px-3 text-[12.5px] font-bold text-[#e11d48] sm:col-span-1"
              >
                <XCircle size={15} /> Reject order
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Customer details */}
          <SideCard title="Customer Details">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#eaf2ff] font-display text-[14px] font-black text-[var(--brand)]">{initials}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold text-[var(--brand-ink)]">
                  <span className="truncate">{order.customerName}</span>
                  {order.status === "new" && <span className="rounded-full bg-[#e9fbf0] px-2 py-0.5 text-[9.5px] font-black uppercase text-[#16a34a]">New</span>}
                </p>
                <a href={`tel:${order.customerMobile}`} className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--brand)]">
                  <Phone size={12} /> +91 {order.customerMobile}
                </a>
              </div>
            </div>
            {order.customerAddress ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-[12px] leading-snug text-[#5b6b85]">
                <MapPin size={13} className="mt-0.5 shrink-0 text-[#8290a8]" /> {order.customerAddress}
              </p>
            ) : (
              <p className="mt-2.5 text-[12px] text-[#9aa7bd]">No address given — counter pickup.</p>
            )}
          </SideCard>

          {/* Payment & fulfillment */}
          <SideCard title="Payment & Fulfillment">
            <InfoRow label="Payment" chip="At billing" chipClass="bg-[#eaf2ff] text-[var(--brand)]" />
            <InfoRow label="Order Source" chip="QR Order" chipClass="bg-[#eaf2ff] text-[var(--brand)]" />
            <InfoRow label="Fulfillment" value={order.fulfillmentType === "pickup" ? "Store pickup" : "Delivery"} />
            {order.promisedSlot ? <InfoRow label="Preferred Slot" value={order.promisedSlot} /> : null}
            <InfoRow label="Placed On" value={fullDateTime(order.createdAt)} />
            <InfoRow label="Status" chip={STATUS_LABEL[order.status]} chipClass={STATUS_STYLE[order.status]} />
            {order.billId ? <InfoRow label="Linked Bill" value={order.billId.length > 14 ? `…${order.billId.slice(-10)}` : order.billId} mono /> : null}
          </SideCard>

          {/* Order summary */}
          <SideCard title="Order Summary">
            <InfoRow label="Total Items" value={`${order.itemCount} item${order.itemCount === 1 ? "" : "s"} · ${totalQty} qty`} />
            <InfoRow label="Estimated Amount" value={fmtRs(order.estimatedTotal)} />
            <div className="mt-2 flex items-center justify-between border-t border-[#eef2f8] pt-2.5">
              <span className="text-[13px] font-black text-[var(--brand-ink)]">Grand Total</span>
              <span className="font-display text-[16px] font-black text-[var(--brand)]">{fmtRs(order.estimatedTotal)}</span>
            </div>
            <p className="mt-1 text-[10.5px] text-[#8290a8]">Estimated — final price is set when you bill it.</p>
          </SideCard>

          {/* Notes */}
          <SideCard title="Notes / Instructions">
            {order.note ? (
              <p className="flex items-start gap-1.5 text-[12.5px] italic leading-snug text-[#5b6b85]">
                <StickyNote size={13} className="mt-0.5 shrink-0 text-[#c2410c]" /> "{order.note}"
              </p>
            ) : (
              <p className="text-[12px] text-[#9aa7bd]">No notes from the customer.</p>
            )}
          </SideCard>

          {/* Quick actions */}
          <SideCard title="Quick Actions">
            <div className="grid grid-cols-3 gap-2">
              <QuickAction icon={<ShoppingCart size={16} />} label="Open in Billing" disabled={!active || opening} onClick={onAcceptBill} />
              <QuickAction icon={<MessageCircle size={16} />} label="WhatsApp" onClick={onMessage} />
              <QuickAction icon={<Printer size={16} />} label="Print Slip" onClick={onPrint} />
              <QuickAction icon={<Copy size={16} />} label="Copy Details" onClick={onCopy} />
              <QuickAction icon={<PackageCheck size={16} />} label={order.status === "accepted" ? "Mark Ready" : order.status === "ready" ? "Complete" : "Next status"} disabled={!active || mutationPending || order.status === "new"} onClick={order.status === "accepted" ? onMarkReady : onMarkDone} />
              <QuickAction icon={<XCircle size={16} />} label="Reject" tone="danger" disabled={!active || mutationPending} onClick={onReject} />
            </div>
          </SideCard>
        </div>
      </div>
    </div>
  );
}

function BannerField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8290a8]">{label}</p>
      <p className="mt-1 truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}

const STEPS = [
  { label: "Order Received", pendingSub: "" },
  { label: "Confirm by Store", pendingSub: "Next step" },
  { label: "Ready", pendingSub: "Pending" },
  { label: "Completed", pendingSub: "Pending" },
] as const;

function FulfillmentStepper({ order }: { order: CustomerOrder }) {
  // First step that is NOT done: new → confirm(1); accepted → bill(2); fulfilled → past the end.
  const currentIndex = order.status === "new" ? 1 : order.status === "accepted" ? 2 : order.status === "ready" ? 3 : STEPS.length;

  return (
    <div>
      <div className="grid grid-cols-4">
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const activeStep = i === currentIndex;
          return (
            <div key={step.label} className="relative flex justify-center">
              {i > 0 && <span className={`absolute left-0 right-1/2 top-1/2 h-0.5 -translate-y-1/2 ${i <= currentIndex - 1 ? "bg-[#16a34a]" : "bg-[#e6ecf4]"}`} />}
              {i < STEPS.length - 1 && <span className={`absolute left-1/2 right-0 top-1/2 h-0.5 -translate-y-1/2 ${i < currentIndex - 1 ? "bg-[#16a34a]" : "bg-[#e6ecf4]"}`} />}
              <span
                className={`relative z-10 grid h-9 w-9 place-items-center rounded-full text-[12px] font-black ${
                  done ? "bg-[#16a34a] text-white" : activeStep ? "bg-[var(--brand)] text-white" : "border-2 border-[#e6ecf4] bg-white text-[#9aa7bd]"
                }`}
              >
                {done ? <CheckCircle2 size={17} /> : i + 1}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-4 text-center">
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const activeStep = i === currentIndex;
          const sub =
            i === 0 ? fullDateTime(order.createdAt)
            : done ? (i === STEPS.length - 1 ? timeAgo(order.updatedAt) : "Done")
            : activeStep ? (i === 1 ? "Next step" : "Open in Billing")
            : "Pending";
          return (
            <div key={step.label} className="px-1">
              <p className={`text-[11px] font-black leading-tight ${done || activeStep ? "text-[var(--brand-ink)]" : "text-[#9aa7bd]"}`}>{step.label}</p>
              <p className="mt-0.5 truncate text-[10px] font-semibold text-[#8290a8]">{sub}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e6ecf4] bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
      <p className="mb-3 text-[13px] font-black text-[var(--brand-ink)]">{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, chip, chipClass, mono }: { label: string; value?: string; chip?: string; chipClass?: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
      <span className="shrink-0 font-semibold text-[#6d7c98]">{label}</span>
      {chip ? (
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${chipClass ?? "bg-[#eef2f8] text-[#536383]"}`}>{chip}</span>
      ) : (
        <span className={`min-w-0 truncate text-right font-bold text-[var(--brand-ink)] ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
      )}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "danger"
          ? "border-[#f0d5d5] bg-[#fff8f8] text-[#e11d48] hover:bg-[#fff1f2]"
          : "border-[#e2eaf4] bg-[#fbfdff] text-[#405273] hover:border-[#c9dcff] hover:bg-[#f4f8ff]"
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold leading-tight">{label}</span>
    </button>
  );
}
