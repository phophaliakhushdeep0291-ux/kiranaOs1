import { registerSettleCheck, type SettleCheckContext, type SettleWarning } from "@/features/core/billing/settle-checks";
import { listKitchenTickets } from "./service/restaurant-api";
import { pendingKotLines, type KotTicket } from "./service/table-store";

/**
 * Do not take the money for food the kitchen was never told about.
 *
 * Firing is manual, and should stay that way — a guest's order reaching the pass
 * unattended is how a cancelled table still gets cooked. But nothing connected
 * that to the till. A table sitting there reading "2 to fire" settled without a
 * word, and in a run of four tables two were paid in full with no ticket ever
 * raised against them: the guests bought food nobody had been asked to cook, and
 * their own tracking page then read "Being cooked" indefinitely, because order
 * progress is driven by the ticket that never existed.
 *
 * It warns rather than refuses. The cashier is standing in front of the guest,
 * and on a quiet evening the kitchen may well have been told out loud.
 *
 * Only a table's tab is checked. A counter or takeaway sale has no floor to fire
 * from, so there is nothing here to be wrong about.
 */
export async function unfiredKitchenLines(context: SettleCheckContext): Promise<SettleWarning | null> {
  if (!context.tableId || !context.cart.length) return null;

  // Every till's tickets, not this one's: the tally is only right if it can see
  // what the other counter already sent. Scoped to this bill, because a table
  // reused all evening carries the previous party's tickets too.
  const tickets = await listKitchenTickets({ includeServed: true }) as KotTicket[];
  const pending = pendingKotLines(context.cart, tickets.filter((ticket) => ticket.billId === context.billId));
  if (!pending.length) return null;

  return {
    title: { key: "restaurant.settle.unfiredTitle", vars: { count: pending.length } },
    body: { key: "restaurant.settle.unfiredBody", vars: { items: pending.map((line) => `${line.qty}× ${line.name}`).join(", ") } },
    confirm: { key: "restaurant.settle.unfiredConfirm" },
  };
}

registerSettleCheck({ id: "restaurant/unfired-kot", run: unfiredKitchenLines });
