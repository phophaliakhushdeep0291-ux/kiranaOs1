import { offlineDB } from "@/lib/offline/db";
import {
  BILLING_DRAFT_KEY,
  HELD_BILLS_KEY,
  billingDraftFromHeldBill,
  heldBillFromBillingDraft,
  newBillId,
  upsertOpenBill,
} from "@/features/core/billing/pages/open-bills";
import type { BillingDraft, HeldBill } from "@/features/core/billing/pages/billing-types";
import { loadTableBills, reconcileTableBills, saveTableBills, type RestaurantTable } from "./table-store";

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
    offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
    offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY).catch(() => null),
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
    held = upsertOpenBill(held, bill);
    map[table.id] = bill.id;
  }

  await Promise.all([
    offlineDB.setSetting(HELD_BILLS_KEY, held).catch(() => undefined),
    offlineDB.setSetting(BILLING_DRAFT_KEY, billingDraftFromHeldBill(bill)).catch(() => undefined),
    saveTableBills(map),
  ]);
  return bill;
}

/**
 * Clear a table without billing it — a walk-out, or an order rung up on the
 * wrong table. The parked cart goes with it, because leaving it in the switcher
 * is how a stale cart later gets settled against the wrong meal.
 */
export async function releaseTable(tableId: string): Promise<void> {
  const [heldRaw, draft, map] = await Promise.all([
    offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
    offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY).catch(() => null),
    loadTableBills(),
  ]);
  const billId = map[tableId];
  if (!billId) return;

  const held = (Array.isArray(heldRaw) ? heldRaw : []).filter((entry) => entry.id !== billId);
  delete map[tableId];

  const writes: Array<Promise<unknown>> = [
    offlineDB.setSetting(HELD_BILLS_KEY, held).catch(() => undefined),
    saveTableBills(map),
  ];
  // If the released table is the cart on screen, empty the workspace too, or the
  // till would still be holding the order that was just cleared.
  if (draft?.activeBillId === billId) {
    writes.push(offlineDB.delete("settings", BILLING_DRAFT_KEY).catch(() => undefined));
  }
  await Promise.all(writes);
}
