import { offlineDB } from "@/lib/offline/db";
import { addonSummary, cartItemKey, type BillingDraft, type CartItem, type HeldBill } from "@/features/core/billing/pages/billing-types";
import { cartItemNet } from "@/features/core/billing/pages/billing-calculations";

/**
 * Table service and kitchen tickets for a restaurant.
 *
 * The order a table is running is not a new kind of document — it is the same
 * parked cart the counter already uses (`HeldBill`), so a table sale goes
 * through the tested billing pipeline: pricing, GST, split tender, offline
 * queue, sync. This module only answers "which table is that cart sitting at",
 * which is why it keeps a table -> held-bill map rather than a bill of its own.
 *
 * The consequence worth knowing: settling a table's bill removes it from the
 * held set, and the table frees itself. Nothing here has to observe the sale.
 *
 * Everything persists in this device's offline store; the kitchen screen says
 * so rather than implying a counter across the room is feeding it.
 */

export const FLOOR_PLAN_KEY = "kirana-os:restaurant:floor-plan:v1";
export const TABLE_BILLS_KEY = "kirana-os:restaurant:table-bills:v1";
export const KOT_TICKETS_KEY = "kirana-os:restaurant:kot:v1";

/** Tickets older than this are dropped on load — a day-old ticket is history, not work. */
export const KOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface RestaurantTable {
  id: string;
  name: string;
  /** Free-text area: "Ground floor", "Terrace", "AC hall". */
  section: string;
  seats: number;
  /**
   * What the table's QR sticker carries. Absent on a plan that has never been
   * published — a floor this device invented and the server has not seen, whose
   * tables therefore have nothing to print yet.
   */
  code?: string;
  /** Whether guests may order from this table's QR at all. */
  selfOrderEnabled?: boolean;
}

export type KotStatus = "new" | "preparing" | "ready" | "served";

export interface KotLine {
  guestOrderId?: string;
  guestOrderLineId?: string;
  /** `cartItemKey` of the cart line this came from — how "already fired" is counted. */
  key: string;
  name: string;
  qty: number;
  unit: string;
  note?: string;
}

export interface KotTicket {
  id: string;
  ticketNo: number;
  tableId: string;
  tableName: string;
  /**
   * The order this ticket belongs to, not just the table.
   *
   * A table is reused all evening, so "already fired" has to be counted against
   * one sitting. Keyed on the table alone, a fresh party ordering two naan at T3
   * would be treated as already sent because the previous party's ticket had
   * two — and the kitchen would never hear about it.
   */
  billId: string;
  createdAt: string;
  status: KotStatus;
  lines: KotLine[];
}

export const KOT_STATUS_FLOW: KotStatus[] = ["new", "preparing", "ready", "served"];

export function nextKotStatus(status: KotStatus): KotStatus | null {
  const index = KOT_STATUS_FLOW.indexOf(status);
  return index < 0 || index === KOT_STATUS_FLOW.length - 1 ? null : KOT_STATUS_FLOW[index + 1];
}

/**
 * A plausible small-restaurant floor so the screen is usable the moment it is
 * opened. The owner renames, adds and removes from here; nothing depends on
 * these names.
 */
export function defaultFloorPlan(): RestaurantTable[] {
  return [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `table-${i + 1}`, name: `T${i + 1}`, section: "Dining", seats: 4,
    })),
    { id: "table-7", name: "T7", section: "Terrace", seats: 6 },
    { id: "table-8", name: "T8", section: "Terrace", seats: 2 },
    { id: "counter-1", name: "Takeaway 1", section: "Counter", seats: 0 },
  ];
}

export function newTableId(): string {
  return `table-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function readList<T>(key: string, fallback: T[]): Promise<T[]> {
  const rows = await offlineDB.getSetting<T[]>(key).catch(() => null);
  return Array.isArray(rows) ? rows : fallback;
}

export async function loadFloorPlan(): Promise<RestaurantTable[]> {
  const rows = await offlineDB.getSetting<RestaurantTable[]>(FLOOR_PLAN_KEY).catch(() => null);
  // An empty saved plan is a real answer (the owner deleted every table); only a
  // missing one falls back to the starter floor.
  return Array.isArray(rows) ? rows : defaultFloorPlan();
}

export function saveFloorPlan(tables: RestaurantTable[]) {
  return offlineDB.setSetting(FLOOR_PLAN_KEY, tables).catch(() => undefined);
}

export async function loadTableBills(): Promise<Record<string, string>> {
  const map = await offlineDB.getSetting<Record<string, string>>(TABLE_BILLS_KEY).catch(() => null);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export function saveTableBills(map: Record<string, string>) {
  return offlineDB.setSetting(TABLE_BILLS_KEY, map).catch(() => undefined);
}

export async function loadKotTickets(now = Date.now()): Promise<KotTicket[]> {
  const rows = await readList<KotTicket>(KOT_TICKETS_KEY, []);
  return pruneKotTickets(rows, now);
}

export function saveKotTickets(tickets: KotTicket[]) {
  return offlineDB.setSetting(KOT_TICKETS_KEY, tickets).catch(() => undefined);
}

export function pruneKotTickets(tickets: KotTicket[], now = Date.now()): KotTicket[] {
  return tickets.filter((ticket) => {
    const at = Date.parse(ticket.createdAt);
    return !Number.isFinite(at) || now - at < KOT_MAX_AGE_MS;
  });
}

/**
 * Drop table -> bill links that no longer describe a live order.
 *
 * That is the ordinary path, not an error, and self-healing here means no other
 * screen has to remember to release a table. Two cases end a sitting:
 *
 * - the held bill is gone (settled, cancelled or pruned);
 * - the held bill is still listed but empty. Settling a table leaves the till
 *   holding an emptied cart under the same id, so "still in the list" is not
 *   the same as "still eating" — without this the table would read Seated,
 *   ₹0 for the rest of the day and never free itself.
 *
 * The one empty cart that *is* a live order is the table being rung up right
 * now: a waiter who has seated a party and not yet keyed the first dish.
 */
export function reconcileTableBills(
  map: Record<string, string>,
  heldBills: HeldBill[],
  activeBillId?: string,
): Record<string, string> {
  const live = new Map(heldBills.map((bill) => [bill.id, bill]));
  const next: Record<string, string> = {};
  for (const [tableId, billId] of Object.entries(map)) {
    const bill = live.get(billId);
    if (!bill) continue;
    if ((bill.cart?.length ?? 0) === 0 && billId !== activeBillId) continue;
    next[tableId] = billId;
  }
  return next;
}

/**
 * Fold the cart currently open in the billing workspace back over the parked
 * set.
 *
 * A held bill is only rewritten when the counter parks or switches, so the one
 * table being rung up right now is stale in that list — it would read "0 items,
 * ₹0" while a waiter is adding to it. The draft is the live copy of exactly one
 * table, matched by `activeBillId`, so overlaying it is what makes the floor
 * show the order as it is being taken.
 */
export function withLiveDraft(heldBills: HeldBill[], draft: BillingDraft | null | undefined): HeldBill[] {
  const activeId = draft?.activeBillId;
  if (!activeId) return heldBills;
  return heldBills.map((bill) => (bill.id === activeId ? { ...bill, ...draft, id: bill.id } : bill));
}

export interface TableOccupancy {
  table: RestaurantTable;
  bill: HeldBill | null;
  items: number;
  /** Sum of the parked cart's lines. Discounts and tax are settled at billing. */
  runningTotal: number;
  openedAt: string | null;
  /** Lines added to the cart that no kitchen ticket covers yet. */
  pendingKotLines: KotLine[];
  tickets: KotTicket[];
}

export function cartRunningTotal(cart: CartItem[] | undefined): number {
  return (cart ?? []).reduce((sum, item) => sum + cartItemNet(item), 0);
}

function cartLineLabel(item: CartItem): string {
  const name = item.product?.name ?? "Item";
  const pack = item.sellingUnit?.unitCode;
  return pack && pack !== item.unit ? `${name} (${pack})` : name;
}

/**
 * What still has to reach the kitchen for this table.
 *
 * The kitchen must be told only the difference: a waiter who adds one more
 * naan to a table that already fired six items should send one naan, not seven.
 * Quantities already covered by this table's tickets are therefore subtracted
 * line by line.
 */
export function pendingKotLines(cart: CartItem[] | undefined, tickets: KotTicket[]): KotLine[] {
  const fired = new Map<string, number>();
  for (const ticket of tickets) {
    for (const line of ticket.lines) {
      fired.set(line.key, (fired.get(line.key) ?? 0) + line.qty);
    }
  }
  const pending: KotLine[] = [];
  for (const item of cart ?? []) {
    const key = cartItemKey(item);
    const outstanding = (Number(item.quantity) || 0) - (fired.get(key) ?? 0);
    if (outstanding <= 0.0001) continue;
    pending.push({
      guestOrderId: item.guestOrderId,
      guestOrderLineId: item.guestOrderLineId,
      key,
      name: cartLineLabel(item),
      qty: Math.round(outstanding * 1000) / 1000,
      unit: item.unit ?? "piece",
      note: [addonSummary(item.addons), item.note].filter(Boolean).join(" · ") || undefined,
    });
  }
  return pending;
}

export function buildOccupancy(
  tables: RestaurantTable[],
  heldBills: HeldBill[],
  map: Record<string, string>,
  tickets: KotTicket[],
): TableOccupancy[] {
  const billById = new Map(heldBills.map((bill) => [bill.id, bill]));
  return tables.map((table) => {
    const bill = billById.get(map[table.id] ?? "") ?? null;
    // Scoped to this sitting's bill, so a re-seated table starts owing the
    // kitchen everything on the new order.
    const tableTickets = (bill ? tickets.filter((ticket) => ticket.billId === bill.id) : [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      table,
      bill,
      items: bill?.cart?.length ?? 0,
      runningTotal: cartRunningTotal(bill?.cart),
      openedAt: bill?.createdAt ?? null,
      // A settled table starts clean: its old tickets describe a finished meal.
      pendingKotLines: bill ? pendingKotLines(bill.cart, tableTickets) : [],
      tickets: tableTickets,
    };
  });
}

export function nextTicketNo(tickets: KotTicket[]): number {
  return tickets.reduce((max, ticket) => Math.max(max, ticket.ticketNo || 0), 0) + 1;
}

export function buildKotTicket(
  table: RestaurantTable,
  billId: string,
  lines: KotLine[],
  tickets: KotTicket[],
  now = new Date(),
): KotTicket {
  return {
    id: `kot-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    ticketNo: nextTicketNo(tickets),
    tableId: table.id,
    tableName: table.name,
    billId,
    createdAt: now.toISOString(),
    status: "new",
    lines,
  };
}

/** Minutes a ticket has been waiting — what a kitchen screen is actually read for. */
export function ticketAgeMinutes(ticket: KotTicket, now = Date.now()): number {
  const at = Date.parse(ticket.createdAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((now - at) / 60000));
}
