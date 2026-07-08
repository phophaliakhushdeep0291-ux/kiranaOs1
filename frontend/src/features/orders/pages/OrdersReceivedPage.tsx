import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Inbox, MapPin, MessageCircle, Phone, RefreshCw, ShoppingCart, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/features/auth/useAuth";
import { useListProducts } from "@/lib/api/client";
import { offlineDB } from "@/lib/offline/db";
import { HELD_BILLS_KEY, upsertOpenBill, billFromImportedCart } from "@/features/billing/pages/open-bills";
import type { HeldBill } from "@/features/billing/pages/billing-types";
import { alertCustomerOnWhatsapp } from "../notify";
import { listCustomerOrders, updateCustomerOrder, type CustomerOrder } from "../api";

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: "new", label: "New" },
  { value: "accepted", label: "Accepted" },
  { value: "fulfilled", label: "Done" },
  { value: "all", label: "All" },
];

const STATUS_STYLE: Record<CustomerOrder["status"], string> = {
  new: "bg-[#eaf2ff] text-[#075fff]",
  accepted: "bg-[#fff7ed] text-[#c2410c]",
  fulfilled: "bg-[#e9fbf0] text-[#16a34a]",
  rejected: "bg-[#f1f5f9] text-[#64748b]",
};

const fmtRs = (n: number) => `Rs ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function OrdersReceivedPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { shop } = useAuth();
  const shopName = shop?.name ?? "";
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("new");

  const ordersQuery = useQuery({
    queryKey: ["customer-orders", status],
    queryFn: () => listCustomerOrders(status),
    refetchInterval: 30_000, // poll so new customer orders surface without a manual refresh
  });

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
    void loadIntoBilling(order);
  }

  /** Standalone "let the customer know it's ready" — no state change, just opens WhatsApp. */
  function messageCustomer(order: CustomerOrder, kind: "received" | "ready") {
    const { targetedCustomer } = alertCustomerOnWhatsapp(order, shopName, kind);
    if (!targetedCustomer) {
      toast({ title: "Opened WhatsApp", description: "Pick the customer's chat to send the message." });
    }
  }

  async function loadIntoBilling(order: CustomerOrder) {
    const { bill, matched, skipped } = billFromImportedCart(
      products,
      order.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      { label: `${order.customerName} (order)`, sourceOrderId: order.id },
    );
    if (matched === 0) {
      toast({ title: "No matching products", description: "These items are not in your catalog anymore.", variant: "destructive" });
      return;
    }
    const withCustomer: HeldBill = { ...bill, customerName: order.customerName, customerMobile: order.customerMobile };
    const current = (await offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null)) ?? [];
    await offlineDB.setSetting(HELD_BILLS_KEY, upsertOpenBill(current, withCustomer)).catch(() => undefined);
    statusMutation.mutate({ id: order.id, next: "accepted" });
    toast({
      title: "Order sent to Billing",
      description: `${matched} item${matched === 1 ? "" : "s"} ready — adjust the amount and save the final bill${skipped.length ? ` · ${skipped.length} unavailable` : ""}.`,
    });
    navigate("/billing");
  }

  const orders = ordersQuery.data?.orders ?? [];

  return (
    <div className="app-docked-page mx-auto max-w-3xl px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-black text-[#0f1e3d]">Orders Received</h1>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">Orders customers sent from your QR page. Open one in Billing to edit items, rates, and payment before saving.</p>
        </div>
        <button
          type="button"
          onClick={() => void ordersQuery.refetch()}
          className="grid h-9 w-9 place-items-center rounded-lg border border-[#dfe7f2] text-[#405273] hover:bg-[#f7faff]"
          aria-label="Refresh orders"
        >
          <RefreshCw size={16} className={ordersQuery.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
              status === tab.value ? "bg-[#075fff] text-white" : "border border-[#dfe7f2] bg-white text-[#536383] hover:bg-[#f7faff]"
            }`}
          >
            {tab.label}
            {tab.value === "new" && (ordersQuery.data?.newCount ?? 0) > 0 ? ` (${ordersQuery.data?.newCount})` : ""}
          </button>
        ))}
      </div>

      {ordersQuery.isLoading ? (
        <p className="py-16 text-center text-sm text-[#8290a8]">Loading orders...</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#eef2f8] text-[#94a3b8]"><Inbox size={26} /></div>
          <p className="mt-3 text-sm font-semibold text-[#536383]">No {status === "all" ? "" : status} orders</p>
          <p className="mt-1 max-w-xs text-[12px] text-[#8290a8]">When a customer scans your Order QR and sends an order, it shows up here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id} className="rounded-2xl border border-[#e6ecf4] bg-white p-4 shadow-[0_6px_20px_rgba(15,35,80,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-[#13254a]">{order.customerName}</p>
                  <a href={`tel:${order.customerMobile}`} className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#075fff]">
                    <Phone size={12} /> {order.customerMobile}
                  </a>
                  {order.customerAddress ? (
                    <p className="mt-1 flex items-start gap-1 text-[12px] text-[#5b6b85]"><MapPin size={12} className="mt-0.5 shrink-0" /> {order.customerAddress}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[order.status]}`}>{order.status}</span>
                  <p className="mt-1 text-[10px] font-semibold text-[#8290a8]">{timeAgo(order.createdAt)}</p>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-[#eef2f8] bg-[#f9fbfe] p-2.5">
                {order.items.map((it) => (
                  <div key={it.productId} className="flex items-center justify-between py-0.5 text-[12.5px]">
                    <span className="min-w-0 truncate text-[#334364]"><span className="font-bold">{it.qty}x</span> {it.name}</span>
                    <span className="shrink-0 font-semibold text-[#64748b]">{fmtRs(it.qty * it.price)}</span>
                  </div>
                ))}
                <div className="mt-1.5 flex items-center justify-between border-t border-[#e7edf5] pt-1.5 text-[13px] font-black text-[#0f1e3d]">
                  <span>Estimated total</span><span>{fmtRs(order.estimatedTotal)}</span>
                </div>
              </div>
              {order.note ? <p className="mt-2 text-[12px] italic text-[#6b7a93]">"{order.note}"</p> : null}

              {order.status !== "rejected" && order.status !== "fulfilled" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => acceptAndBill(order)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#075fff] px-3 py-2 text-[12px] font-bold text-white shadow-sm"
                  >
                    <ShoppingCart size={14} /> Open in Billing
                  </button>
                  <button
                    type="button"
                    onClick={() => messageCustomer(order, order.status === "accepted" ? "ready" : "received")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#bfe6cd] bg-[#f0fbf4] px-3 py-2 text-[12px] font-bold text-[#16a34a]"
                  >
                    <MessageCircle size={14} /> Message
                  </button>
                  <button
                    type="button"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: order.id, next: "fulfilled" })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#dbe3ee] bg-white px-3 py-2 text-[12px] font-bold text-[#405273]"
                  >
                    <CheckCircle2 size={14} /> Mark done
                  </button>
                  <button
                    type="button"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: order.id, next: "rejected" })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#f0d5d5] bg-[#fff5f5] px-3 py-2 text-[12px] font-bold text-[#e11d48]"
                  >
                    <XCircle size={14} /> Reject
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
