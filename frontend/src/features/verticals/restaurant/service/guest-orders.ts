import { offlineDB } from "@/lib/offline/db";
import { HELD_BILLS_KEY, newBillId, upsertOpenBill } from "@/features/core/billing/pages/open-bills";
import { productSellingPrice } from "@/features/core/billing/pages/billing-calculations";
import { cartItemKey, type CartItem, type HeldBill } from "@/features/core/billing/pages/billing-types";
import type { CustomerOrder } from "@/features/core/orders/api";
import type { MenuDish, Product } from "@/types/api";
import { loadTableBills, saveTableBills, type RestaurantTable } from "./table-store";
import { getMenuBoard } from "./restaurant-api";

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

/** Kept short: this only has to outlive one service, not one shop. */
const MAX_REMEMBERED = 300;

export async function loadAcceptedOrderIds(): Promise<string[]> {
  const rows = await offlineDB.getSetting<string[]>(ACCEPTED_GUEST_ORDERS_KEY).catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

export async function rememberAcceptedOrder(orderId: string): Promise<void> {
  const current = await loadAcceptedOrderIds();
  if (current.includes(orderId)) return;
  await offlineDB
    .setSetting(ACCEPTED_GUEST_ORDERS_KEY, [orderId, ...current].slice(0, MAX_REMEMBERED))
    .catch(() => undefined);
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
 * The price is re-read from this shop's own catalogue rather than taken from the
 * order. The server already re-priced it once when the guest sent it, and this
 * re-prices it again at the till — because between the two a rate may have moved,
 * and the number the customer pays must be the shop's current one, not a figure
 * that travelled through a phone.
 */
export function guestOrderCartLines(order: CustomerOrder, products: Product[], menuDishes: MenuDish[] = []): {
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
  const menuById = new Map(menuDishes.map((dish) => [dish.id, dish]));
  for (const item of order.items ?? []) {
    const product = byId.get(item.productId);
    if (!product) {
      skipped.push(item.name || item.productId);
      continue;
    }
    const quantity = Number(item.qty) > 0 ? Number(item.qty) : 1;
    const sellingUnit = item.variation?.unitCode
      ? (product.sellingUnits ?? []).find((unit) => unit.unitCode === item.variation?.unitCode && unit.isActive !== false)
      : undefined;
    const dish = menuById.get(product.id);
    const currentOptions = new Map((dish?.addonGroups ?? []).flatMap((group) => group.options.map((option) => [option.id, { ...option, groupName: group.name }] as const)));
    const addons = (item.addons ?? []).map((addon) => {
      const current = currentOptions.get(addon.optionId);
      return {
        optionId: addon.optionId,
        groupName: current?.groupName ?? addon.groupName,
        name: current?.name ?? addon.name,
        price: current?.price ?? addon.price,
        quantity: addon.quantity,
      };
    });
    lines.push({
      product,
      quantity,
      rate: sellingUnit ? Number(sellingUnit.defaultPrice ?? 0) : productSellingPrice(product, quantity),
      unit: sellingUnit?.name ?? product.rateUnit ?? product.displayUnit ?? "piece",
      sellingUnit,
      addons,
      // Carried onto the line so the kitchen ticket shows what the guest asked
      // for. A note typed on a phone is the only thing they could not say aloud.
      note: order.note ? order.note.slice(0, 120) : undefined,
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
  const board = await getMenuBoard().catch(() => null);
  const menuDishes = board?.courses.flatMap((section) => section.dishes) ?? [];
  const { lines, skipped } = guestOrderCartLines(order, products, menuDishes);

  const [heldRaw, map] = await Promise.all([
    offlineDB.getSetting<HeldBill[]>(HELD_BILLS_KEY).catch(() => null),
    loadTableBills(),
  ]);
  let held = Array.isArray(heldRaw) ? heldRaw : [];

  const existingId = map[table.id];
  const existing = held.find((entry) => entry.id === existingId) ?? null;
  const bill: HeldBill = existing
    ? { ...existing, cart: mergeCartLines(existing.cart ?? [], lines) }
    : {
      id: newBillId(),
      label: `${table.name} • table`,
      createdAt: new Date().toISOString(),
      cart: lines,
      selectedCustomerId: "walk_in",
      customerName: table.name,
    };

  held = upsertOpenBill(held, bill);
  map[table.id] = bill.id;

  await Promise.all([
    offlineDB.setSetting(HELD_BILLS_KEY, held).catch(() => undefined),
    saveTableBills(map),
    rememberAcceptedOrder(order.id),
  ]);

  return { billId: bill.id, added: lines.length, skipped };
}
