import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import { listProducts as listProductsFromServer } from "@/features/core/products/api";
import type { Product } from "@/types/api";
import type {
  DishRecipe,
  DishRecipeComponent,
  KitchenStock,
  MenuBoard,
  MenuDish,
  MenuAddonGroup,
  MenuAddonGroupInput,
  MenuDishPatch,
  MenuComboComponent,
  MenuDishVariation,
  RestaurantTable,
  RestaurantTableInput,
} from "@/types/api";
// Same pack, so this is not a boundary crossing: the ticket shape is already
// defined beside the pure helpers that build and read it, and duplicating it
// here would give the two halves of one feature two types to drift apart.
import type { KotLine, KotStatus, KotTicket } from "./table-store";

export interface RestaurantGuestRequest {
  id: string;
  tableId: string;
  tableCode: string;
  tableName: string;
  orderId: string | null;
  type: "waiter" | "bill";
  reason: string | null;
  splitMode: string | null;
  status: "pending" | "acknowledged" | "completed" | "cancelled";
  requestedAt: string;
}

/**
 * The restaurant's server-side records: the floor, the menu card, the recipes.
 *
 * Online-first, and deliberately so. Everything here is read by someone who is
 * not this device — a guest's phone resolving the QR on their table, another
 * tablet showing the same menu, the kitchen screen in the back. A floor plan
 * edited offline and replayed later would leave a printed sticker pointing at a
 * table the server has never heard of, which fails in the guest's hands rather
 * than the owner's.
 *
 * The live order at a table stays where it always was — a parked cart on the
 * device that took it — because that is what has to keep working when the Wi-Fi
 * drops mid-service. See `table-store.ts`.
 *
 * Each list is cached so the screens still answer without a connection; the
 * cache is never allowed to hide an auth or permission error.
 */

const TABLES_CACHE_KEY = "restaurant:tables:server-cache:v1";
const MENU_CACHE_KEY = "restaurant:menu:server-cache:v1";
const KITCHEN_STOCK_CACHE_KEY = "restaurant:kitchen-stock:server-cache:v1";

/** A 4xx is the server answering; only a network failure or 5xx may fall back to cache. */
function isDefinitiveError(error: unknown): boolean {
  return error instanceof ApiClientError
    && error.status > 0
    && error.status < 500
    && ![408, 429].includes(error.status);
}

async function readThrough<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const fresh = await load();
    await offlineDB.setSetting(key, fresh).catch(() => undefined);
    return fresh;
  } catch (error) {
    if (isDefinitiveError(error)) throw error;
    const cached = await offlineDB.getSetting<T>(key).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

// ── The floor ────────────────────────────────────────────────────────────────

export function listTables(options: { includeInactive?: boolean } = {}) {
  const qs = options.includeInactive ? "?includeInactive=true" : "";
  return readThrough(TABLES_CACHE_KEY, () =>
    apiRequest<RestaurantTable[]>(`/restaurant/tables${qs}`, { background: true }));
}

export function createTable(data: RestaurantTableInput) {
  return apiRequest<RestaurantTable>("/restaurant/tables", { method: "POST", body: JSON.stringify(data) });
}

export function updateTable(id: string, data: Partial<RestaurantTableInput> & { active?: boolean }) {
  return apiRequest<RestaurantTable>(`/restaurant/tables/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function removeTable(id: string) {
  return apiRequest<{ id: string; removed: boolean }>(`/restaurant/tables/${id}`, { method: "DELETE" });
}

/**
 * Publish a whole floor at once — also how a plan this device kept locally moves
 * up to the server the first time the owner prints table QR codes. Matching on
 * `code` is what stops a second run duplicating every table.
 */
export function publishFloorPlan(tables: RestaurantTableInput[]) {
  return apiRequest<RestaurantTable[]>("/restaurant/tables/floor-plan", {
    method: "PUT",
    body: JSON.stringify({ tables }),
  });
}

// ── The menu card ────────────────────────────────────────────────────────────

export function getMenuBoard() {
  return readThrough(MENU_CACHE_KEY, () => apiRequest<MenuBoard>("/restaurant/menu", { background: true }));
}

export function listCourses() {
  return apiRequest<string[]>("/restaurant/menu/courses", { background: true });
}

export function updateDishMenu(productId: string, patch: MenuDishPatch) {
  return apiRequest<MenuDish>(`/restaurant/menu/${productId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** How a course is reordered, and how a kitchen 86s several dishes at once. */
export function bulkUpdateMenu(updates: Array<MenuDishPatch & { productId: string }>) {
  return apiRequest<MenuDish[]>("/restaurant/menu/bulk", { method: "PATCH", body: JSON.stringify({ updates }) });
}

/**
 * Replace a dish's portions with exactly this list.
 *
 * Wholesale rather than per-portion because the editor holds the whole list: a
 * PATCH per row would let a half-finished edit leave two portions both marked
 * default, and billing picks exactly one.
 */
export function saveDishVariations(productId: string, variations: DishVariationInput[]) {
  return apiRequest<MenuDishVariation[]>(`/restaurant/menu/${productId}/variations`, {
    method: "PUT",
    body: JSON.stringify({ variations }),
  });
}

/**
 * Replace a combo's dish list with exactly this one.
 *
 * There is no price here: a combo IS a product and is sold at that product's own
 * price, edited on the Products screen like any other. This is only the list of
 * what the guest receives, which is what the kitchen cooks and stock loses.
 */
export function saveComboComponents(productId: string, components: ComboComponentInput[]) {
  return apiRequest<MenuComboComponent[]>(`/restaurant/menu/${productId}/combo`, {
    method: "PUT",
    body: JSON.stringify({ components }),
  });
}

export interface ComboComponentInput {
  componentProductId: string;
  quantity: number;
  sortOrder?: number;
  note?: string | null;
}

export interface DishVariationInput {
  /** Present for a portion that already exists — that is what renames it in place. */
  unitCode?: string;
  name: string;
  price: number;
  portionFactor?: number;
  isDefault?: boolean;
}

// Add-on groups are reusable: define "Extras" once, attach it to many dishes.
export function listAddonGroups() {
  return apiRequest<MenuAddonGroup[]>("/restaurant/menu/addon-groups", { background: true });
}

export function saveAddonGroup(groupId: string | null, input: MenuAddonGroupInput) {
  return apiRequest<MenuAddonGroup>(groupId
    ? `/restaurant/menu/addon-groups/${groupId}`
    : "/restaurant/menu/addon-groups", {
    method: groupId ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
}

export function removeAddonGroup(groupId: string) {
  return apiRequest<{ id: string; deleted: boolean }>(`/restaurant/menu/addon-groups/${groupId}`, { method: "DELETE" });
}

export function listDishAddonGroups(productId: string) {
  return apiRequest<MenuAddonGroup[]>(`/restaurant/menu/${productId}/addon-groups`, { background: true });
}

export function saveDishAddonGroups(productId: string, groupIds: string[]) {
  return apiRequest<MenuAddonGroup[]>(`/restaurant/menu/${productId}/addon-groups`, {
    method: "PUT",
    body: JSON.stringify({ groupIds }),
  });
}

// ── The recipe book ──────────────────────────────────────────────────────────

export function getRecipe(dishProductId: string) {
  return apiRequest<DishRecipe>(`/restaurant/recipes/${dishProductId}`, { background: true });
}

export function saveRecipe(dishProductId: string, components: DishRecipeComponent[]) {
  return apiRequest<DishRecipe>(`/restaurant/recipes/${dishProductId}`, {
    method: "PUT",
    body: JSON.stringify({
      components: components.map((component) => ({
        ingredientProductId: component.ingredientProductId,
        qtyBase: component.qtyBase,
        wastagePct: component.wastagePct,
        optional: component.optional,
        note: component.note ?? null,
      })),
    }),
  });
}

export function deleteRecipe(dishProductId: string) {
  return apiRequest<{ dishProductId: string; removed: number }>(`/restaurant/recipes/${dishProductId}`, { method: "DELETE" });
}

/** What the kitchen reads before service: what is running out, and what can no longer be served. */
export function getKitchenStock() {
  return readThrough(KITCHEN_STOCK_CACHE_KEY, () =>
    apiRequest<KitchenStock>("/restaurant/recipes/kitchen-stock", { background: true }));
}

// ── The catalogue, read cheaply ──────────────────────────────────────────────

/**
 * The shop's products, for the two restaurant screens that need whole product
 * records: picking an ingredient, and turning a guest's order into cart lines.
 *
 * Deliberately NOT `useListProducts`. That hook is the counter's read-write
 * catalogue and statically pulls the product mutation path — create, update,
 * delete, and the sync outbox behind them — into whatever chunk imports it. Both
 * of these screens only ever READ, and paying ~35 kB of write machinery on a
 * kitchen screen is a cost the shop downloads and never uses.
 *
 * Local first, then the server, because the offline copy is the one the counter
 * has been maintaining all day and is what a cart line has to be built from.
 */
export async function readCatalogueProducts(): Promise<Product[]> {
  const local = await offlineDB.getAll<Product>("products").catch(() => [] as Product[]);
  const live = local.filter((product) => product.deletedAt == null);
  if (live.length > 0) return live;
  return listProductsFromServer({ limit: 500 }).catch(() => [] as Product[]);
}

// ── Kitchen tickets ──────────────────────────────────────────────────────────
//
// The clearest case in this file for why these records are the server's. A
// kitchen ticket is written by the till and read by a screen across the room —
// a different device, always. While tickets lived in the firing device's own
// IndexedDB the two never met, and the kitchen rail sat empty all service.
//
// Firing therefore needs a connection, and that is the honest behaviour rather
// than a limitation: a ticket saved locally because the Wi-Fi was down is a
// ticket the kitchen will never cook, and telling the waiter it was sent would
// be the same bug wearing a success toast.
//
// Reads still fall back to cache, so a screen that briefly loses the network
// keeps showing the rail it last saw instead of blanking mid-service.

const KOT_CACHE_KEY = "restaurant:kot:server-cache:v1";

export function listKitchenTickets(options: { includeServed?: boolean; billId?: string; fresh?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.includeServed) params.set("includeServed", "true");
  if (options.billId) params.set("billId", options.billId);
  const qs = params.toString() ? `?${params}` : "";
  // Only the unfiltered rail is cached: a per-bill answer is a question about
  // one sitting, and serving a stale one would let the till re-fire an order.
  const load = () => apiRequest<KotTicket[]>(`/restaurant/kot${qs}`, { background: true });
  return options.billId || options.fresh ? load() : readThrough(KOT_CACHE_KEY, load);
}

export function fireKitchenTicket(input: {
  tableId: string;
  tableName: string;
  billId: string;
  lines: KotLine[];
  /** The till's own ticket id, so a retry after a dropped reply lands once. */
  idempotencyKey?: string;
}) {
  return apiRequest<KotTicket>("/restaurant/kot", { method: "POST", body: JSON.stringify(input) });
}

export function setKitchenTicketStatus(id: string, status: KotStatus) {
  return apiRequest<KotTicket>(`/restaurant/kot/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function voidKitchenTicket(id: string) {
  return apiRequest<{ id: string; deleted: boolean }>(`/restaurant/kot/${id}`, { method: "DELETE" });
}

export function listGuestRequests(status?: RestaurantGuestRequest["status"]) {
  const query = status ? `?status=${status}` : "";
  return apiRequest<RestaurantGuestRequest[]>(`/restaurant/service-ops/guest-requests${query}`, { background: true });
}

export function setGuestRequestStatus(id: string, status: "acknowledged" | "completed" | "cancelled") {
  return apiRequest<RestaurantGuestRequest>(`/restaurant/service-ops/guest-requests/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}
