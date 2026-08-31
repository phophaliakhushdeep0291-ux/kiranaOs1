import { offlineDB } from "@/lib/offline/db";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY, newBillId, upsertOpenBill, wouldEvictOpenBill } from "@/features/core/billing/pages/open-bills";
import { cartItemKey, type BillingDraft, type CartItem, type HeldBill } from "@/features/core/billing/pages/billing-types";
import { updateCustomerOrder, type CustomerOrder } from "@/features/core/orders/api";
import type { MenuDish, Product } from "@/types/api";
import { TABLE_BILLS_KEY, type RestaurantTable } from "./table-store";

/**
 * A guest's own order, joined to the table they are sitting at.
 *
 * The guest's phone talks to the server; the table's running order lives on this
 * till. This is the join, and the reason it is a deliberate action rather than a
 * background merge: what a guest sends is a request, and a restaurant accepts it
 * the way it accepts one spoken across a counter. A kitchen that discovers food
 * on its pass that nobody chose to accept has lost control of its own service.
 *
 * Accepting adds the lines to that table's parked cart — the same cart a waiter
 * would have keyed — so the meal settles through the ordinary billing path with
 * one bill at the end, whoever put each line on it.
 */

/** Which guest orders have already been added, so accepting twice cannot double a table's food. */
export const ACCEPTED_GUEST_ORDERS_KEY = "kirana-os:restaurant:accepted-guest-orders:v1";
const MAX_ACCEPTED_GUEST_ORDER_IDS = 500;

export const PENDING_GUEST_ORDERS_KEY = "kirana-os:restaurant:pending-guest-orders:v1";
interface PendingAcceptance {
  key: string;
  order: CustomerOrder;
  table: RestaurantTable;
  lines: CartItem[];
}

export async function loadPendingGuestOrders(): Promise<CustomerOrder[]> {
  const pending = await offlineDB.getSetting<Record<string, PendingAcceptance>>(PENDING_GUEST_ORDERS_KEY);
  return Object.values(pending ?? {}).map((entry) => entry.order);
}

export async function loadAcceptedOrderIds(): Promise<string[]> {
  const rows = await offlineDB.getSetting<string[]>(ACCEPTED_GUEST_ORDERS_KEY);
  return Array.isArray(rows) ? rows : [];
}

export async function rememberAcceptedOrder(orderId: string): Promise<void> {
  const current = await loadAcceptedOrderIds();
  if (current.includes(orderId)) return;
  await offlineDB
    .setSetting(ACCEPTED_GUEST_ORDERS_KEY, [orderId, ...current].slice(0, MAX_ACCEPTED_GUEST_ORDER_IDS));
}

/** Dine-in orders a guest has sent and the floor has not yet taken. */
export function pendingGuestOrders(orders: CustomerOrder[], acceptedIds: string[]): CustomerOrder[] {
  const accepted = new Set(acceptedIds);
  return orders
    .filter((order) => order.fulfillmentType === "dine_in" && Boolean(order.tableId))
    .filter((order) => order.status === "new")
    .filter((order) => !accepted.has(order.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Turn a guest's order lines into cart lines.
 *
 * Prices come from the server's validated order snapshot, never the guest's
 * submitted amount. A catalogue change after placement must not change the quote.
 */
export function guestOrderCartLines(order: CustomerOrder, products: Product[], _menuDishes: MenuDish[] = []): {
  lines: CartItem[];
  skipped: string[];
} {
  const byId = new Map<string, Product>();
  for (const product of products) {
    byId.set(product.id, product);
    // An offline-first catalogue can still be keyed by its local id, so match on
    // the server identity too or a synced product's lines would all be dropped.
    const serverId = (product as Product & { serverId?: string }).serverId;
    if (serverId && !byId.has(serverId)) byId.set(serverId, product);
  }

  const lines: CartItem[] = [];
  const skipped: string[] = [];
  for (const [itemIndex, item] of (order.items ?? []).entries()) {
    const product = byId.get(item.productId);
    if (!product) {
      skipped.push(item.name || item.productId);
      continue;
    }
    const quantity = Number(item.qty) > 0 ? Number(item.qty) : 1;
    const sellingUnit = item.variation?.unitCode
      ? (product.sellingUnits ?? []).find((unit) => unit.unitCode === item.variation?.unitCode && unit.isActive !== false)
      : undefined;
    if (item.variation && !sellingUnit) {
      skipped.push(`${item.name}: portion unavailable`);
      continue;
    }
    const addons = (item.addons ?? []).map((addon) => ({ ...addon }));
    const addonTotal = addons.reduce((sum, addon) => sum + addon.price * (addon.quantity ?? 1), 0);
    const rate = Number(item.basePrice ?? item.variation?.price ?? (item.price - addonTotal));
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0) {
      skipped.push(`${item.name}: invalid price or quantity`);
      continue;
    }
    lines.push({
      product,
      quantity,
      rate,
      manualRate: true,
      guestSnapshot: true,
      guestOrderId: order.id,
      guestOrderLineId: item.lineId ?? `${order.id}-${itemIndex}`,
      unit: item.unit || sellingUnit?.name || product.rateUnit || product.displayUnit || "piece",
      sellingUnit,
      addons,
      // Carried onto the line so the kitchen ticket shows what the guest asked
      // for. A note typed on a phone is the only thing they could not say aloud.
      note: [item.note, order.note].filter(Boolean).join(" — ") || undefined,
    });
  }
  return { lines, skipped };
}

/**
 * Merge lines into a cart, adding quantity to a line that is already there.
 *
 * A guest who orders two more naan should see one line of four, not two lines of
 * two — and it matters beyond tidiness: the kitchen ticket counts what is
 * outstanding per line, so a split line would fire the same naan twice.
 */
export function mergeCartLines(existing: CartItem[], incoming: CartItem[]): CartItem[] {
  const merged = [...existing];
  for (const line of incoming) {
    const lineKey = cartItemKey(line);
    const match = merged.findIndex((row) => cartItemKey(row) === lineKey);
    if (match >= 0) {
      merged[match] = { ...merged[match], quantity: merged[match].quantity + line.quantity };
    } else {
      merged.push(line);
    }
  }
  return merged;
}

async function assertTableImportSafe(tableId: string) {
  const held = await offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY) ?? [];
  const map = await offlineDB.getSetting<Record<string, string>>(TABLE_BILLS_KEY) ?? {};
  const draft = await offlineDB.getSetting<BillingDraft>(BILLING_DRAFT_KEY);
  if (map[tableId] && draft?.activeBillId === map[tableId]) {
    throw new Error("Park this table's active bill before accepting more food. Keep billing closed in other tabs.");
  }
  if (wouldEvictOpenBill(held, { id: map[tableId] ?? "new-guest-bill" })) {
    throw new Error("The open-bill limit is reached. Settle an existing bill before accepting another table.");
  }
}

export interface AcceptGuestOrderResult {
  billId: string;
  added: number;
  skipped: string[];
}

/**
 * Put a guest's order on their table's running bill.
 *
 * Deliberately does NOT switch the billing workspace to that table: a waiter is
 * usually mid-way through ringing up somebody else, and yanking the screen out
 * from under them to show a different table's cart is how the wrong order gets
 * settled. The table lights up on the floor screen instead, and whoever is free
 * opens it.
 */
export async function acceptGuestOrderToTable(
  order: CustomerOrder,
  table: RestaurantTable,
  products: Product[],
): Promise<AcceptGuestOrderResult> {
  // Journal BEFORE the network call. A timeout or restart retains the same key
  // and snapshot. Concurrent tabs share the IndexedDB transaction, not a mutex
  // in one React component. Never keep a DB transaction open across the network.
  const operation = await offlineDB.transaction(["settings"], async (tx) => {
    const accepted = await loadAcceptedOrderIds();
    if (accepted.includes(order.id)) return null;
    const pending = await offlineDB.getSetting<Record<string, PendingAcceptance>>(PENDING_GUEST_ORDERS_KEY) ?? {};
    await assertTableImportSafe(table.id);
    if (pending[order.id]) return pending[order.id];
    const { lines, skipped } = guestOrderCartLines(order, products);
    if (!lines.length || skipped.length) {
      throw new Error(`Order not accepted. Refresh the catalogue: ${skipped.join(", ") || "no items available"}.`);
    }
    const entry = { key: crypto.randomUUID(), order, table, lines };
    await tx.setSetting(PENDING_GUEST_ORDERS_KEY, { ...pending, [order.id]: entry });
    return entry;
  });
  if (!operation) return { billId: "", added: 0, skipped: [] };

  let canonical: CustomerOrder;
  try {
    canonical = await updateCustomerOrder(order.id, { status: "accepted", acceptanceKey: operation.key });
  } catch (error) {
    const failure = error as { status?: number; data?: { code?: string } };
    // Only a definitive server rejection can retire the journal. A timeout,
    // lost reply or storage failure must keep the operation available to retry.
    if (failure.status === 409 && failure.data?.code === "ORDER_ALREADY_CLAIMED") {
      await offlineDB.transaction(["settings"], async (tx) => {
        const pending = await offlineDB.getSetting<Record<string, PendingAcceptance>>(PENDING_GUEST_ORDERS_KEY) ?? {};
        if (pending[order.id]?.key === operation.key) {
          delete pending[order.id];
          await tx.setSetting(PENDING_GUEST_ORDERS_KEY, pending);
        }
      });
    }
    throw error;
  }

  // A guest may cancel a dish between the inbox refresh and this acceptance.
  // The server's atomic claim freezes the final snapshot. Never import the
  // stale pre-claim journal, including on a retry after a lost response.
  //
  // The table is checked against what the SERVER said when we journalled, not
  // against `operation.table.id`. Those are two different namespaces on purpose:
  // the till owns its floor-plan ids (they key the table -> open-bill map, and
  // rewriting them would drop every seating on the floor) while the server owns
  // the QR code a guest's phone resolves — see syncFloorCodes in TablesPage.
  // Comparing them meant every QR order failed here AFTER the server had already
  // been told "accepted": no bill, nothing fired to the kitchen, and the card
  // stuck in the inbox with a guest sitting at the table waiting. The tests did
  // not catch it because their fixture gave the table and the order the same id,
  // which production never does.
  if (canonical.id !== operation.order.id || canonical.tableId !== operation.order.tableId
    || canonical.status !== "accepted" || !Array.isArray(canonical.items)) {
    throw new Error("Could not confirm the accepted order. Refresh and retry before adding food.");
  }
  const confirmed = guestOrderCartLines(canonical, products);
  if (!confirmed.lines.length || confirmed.skipped.length) {
    throw new Error(`Order accepted but not added. Refresh the catalogue and retry: ${confirmed.skipped.join(", ") || "no items available"}.`);
  }

  return offlineDB.transaction(["settings"], async (tx) => {
    const accepted = await loadAcceptedOrderIds();
    if (accepted.includes(order.id)) return { billId: "", added: 0, skipped: [] };
    const held = await offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY) ?? [];
    const map = await offlineDB.getSetting<Record<string, string>>(TABLE_BILLS_KEY) ?? {};
    const pending = await offlineDB.getSetting<Record<string, PendingAcceptance>>(PENDING_GUEST_ORDERS_KEY) ?? {};
    const target = operation.table;
    await assertTableImportSafe(target.id);
    const existing = held.find((entry) => entry.id === map[target.id]);
    const bill: HeldBill = existing
      ? { ...existing, tableId: target.id, cart: mergeCartLines(existing.cart ?? [], confirmed.lines) }
      : { id: newBillId(), label: `${target.name} • table`, createdAt: new Date().toISOString(),
          cart: confirmed.lines, selectedCustomerId: "walk_in", customerName: target.name, tableId: target.id };
    delete pending[order.id];
    await tx.setSetting(HELD_BILLS_KEY, upsertOpenBill(held, bill));
    await tx.setSetting(TABLE_BILLS_KEY, { ...map, [target.id]: bill.id });
    await tx.setSetting(ACCEPTED_GUEST_ORDERS_KEY, [order.id, ...accepted].slice(0, MAX_ACCEPTED_GUEST_ORDER_IDS));
    await tx.setSetting(PENDING_GUEST_ORDERS_KEY, pending);
    return { billId: bill.id, added: confirmed.lines.length, skipped: [] };
  });
}
