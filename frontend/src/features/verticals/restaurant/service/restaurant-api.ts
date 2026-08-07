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
  MenuDishPatch,
  RestaurantTable,
  RestaurantTableInput,
} from "@/types/api";

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
