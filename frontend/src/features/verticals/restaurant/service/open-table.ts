import { offlineDB } from "@/lib/offline/db";
import {
  BILLING_DRAFT_KEY,
  HELD_BILLS_KEY,
  billingDraftFromHeldBill,
  heldBillFromBillingDraft,
  newBillId,
  upsertOpenBill,
  wouldEvictOpenBill,
} from "@/features/core/billing/pages/open-bills";
import type { BillingDraft, HeldBill } from "@/features/core/billing/pages/billing-types";
import { updateCustomerOrder } from "@/features/core/orders/api";
import { loadTableBills, reconcileTableBills, TABLE_BILLS_KEY, type RestaurantTable } from "./table-store";
import { listKitchenTickets, voidKitchenTicket } from "./restaurant-api";

/**
 * Seat a table in the billing workspace.
 *
 * Switching tables is the same move the counter's open-bills bar makes: park
 * whatever cart is loaded, then load the target one. Doing it through the same
 * two keys means a waiter can leave a table half-rung, serve someone at the
 * counter, and come back to it intact — and that the table's order is an
 * ordinary parked bill the till already knows how to settle.
 */
export async function openTableInBilling(table: RestaurantTable): Promise<HeldBill> {
  const [heldRaw, draft, mapRaw] = await Promise.all([
    offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY),
    offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY),
    loadTableBills(),
  ]);
  let held = Array.isArray(heldRaw) ? heldRaw : [];

  // Park the cart currently in the workspace so switching never drops it.
  const parked = heldBillFromBillingDraft(draft);
  if (parked) held = upsertOpenBill(held, parked);

  // The active bill has to be named, or reconciling drops it. An empty cart is
  // normally a finished table freeing itself — except for the one table being
  // rung up right now, whose waiter has seated a party and not yet keyed a
  // dish. Without this, opening that table a second time found no bill for it
  // and started another: two "T1 • table" entries in the switcher, one of them
  // orphaned with nothing pointing at it. TablesPage already passes this.
  const map = reconcileTableBills(mapRaw, held, draft?.activeBillId);
  const existingId = map[table.id];
  let bill = held.find((entry) => entry.id === existingId) ?? null;

  if (!bill) {
    bill = {
      id: newBillId(),
      label: `${table.name} • table`,
      createdAt: new Date().toISOString(),
      cart: [],
      selectedCustomerId: "walk_in",
      customerName: table.name,
    };
    /**
     * Refuse rather than evict.
     *
     * `upsertOpenBill` caps the set at MAX_OPEN_BILLS by dropping the oldest
     * entry, which for a floor at capacity is another table's running order —
     * seated, eaten, and now unbillable, while the table -> bill map still
     * points at a bill that no longer exists. That table then reconciles away
     * and reads as free.
     *
     * Guest-order acceptance already guards this (`assertTableImportSafe`);
     * seating from the floor screen did not, so a full house lost a table's
     * food to the eleventh party walking in. Saying no is recoverable; losing
     * an order silently is not.
     */
    if (wouldEvictOpenBill(held, bill)) {
      throw new Error(
        `Settle or clear a table before seating ${table.name}. The till is holding ${held.length} open bills, which is the most it can keep at once.`,
      );
    }
    held = upsertOpenBill(held, bill);
    map[table.id] = bill.id;
  }

  await offlineDB.transaction(["settings"], async (tx) => {
    await tx.setSetting(HELD_BILLS_KEY, held);
    await tx.setSetting(BILLING_DRAFT_KEY, billingDraftFromHeldBill(bill));
    await tx.setSetting(TABLE_BILLS_KEY, map);
  });
  return bill;
}

/**
 * Clear a table without billing it — a walk-out, or an order rung up on the
 * wrong table. The parked cart goes with it, because leaving it in the switcher
 * is how a stale cart later gets settled against the wrong meal.
 */
export async function releaseTable(tableId: string): Promise<void> {
  const [heldRaw, draft, map] = await Promise.all([
    offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY),
    offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY),
    loadTableBills(),
  ]);
  const billId = map[tableId];
  if (!billId) return;

  const held = (Array.isArray(heldRaw) ? heldRaw : []).filter((entry) => entry.id !== billId);
  delete map[tableId];

  await offlineDB.transaction(["settings"], async (tx) => {
    await tx.setSetting(HELD_BILLS_KEY, held);
    await tx.setSetting(TABLE_BILLS_KEY, map);
    // The transaction surface deliberately has no delete operation. An empty
    // draft is equivalent to a missing one and keeps all three writes atomic.
    if (draft?.activeBillId === billId) await tx.setSetting(BILLING_DRAFT_KEY, {});
  });
}

/**
 * Cancel all server-visible work before discarding the local table bill.
 *
 * A successful local clear must never leave a guest tracker saying "preparing"
 * or a KOT cooking on the pass. Server work is retired first; if any request
 * fails the local table remains occupied and the staff can safely retry.
 */
export async function cancelAndReleaseTable(tableId: string): Promise<{ cancelledOrders: number; voidedTickets: number }> {
  const [heldRaw, map] = await Promise.all([
    offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY),
    loadTableBills(),
  ]);
  const billId = map[tableId];
  if (!billId) return { cancelledOrders: 0, voidedTickets: 0 };
  const bill = (Array.isArray(heldRaw) ? heldRaw : []).find((entry) => entry.id === billId);
  const orderIds = [...new Set((bill?.cart ?? []).map((line) => line.guestOrderId).filter((id): id is string => Boolean(id)))];
  const tickets = await listKitchenTickets({ billId, fresh: true });

  for (const orderId of orderIds) {
    await updateCustomerOrder(orderId, { status: "cancelled" });
  }
  for (const ticket of tickets) {
    await voidKitchenTicket(ticket.id);
  }
  await releaseTable(tableId);
  return { cancelledOrders: orderIds.length, voidedTickets: tickets.length };
}
