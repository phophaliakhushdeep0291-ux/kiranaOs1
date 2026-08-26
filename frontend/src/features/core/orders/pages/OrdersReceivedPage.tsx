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
import { escapeHtml } from "@/lib/escape-html";
import { TradeFocusStrip } from "@/components/shared";
import { useAppLanguage, type Translate, type TranslationKey } from "@/features/core/settings/i18n";
import { useBusinessTypeKey } from "@/features/core/settings/business-types";
import { getShopOrdersProfile } from "@/features/core/settings/shop-orders";

// Labels are dictionary KEYS rather than text: these maps are module-level, so a
// string here would be frozen in whichever language happened to load first.
const STATUS_TABS: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: "new", labelKey: "orders.tab.new" },
  { value: "accepted", labelKey: "orders.tab.accepted" },
  { value: "ready", labelKey: "orders.tab.ready" },
  { value: "fulfilled", labelKey: "orders.tab.fulfilled" },
  { value: "all", labelKey: "orders.tab.all" },
];

const STATUS_STYLE: Record<CustomerOrder["status"], string> = {
  new: "bg-[#eaf2ff] text-[var(--brand)]",
  accepted: "bg-[#fff7ed] text-[#c2410c]",
  ready: "bg-[#f3efff] text-[#7c3aed]",
  fulfilled: "bg-[#e9fbf0] text-[#16a34a]",
  rejected: "bg-[#f1f5f9] text-[#64748b]",
  cancelled: "bg-[#fff1f2] text-[#be123c]",
};

const STATUS_LABEL: Record<CustomerOrder["status"], TranslationKey> = {
  new: "orders.status.new",
  accepted: "orders.status.accepted",
  ready: "orders.status.ready",
  fulfilled: "orders.status.fulfilled",
  rejected: "orders.status.rejected",
  cancelled: "orders.status.cancelled",
};

const CHANNEL_LABEL: Record<CustomerOrder["sourceChannel"], TranslationKey> = { pos: "orders.channel.pos", customer_portal: "orders.channel.customerPortal", api: "orders.channel.api", marketplace: "orders.channel.marketplace" };
const PAYMENT_LABEL: Record<CustomerOrder["paymentStatus"], TranslationKey> = { unpaid: "orders.payment.unpaid", partially_paid: "orders.payment.partiallyPaid", paid: "orders.payment.paid", refunded: "orders.payment.refunded" };
const PAYMENT_STYLE: Record<CustomerOrder["paymentStatus"], string> = {
  unpaid: "bg-amber-50 text-amber-700", partially_paid: "bg-orange-50 text-orange-700", paid: "bg-emerald-50 text-emerald-700", refunded: "bg-slate-100 text-slate-600",
};

const fmtRs = (n: number) => `Rs ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtMoney = (n: number) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Friendly display code for a cuid order id, e.g. ORD-9B2AK4. */
const orderCode = (id: string) => `ORD-${id.slice(-6).toUpperCase()}`;

function timeAgo(t: Translate, iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("orders.time.justNow");
  if (mins < 60) return t("orders.time.minutesAgo", { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("orders.time.hoursAgo", { count: hrs });
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
  const { t } = useAppLanguage();
  // A restaurant's orders are simply its orders; a showroom's are customer
  // orders against a lead time, a factory's are buyer orders against capacity.
  const tradeProfile = getShopOrdersProfile(useBusinessTypeKey());
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
      toast({
        title: added === 1 ? t("orders.toast.newOrder", { count: added }) : t("orders.toast.newOrders", { count: added }),
        description: t("orders.toast.newOrderHint"),
      });
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
    onError: (err: unknown) => toast({ title: t("orders.toast.updateFailed"), description: err instanceof Error ? err.message : t("orders.toast.tryAgain"), variant: "destructive" }),
  });

  // Primary action: open the order in Billing so the owner can adjust items, rates,
  // discounts, and payment mode before making the final bill. WhatsApp is separate.
  function acceptAndBill(order: CustomerOrder) {
    if (openingOrderId) return;
    setOpeningOrderId(order.id);
    void loadIntoBilling(order)
      .catch((error: unknown) => {
        toast({
          title: t("orders.toast.openFailed"),
          description: error instanceof Error ? error.message : t("orders.toast.tryAgainPolite"),
          variant: "destructive",
        });
      })
      .finally(() => setOpeningOrderId(null));
  }

  /** Standalone "let the customer know it's ready" — no state change, just opens WhatsApp. */
  function messageCustomer(order: CustomerOrder, kind: "received" | "ready") {
    const { targetedCustomer } = alertCustomerOnWhatsapp(order, shopName, kind);
    if (!targetedCustomer) {
      toast({ title: t("orders.toast.whatsappOpened"), description: t("orders.toast.whatsappOpenedHint") });
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
      throw new Error(t("orders.error.catalogLoading"));
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
      toast({ title: t("orders.toast.alreadyOpen"), description: t("orders.toast.alreadyOpenHint") });
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
      toast({ title: t("orders.toast.alreadyInBilling"), description: t("orders.toast.alreadyInBillingHint") });
      navigate("/billing");
      return;
    }

    const importOrder = () => billFromImportedCart(
      catalogProducts,
      requestedItems,
      { label: t("orders.billing.importLabel", { name: order.customerName }), sourceOrderId: order.id },
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
      toast({ title: t("orders.toast.noMatch"), description: t("orders.toast.noMatchHint"), variant: "destructive" });
      return;
    }
    const withCustomer: HeldBill = { ...bill, customerName: order.customerName, customerMobile: order.customerMobile };
    await Promise.all([
      offlineDB.setSetting(HELD_BILLS_KEY, nextHeldBills),
      offlineDB.setSetting(BILLING_DRAFT_KEY, billingDraftFromHeldBill(withCustomer)),
    ]);
    statusMutation.mutate({ id: order.id, next: "accepted" });
    toast({
      title: t("orders.toast.sentToBilling"),
      description: (matched === 1
        ? t("orders.toast.sentToBillingHint", { count: matched })
        : t("orders.toast.sentToBillingHintPlural", { count: matched }))
        + (skipped.length ? t("orders.toast.sentToBillingSkipped", { count: skipped.length }) : ""),
    });
    navigate("/billing");
  }

  /** Compact printable order slip (not a bill — final price is set at billing). */
  function printOrderSlip(order: CustomerOrder) {
    const popup = window.open("", "_blank", "width=420,height=640");
    if (!popup) {
      toast({ title: t("orders.toast.printBlocked"), description: t("orders.toast.printBlockedHint"), variant: "destructive" });
      return;
    }
    const rows = order.items
      .map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.qty)}× ${escapeHtml(it.name)}</td><td style="text-align:right">${escapeHtml(fmtMoney(it.qty * it.price))}</td></tr>`)
      .join("");
    popup.document.write(
      `<!doctype html><html><head><title>${escapeHtml(t("orders.slip.title", { code: orderCode(order.id) }))}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;padding:20px;margin:0;color:#111">` +
        `<h2 style="margin:0 0 2px">${escapeHtml(shopName || t("orders.slip.fallbackHeading"))}</h2>` +
        `<p style="margin:0 0 12px;color:#555;font-size:12px">${escapeHtml(orderCode(order.id))} · ${escapeHtml(fullDateTime(order.createdAt))}</p>` +
        `<p style="margin:0 0 12px;font-size:13px"><b>${escapeHtml(order.customerName)}</b> · ${escapeHtml(order.customerMobile)}` +
        `${order.customerAddress ? `<br/>${escapeHtml(order.customerAddress)}` : ""}</p>` +
        `<table style="width:100%;border-collapse:collapse;font-size:13px">` +
        `<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>#</th><th>${escapeHtml(t("orders.slip.item"))}</th><th style="text-align:right">Rs</th></tr></thead>` +
        `<tbody>${rows}</tbody>` +
        `<tfoot><tr style="border-top:1px solid #ccc;font-weight:bold"><td></td><td>${escapeHtml(t("orders.slip.estimatedTotal"))}</td><td style="text-align:right">${escapeHtml(fmtMoney(order.estimatedTotal))}</td></tr></tfoot>` +
        `</table>` +
        `${order.note ? `<p style="margin-top:12px;font-size:12px;font-style:italic">"${escapeHtml(order.note)}"</p>` : ""}` +
        `<p style="margin-top:14px;font-size:11px;color:#888">${escapeHtml(t("orders.slip.finalPriceNote"))}</p>` +
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
      t("orders.copy.estimatedTotal", { amount: fmtRs(order.estimatedTotal) }),
      ...(order.note ? [t("orders.copy.note", { note: order.note })] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: t("orders.toast.copied"), description: t("orders.toast.copiedHint") });
    } catch {
      toast({ title: t("orders.toast.copyFailed"), description: t("orders.toast.copyFailedHint"), variant: "destructive" });
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
            <h1 className="font-display text-xl font-black text-[var(--brand-ink)]">{t(tradeProfile.headingKey)}</h1>
            {(stats.newOrders + stats.preparing + stats.ready) > 0 ? (
              <span className="rounded-full bg-[#eaf2ff] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[var(--brand)]">{t("orders.badge.active", { count: stats.newOrders + stats.preparing + stats.ready })}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">{t("orders.subtitle", { count: stats.ordersToday })}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void ordersQuery.refetch();
            void allOrdersQuery.refetch();
          }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#dfe7f2] bg-white text-[#405273] shadow-sm hover:bg-[var(--brand-softer)]"
          aria-label={t("orders.refresh")}
        >
          <RefreshCw size={16} className={ordersQuery.isFetching || allOrdersQuery.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      <TradeFocusStrip
        titleKey="orders.trade.title"
        focusKey={tradeProfile.focusKey}
        links={tradeProfile.links}
        className="mb-4"
      />

      {/* Stats strip */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
        <StatCard
          icon={<Inbox size={18} />}
          tint="bg-[#eaf2ff] text-[var(--brand)]"
          label={t("orders.stat.needsReview")}
          value={stats.newOrders}
          sub={t("orders.stat.needsReviewHint")}
        />
        <StatCard
          icon={<ChefHat size={18} />}
          tint="bg-[#fff7ed] text-[#c2410c]"
          label={t("orders.stat.inPreparation")}
          value={stats.preparing}
          sub={t("orders.stat.inPreparationHint")}
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          tint="bg-[#f3efff] text-[#7c3aed]"
          label={t("orders.stat.readyNow")}
          value={stats.ready}
          sub={t("orders.stat.readyNowHint")}
        />
        <StatCard
          icon={<PackageCheck size={18} />}
          tint="bg-[#e9fbf0] text-[#16a34a]"
          label={t("orders.stat.completedToday")}
          value={stats.doneToday}
          sub={todayDelta == null ? t("orders.stat.completedTodayHint") : t("orders.stat.receivedToday", { count: stats.ordersToday })}
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
            if (window.confirm(t("orders.confirm.reject", { code: orderCode(selectedOrder.id) }))) {
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
                className={`min-h-11 whitespace-nowrap rounded-xl px-3.5 text-[12px] font-bold transition lg:mouse:min-h-10 ${
                  status === tab.value ? "bg-[var(--brand)] text-white shadow-[0_8px_20px_rgba(7,95,255,0.2)]" : "border border-[#dfe7f2] bg-white text-[#536383] hover:bg-[var(--brand-softer)]"
                }`}
              >
                {t(tab.labelKey)}
                {tab.value === "new" && stats.newOrders > 0 ? ` ${stats.newOrders}` : ""}
                {tab.value === "accepted" && stats.preparing > 0 ? ` ${stats.preparing}` : ""}
                {tab.value === "ready" && stats.ready > 0 ? ` ${stats.ready}` : ""}
              </button>
            ))}
          </div>

          {ordersQuery.isLoading ? (
            <div className="space-y-3" aria-label={t("orders.loading")}>
              {[0, 1, 2].map((key) => <div key={key} className="h-40 animate-pulse rounded-2xl border border-[#e6ecf4] bg-white" />)}
            </div>
          ) : ordersQuery.isError ? (
            <div className="rounded-2xl border border-[#fecdd3] bg-[#fff7f7] px-5 py-10 text-center">
              <XCircle size={28} className="mx-auto text-[#e11d48]" />
              <p className="mt-3 text-sm font-black text-[#9f1239]">{t("orders.error.title")}</p>
              <p className="mt-1 text-xs text-[#7f1d1d]">{t("orders.error.detail")}</p>
              <button type="button" onClick={() => void ordersQuery.refetch()} className="mt-4 min-h-11 rounded-xl bg-[var(--brand)] px-5 text-xs font-black text-white">{t("orders.error.retry")}</button>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#eef2f8] text-[#94a3b8]"><Inbox size={26} /></div>
              <p className="mt-3 text-sm font-semibold text-[#536383]">{status === "all" ? t("orders.empty.title") : t("orders.empty.titleFiltered", { status: t(STATUS_TABS.find((tab) => tab.value === status)?.labelKey ?? "orders.tab.all") })}</p>
              <p className="mt-1 max-w-xs text-[12px] text-[#8290a8]">{t("orders.empty.hint")}</p>
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
                        {order.fulfillmentType === "pickup" ? t("orders.row.pickup") : t("orders.row.delivery")}{order.promisedSlot ? ` · ${order.promisedSlot}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-2 text-right">
                      <div>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[order.status]}`}>{t(STATUS_LABEL[order.status])}</span>
                        <div className="mt-1 flex justify-end gap-1">
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">{t(CHANNEL_LABEL[order.sourceChannel])}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${PAYMENT_STYLE[order.paymentStatus]}`}>{t(PAYMENT_LABEL[order.paymentStatus])}</span>
                        </div>
                        <p className="mt-1 text-[10px] font-semibold text-[#8290a8]">{timeAgo(t, order.createdAt)}</p>
                      </div>
                      <ChevronRight size={16} className="mt-1 text-[#9aa7bd]" />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-xl border border-[#eef2f8] bg-[#f9fbfe] px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate text-[#334364]">
                      {order.items.slice(0, 3).map((it) => `${it.qty}× ${it.name}`).join(" · ")}
                      {order.items.length > 3 ? ` ${t("orders.row.moreItems", { count: order.items.length - 3 })}` : ""}
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
                          <ChevronRight size={15} /> {t("orders.row.reviewConfirm")}
                        </button>
                      ) : order.status === "accepted" ? (
                        <button
                          type="button"
                          disabled={openingOrderId != null}
                          onClick={(e: MouseEvent) => { e.stopPropagation(); acceptAndBill(order); }}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-3 text-[12px] font-bold text-white shadow-sm disabled:cursor-wait disabled:opacity-70"
                        >
                          <ShoppingCart size={14} /> {openingOrderId === order.id ? t("orders.row.opening") : t("orders.row.openInBilling")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={statusMutation.isPending}
                          onClick={(e: MouseEvent) => { e.stopPropagation(); statusMutation.mutate({ id: order.id, next: "fulfilled" }); }}
                          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#16a34a] px-3 text-[12px] font-bold text-white shadow-sm disabled:opacity-60"
                        >
                          <PackageCheck size={14} /> {t("orders.row.completeHandover")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e: MouseEvent) => { e.stopPropagation(); messageCustomer(order, order.status === "accepted" ? "ready" : "received"); }}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#bfe6cd] bg-[#f0fbf4] px-3 text-[12px] font-bold text-[#16a34a]"
                      >
                        <MessageCircle size={14} /> {t("orders.row.message")}
                      </button>
                      {order.status === "accepted" ? (
                        <button
                          type="button"
                          disabled={statusMutation.isPending}
                          onClick={(e: MouseEvent) => { e.stopPropagation(); statusMutation.mutate({ id: order.id, next: "ready" }); }}
                          className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#dbe3ee] bg-white px-3 text-[12px] font-bold text-[#405273] sm:col-span-1"
                        >
                          <CheckCircle2 size={14} /> {t("orders.row.markReady")}
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
                {ordersQuery.isFetchingNextPage ? t("orders.loadingShort") : t("orders.loadOlder")}
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

const BANNER: Record<CustomerOrder["status"], { titleKey: TranslationKey; descKey: TranslationKey; icon: React.ReactNode; tint: string }> = {
  new: {
    titleKey: "orders.banner.new.title",
    descKey: "orders.banner.new.desc",
    icon: <CheckCircle2 size={30} />,
    tint: "bg-[#e9fbf0] text-[#16a34a]",
  },
  accepted: {
    titleKey: "orders.banner.accepted.title",
    descKey: "orders.banner.accepted.desc",
    icon: <ChefHat size={30} />,
    tint: "bg-[#eaf2ff] text-[var(--brand)]",
  },
  ready: {
    titleKey: "orders.banner.ready.title",
    descKey: "orders.banner.ready.desc",
    icon: <PackageCheck size={30} />,
    tint: "bg-[#f3efff] text-[#7c3aed]",
  },
  fulfilled: {
    titleKey: "orders.banner.fulfilled.title",
    descKey: "orders.banner.fulfilled.desc",
    icon: <PackageCheck size={30} />,
    tint: "bg-[#e9fbf0] text-[#16a34a]",
  },
  rejected: {
    titleKey: "orders.banner.rejected.title",
    descKey: "orders.banner.rejected.desc",
    icon: <XCircle size={30} />,
    tint: "bg-[#fff1f2] text-[#e11d48]",
  },
  cancelled: {
    titleKey: "orders.banner.cancelled.title",
    descKey: "orders.banner.cancelled.desc",
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
  const { t } = useAppLanguage();
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
        <ArrowLeft size={14} /> {t("orders.detail.back")}
      </button>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-4">
          {/* Status banner */}
          <div className="rounded-2xl border border-[#e6ecf4] bg-white p-5 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
            <div className="flex items-start gap-4">
              <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${banner.tint}`}>{banner.icon}</span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-black text-[var(--brand-ink)]">{t(banner.titleKey)}</h2>
                <p className="mt-0.5 text-[12.5px] text-[#5b6b85]">{t(banner.descKey)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#eef2f8] pt-4 sm:grid-cols-4">
              <BannerField label={t("orders.detail.orderId")} value={orderCode(order.id)} />
              <BannerField label={t("orders.detail.dateTime")} value={fullDateTime(order.createdAt)} />
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8290a8]">{t("orders.detail.orderSource")}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-bold text-[var(--brand-ink)]"><QrCode size={13} className="text-[var(--brand)]" /> {t(CHANNEL_LABEL[order.sourceChannel])}</p>
              </div>
              <div>
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-[#8290a8]">{t("orders.detail.status")}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[order.status]}`}>
                  {t(STATUS_LABEL[order.status])}
                </span>
              </div>
            </div>
          </div>

          {/* Items table */}
          <div className="rounded-2xl border border-[#e6ecf4] bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.05)] sm:p-5">
            <p className="mb-3 inline-flex items-center gap-2 text-[13.5px] font-black text-[var(--brand-ink)]"><ShoppingCart size={15} className="text-[var(--brand)]" /> {t("orders.detail.orderItems")}</p>
            <div className="space-y-2 sm:hidden">
              {order.items.map((it, i) => (
                <div key={`${it.productId}-${i}`} className="flex items-center gap-3 rounded-xl border border-[#edf2f8] bg-[#fbfdff] p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef4ff] text-sm font-black text-[var(--brand)]">{it.name.charAt(0).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-black text-[var(--brand-ink)]">{it.name}</p>
                    <p className="mt-0.5 text-[11px] font-semibold capitalize text-[#6d7c98]">{t("orders.detail.each", { qty: it.qty, unit: it.unit, price: fmtRs(it.price) })}</p>
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
                    <th className="pb-2 pr-2">{t("orders.detail.colItem")}</th>
                    <th className="pb-2 pr-2 text-right">{t("orders.detail.colQty")}</th>
                    <th className="pb-2 pr-2">{t("orders.detail.colUnit")}</th>
                    <th className="pb-2 pr-2 text-right">{t("orders.detail.colRate")}</th>
                    <th className="pb-2 text-right">{t("orders.detail.colAmount")}</th>
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
                <span>{t("orders.detail.subtotal")}</span><span className="tabular-nums">{fmtRs(order.estimatedTotal)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#f4f8ff] px-2.5 py-2 text-[13.5px] font-black text-[var(--brand-ink)]">
                <span>{t("orders.detail.estimatedTotal")}</span><span className="tabular-nums">{fmtRs(order.estimatedTotal)}</span>
              </div>
              <p className="text-[10.5px] leading-snug text-[#8290a8]">{t("orders.detail.billingNote")}</p>
            </div>
          </div>

          {/* Fulfillment progress */}
          {order.status !== "rejected" && order.status !== "cancelled" && (
            <div className="rounded-2xl border border-[#e6ecf4] bg-white p-5 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
              <p className="mb-4 inline-flex items-center gap-2 text-[13.5px] font-black text-[var(--brand-ink)]"><PackageCheck size={15} className="text-[var(--brand)]" /> {t("orders.detail.progress")}</p>
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
                <CheckCircle2 size={15} /> {opening ? t("orders.row.opening") : order.status === "new" ? t("orders.detail.confirmAndBill") : t("orders.row.openInBilling")}
              </button>
              <button type="button" onClick={onPrint} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#dbe3ee] bg-white px-3 text-[12.5px] font-bold text-[#405273]">
                <Printer size={15} /> {t("orders.detail.printSlip")}
              </button>
              <button type="button" onClick={onMessage} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#bfe6cd] bg-[#f0fbf4] px-3 text-[12.5px] font-bold text-[#16a34a]">
                <MessageCircle size={15} /> {t("orders.detail.whatsappCustomer")}
              </button>
              {order.status !== "new" ? (
                <button
                  type="button"
                  disabled={mutationPending}
                  onClick={order.status === "accepted" ? onMarkReady : onMarkDone}
                  className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#dbe3ee] bg-white px-3 text-[12.5px] font-bold text-[#405273] sm:col-span-1"
                >
                  <PackageCheck size={15} /> {order.status === "accepted" ? t("orders.detail.markReady") : t("orders.row.completeHandover")}
                </button>
              ) : null}
              <button
                type="button"
                disabled={mutationPending}
                onClick={onReject}
                className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#f0d5d5] bg-[#fff5f5] px-3 text-[12.5px] font-bold text-[#e11d48] sm:col-span-1"
              >
                <XCircle size={15} /> {t("orders.detail.rejectOrder")}
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Customer details */}
          <SideCard title={t("orders.detail.customerDetails")}>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#eaf2ff] font-display text-[14px] font-black text-[var(--brand)]">{initials}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold text-[var(--brand-ink)]">
                  <span className="truncate">{order.customerName}</span>
                  {order.status === "new" && <span className="rounded-full bg-[#e9fbf0] px-2 py-0.5 text-[9.5px] font-black uppercase text-[#16a34a]">{t("orders.detail.newBadge")}</span>}
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
              <p className="mt-2.5 text-[12px] text-[#9aa7bd]">{t("orders.detail.noAddress")}</p>
            )}
          </SideCard>

          {/* Payment & fulfillment */}
          <SideCard title={t("orders.detail.paymentFulfillment")}>
            <InfoRow label={t("orders.detail.payment")} chip={t("orders.detail.atBilling")} chipClass="bg-[#eaf2ff] text-[var(--brand)]" />
            <InfoRow label={t("orders.detail.orderSource")} chip={t("orders.detail.qrOrder")} chipClass="bg-[#eaf2ff] text-[var(--brand)]" />
            <InfoRow label={t("orders.detail.fulfillment")} value={order.fulfillmentType === "pickup" ? t("orders.row.pickup") : t("orders.row.delivery")} />
            {order.promisedSlot ? <InfoRow label={t("orders.detail.preferredSlot")} value={order.promisedSlot} /> : null}
            <InfoRow label={t("orders.detail.placedOn")} value={fullDateTime(order.createdAt)} />
            <InfoRow label={t("orders.detail.status")} chip={t(STATUS_LABEL[order.status])} chipClass={STATUS_STYLE[order.status]} />
            {order.billId ? <InfoRow label={t("orders.detail.linkedBill")} value={order.billId.length > 14 ? `…${order.billId.slice(-10)}` : order.billId} mono /> : null}
          </SideCard>

          {/* Order summary */}
          <SideCard title={t("orders.detail.orderSummary")}>
            <InfoRow label={t("orders.detail.totalItems")} value={order.itemCount === 1 ? t("orders.detail.itemsQty", { count: order.itemCount, qty: totalQty }) : t("orders.detail.itemsQtyPlural", { count: order.itemCount, qty: totalQty })} />
            <InfoRow label={t("orders.detail.estimatedAmount")} value={fmtRs(order.estimatedTotal)} />
            <div className="mt-2 flex items-center justify-between border-t border-[#eef2f8] pt-2.5">
              <span className="text-[13px] font-black text-[var(--brand-ink)]">{t("orders.detail.grandTotal")}</span>
              <span className="font-display text-[16px] font-black text-[var(--brand)]">{fmtRs(order.estimatedTotal)}</span>
            </div>
            <p className="mt-1 text-[10.5px] text-[#8290a8]">{t("orders.detail.estimatedNote")}</p>
          </SideCard>

          {order.feedbackRating ? (
            <SideCard title="Guest feedback">
              <p className="text-[18px] tracking-wider text-amber-500" aria-label={`${order.feedbackRating} out of 5 stars`}>
                {"★".repeat(order.feedbackRating)}{"☆".repeat(5 - order.feedbackRating)}
              </p>
              {order.feedbackComment ? <p className="mt-2 text-[12.5px] leading-snug text-[#5b6b85]">“{order.feedbackComment}”</p> : null}
              {order.feedbackAt ? <p className="mt-1 text-[10.5px] text-[#8290a8]">Received {fullDateTime(order.feedbackAt)}</p> : null}
            </SideCard>
          ) : null}

          {/* Notes */}
          <SideCard title={t("orders.detail.notes")}>
            {order.note ? (
              <p className="flex items-start gap-1.5 text-[12.5px] italic leading-snug text-[#5b6b85]">
                <StickyNote size={13} className="mt-0.5 shrink-0 text-[#c2410c]" /> "{order.note}"
              </p>
            ) : (
              <p className="text-[12px] text-[#9aa7bd]">{t("orders.detail.noNotes")}</p>
            )}
          </SideCard>

          {/* Quick actions */}
          <SideCard title={t("orders.detail.quickActions")}>
            <div className="grid grid-cols-3 gap-2">
              <QuickAction icon={<ShoppingCart size={16} />} label={t("orders.row.openInBilling")} disabled={!active || opening} onClick={onAcceptBill} />
              <QuickAction icon={<MessageCircle size={16} />} label={t("orders.detail.whatsapp")} onClick={onMessage} />
              <QuickAction icon={<Printer size={16} />} label={t("orders.detail.printSlip")} onClick={onPrint} />
              <QuickAction icon={<Copy size={16} />} label={t("orders.detail.copyDetails")} onClick={onCopy} />
              <QuickAction icon={<PackageCheck size={16} />} label={order.status === "accepted" ? t("orders.detail.markReady") : order.status === "ready" ? t("orders.detail.complete") : t("orders.detail.nextStatus")} disabled={!active || mutationPending || order.status === "new"} onClick={order.status === "accepted" ? onMarkReady : onMarkDone} />
              <QuickAction icon={<XCircle size={16} />} label={t("orders.detail.reject")} tone="danger" disabled={!active || mutationPending} onClick={onReject} />
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

const STEPS: ReadonlyArray<{ labelKey: TranslationKey }> = [
  { labelKey: "orders.step.received" },
  { labelKey: "orders.step.confirm" },
  { labelKey: "orders.step.ready" },
  { labelKey: "orders.step.completed" },
];

function FulfillmentStepper({ order }: { order: CustomerOrder }) {
  const { t } = useAppLanguage();
  // First step that is NOT done: new → confirm(1); accepted → bill(2); fulfilled → past the end.
  const currentIndex = order.status === "new" ? 1 : order.status === "accepted" ? 2 : order.status === "ready" ? 3 : STEPS.length;

  return (
    <div>
      <div className="grid grid-cols-4">
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const activeStep = i === currentIndex;
          return (
            <div key={step.labelKey} className="relative flex justify-center">
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
            : done ? (i === STEPS.length - 1 ? timeAgo(t, order.updatedAt) : t("orders.step.done"))
            : activeStep ? (i === 1 ? t("orders.step.nextStep") : t("orders.step.openInBilling"))
            : t("orders.step.pending");
          return (
            <div key={step.labelKey} className="px-1">
              <p className={`text-[11px] font-black leading-tight ${done || activeStep ? "text-[var(--brand-ink)]" : "text-[#9aa7bd]"}`}>{t(step.labelKey)}</p>
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
