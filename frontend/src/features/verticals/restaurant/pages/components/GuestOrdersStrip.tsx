import { useCallback, useEffect, useState } from "react";
import { QrCode, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHIP_TONES } from "@/lib/chip-tones";
import { useListProducts } from "@/features/core/products/queries";
import { listCustomerOrders, updateCustomerOrder, type CustomerOrder } from "@/features/core/orders/api";
import { loadFloorPlan, type RestaurantTable } from "../../service/table-store";
import { acceptGuestOrderToTable, loadAcceptedOrderIds, pendingGuestOrders } from "../../service/guest-orders";

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

export function GuestOrdersStrip({ onAccepted }: { onAccepted?: () => void }) {
  const { toast } = useToast();
  const products = useListProducts();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [response, accepted, plan] = await Promise.all([
      listCustomerOrders("new").catch(() => null),
      loadAcceptedOrderIds(),
      loadFloorPlan(),
    ]);
    if (!response) return;
    setOrders(pendingGuestOrders(response.orders, accepted));
    setTables(plan);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  async function accept(order: CustomerOrder) {
    // The table is matched by NAME rather than by id: the floor on this till is
    // its own, and the server's table row is a different record. The name is the
    // thing both sides agree on and the thing printed on the sticker.
    const table = tables.find((row) => row.name === order.tableName)
      ?? tables.find((row) => row.code && row.code === order.tableId);
    if (!table) {
      toast({
        title: `No table called ${order.tableName ?? "that"} on this floor`,
        description: "Add it to the floor plan, or take the order at the counter.",
        variant: "destructive",
      });
      return;
    }
    setBusyId(order.id);
    try {
      const result = await acceptGuestOrderToTable(order, table, products.data ?? []);
      // Told to the server too, so a second till does not offer the same order
      // again and the guest's tracker stops saying "sent".
      await updateCustomerOrder(order.id, { status: "accepted" }).catch(() => undefined);
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
        title: "Could not add that order",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (orders.length === 0) return null;

  return (
    <section className="space-y-2" data-testid="guest-orders-strip">
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
            <Button
              size="sm"
              className="mt-3 h-9 w-full gap-1.5 rounded-[8px] text-[12px] font-black"
              disabled={busyId === order.id}
              data-testid={`accept-guest-order-${order.id}`}
              onClick={() => void accept(order)}
            >
              <Utensils size={13} /> {busyId === order.id ? "Adding…" : `Add to ${order.tableName ?? "table"}`}
            </Button>
          </article>
        ))}
      </div>
    </section>
  );
}
