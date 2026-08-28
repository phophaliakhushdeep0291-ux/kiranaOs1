import { useCallback, useEffect, useState } from "react";
import { QrCode, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { listCustomerOrders, type CustomerOrder } from "@/features/core/orders/api";
import { useListProducts } from "@/features/core/products/queries";
import { loadFloorPlan, type RestaurantTable } from "../../service/table-store";
import { acceptGuestOrderToTable, loadAcceptedOrderIds, loadPendingGuestOrders, pendingGuestOrders } from "../../service/guest-orders";

/**
 * Orders guests sent from the QR on their own table.
 *
 * Shown as something waiting to be TAKEN rather than as work already on the
 * pass. A restaurant that lets a stranger's phone put food on its kitchen screen
 * unattended has handed out its service; a restaurant that never sees the order
 * until someone walks past the table has gained nothing from the QR. So the
 * order arrives here, visibly, and one tap puts it on that table's running bill
 * — where a waiter's own keying would have put it.
 *
 * Silent when there is nothing waiting, which for most of a shift is the case:
 * a strip that is always on screen is a strip nobody reads.
 */

const POLL_MS = 20_000;

export function GuestOrdersStrip({ onAccepted, readOnly = false }: { onAccepted?: () => void; readOnly?: boolean }) {
  const { toast } = useToast();
  const { t } = useAppLanguage();
  // The counter's own catalogue hook, deliberately. Swapping it for a lighter
  // read here was measured and made things WORSE: it broke the import edge that
  // keeps the public dine-in menu grouped with this trade's lazy chunks, and
  // Rollup folded that page into the startup shell instead — putting 45 kB of
  // restaurant guest menu into every kirana shop's first load. Chunking is a
  // whole-graph optimisation; do not change what this imports without
  // re-running `npm run bundle:check` and reading where the entry landed.
  const products = useListProducts();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [response, accepted, plan, pending] = await Promise.all([
        listCustomerOrders("new"),
        loadAcceptedOrderIds(),
        loadFloorPlan(),
        loadPendingGuestOrders(),
      ]);
      setTables(plan);
      const unique = new Map([...pendingGuestOrders(response.orders ?? [], accepted), ...pending].map((order) => [order.id, order]));
      setOrders([...unique.values()]);
      setLoadFailed(false);
    } catch {
      // Retain the last cards; clearing them would make a network outage look
      // exactly like the counter accepted every waiting order.
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    const safeRefresh = () => { void refresh(); };
    safeRefresh();
    const timer = window.setInterval(safeRefresh, POLL_MS);
    const onFocus = safeRefresh;
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, toast, t]);

  async function accept(order: CustomerOrder) {
    if (readOnly) return;
    // QR orders now carry the server table id. Name remains a compatibility
    // fallback for orders created before that field was introduced.
    const table = tables.find((row) => row.id === order.tableId)
      ?? tables.find((row) => row.name === order.tableName);
    if (!table) {
      toast({
        title: `No table called ${order.tableName ?? "that"} on this floor`,
        description: t("restaurant.guest.noTableHelp"),
        variant: "destructive",
      });
      return;
    }
    setBusyId(order.id);
    try {
      const result = await acceptGuestOrderToTable(order, table, products.data ?? []);
      await refresh();
      onAccepted?.();
      toast({
        title: `Added to ${table.name}`,
        description: result.skipped.length > 0
          ? `${result.added} item${result.added === 1 ? "" : "s"} added. Not in your catalogue: ${result.skipped.join(", ")}.`
          : `${result.added} item${result.added === 1 ? "" : "s"} are on the table's bill. Fire them from the Tables screen.`,
      });
    } catch (err) {
      toast({
        title: t("restaurant.guest.acceptFailed"),
        description: `${err instanceof Error ? err.message : ""} ${t("restaurant.guest.retry")}`,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (orders.length === 0 && !loadFailed) return null;

  return (
    <section className="space-y-2" data-testid="guest-orders-strip">
      {loadFailed ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{t("restaurant.guest.ordersStale")} <button type="button" className="ml-2 min-h-11 underline" onClick={() => void refresh()}>{t("restaurant.guest.retryNow")}</button></div> : null}
      {orders.length > 0 ? <>
      <h2 className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-[#64748b]">
        <QrCode size={13} /> Guests have ordered
        <span className={cn("rounded-full px-2 py-0.5 text-[10px]", CHIP_TONES.violet)}>{orders.length}</span>
      </h2>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {orders.map((order) => (
          <article key={order.id} className="rounded-2xl border border-[#ddd6fe] bg-[#faf8ff] p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="font-display text-[16px] font-black text-[var(--brand-ink)]">
                {order.tableName ?? "Table"}
              </div>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", CHIP_TONES.violet)}>
                from the QR
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {order.items.map((item) => (
                <li key={`${order.id}-${item.productId}`} className="flex justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate font-bold text-[var(--brand-ink)]">{item.name}</span>
                  <span className="shrink-0 font-black tabular-nums">×{item.qty}</span>
                </li>
              ))}
            </ul>
            {order.note ? (
              <p className="mt-1.5 rounded-lg bg-[#fff7ed] px-2 py-1 text-[11px] font-semibold text-[#9a3412]">{order.note}</p>
            ) : null}
            {order.promisedSlot ? (
              <p className="mt-1.5 rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800">{t("restaurant.guest.scheduled")} {order.promisedSlot}</p>
            ) : null}
            {readOnly ? <p className="mt-3 text-xs text-[#52627e]">{t("restaurant.guest.awaitingCounter")}</p> : <Button
              size="sm"
              className="mt-3 h-9 w-full gap-1.5 rounded-[8px] text-[12px] font-black"
              disabled={busyId !== null}
              data-testid={`accept-guest-order-${order.id}`}
              onClick={() => void accept(order)}
            >
              <Utensils size={13} /> {busyId === order.id ? "Adding…" : `Add to ${order.tableName ?? "table"}`}
            </Button>}
          </article>
        ))}
      </div>
      </> : null}
    </section>
  );
}
