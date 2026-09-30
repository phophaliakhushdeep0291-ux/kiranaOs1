import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type {
  ProductUnit,
  ProductUnitSummary,
  ReceiveProductUnitsInput,
  SellProductUnitInput,
  UnitBillingOption,
} from "@/types/api";

/**
 * Serialised units are online-first, like rentals and the prescription register.
 *
 * An IMEI has to be unique across every counter in the shop, and two tills
 * recording the same handset offline would each believe they had it. The list is
 * cached so a lookup still answers "we sold this on the 3rd" when the connection
 * drops; receiving stock and marking a unit sold need a connection.
 */

const UNITS_CACHE_KEY = "product-units:server-cache:v1";

export interface ProductUnitListFilters {
  status?: string;
  productId?: string;
  condition?: string;
  search?: string;
  from?: string;
  to?: string;
}

function query(filters: ProductUnitListFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listProductUnits(filters: ProductUnitListFilters = {}) {
  try {
    const rows = await apiRequest<ProductUnit[]>(`/product-units${query(filters)}`, { background: true });
    // Only the unfiltered list is worth caching — a cached filter would be a
    // confusing half-truth the next time the page opens offline.
    if (Object.keys(filters).length === 0) {
      await offlineDB.setSetting(UNITS_CACHE_KEY, rows).catch(() => undefined);
    }
    return rows;
  } catch (error) {
    // Never hide an auth/permission error behind stale data.
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const cached = await offlineDB.getSetting<ProductUnit[]>(UNITS_CACHE_KEY).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

export function getProductUnitSummary() {
  return apiRequest<ProductUnitSummary>("/product-units/summary", { background: true });
}

/**
 * The counter lookup. Resolves to null for a code the shop has no record of —
 * that is a real answer about a handset bought elsewhere, not a failure.
 *
 * Falls back to the cached list when offline, so a customer standing at the
 * counter still gets an answer about a unit this device has seen before.
 */
export async function lookupProductUnit(code: string) {
  const trimmed = code.trim();
  if (!trimmed) return null;
  try {
    return await apiRequest<ProductUnit | null>(`/product-units/lookup/${encodeURIComponent(trimmed)}`, { background: true });
  } catch (error) {
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const cached = await offlineDB.getSetting<ProductUnit[]>(UNITS_CACHE_KEY).catch(() => undefined);
    if (!cached) throw error;
    const wanted = trimmed.toUpperCase();
    return cached.find((unit) => [unit.imei, unit.imei2, unit.serialNumber].some((code2) => code2?.toUpperCase() === wanted)) ?? null;
  }
}

/** Every serialised unit of one product — "which of these do we actually still have?" */
export function getUnitsForProduct(productId: string, status = "held") {
  return apiRequest<ProductUnit[]>(`/product-units/for-product/${productId}?status=${status}`, { background: true });
}

const TRACKED_PRODUCTS_CACHE_KEY = "product-units:tracked-products:v1";

export interface UnitBillingAnswer {
  /** One entry per product on the bill that this shop sells by serial. Products it does not are left out. */
  options: UnitBillingOption[];
  /**
   * False when the server could not be asked and `options` is what this device
   * remembers: which products are tracked, with no units to offer. A serial
   * cannot be reserved from memory, so there is nothing to pick from.
   */
  live: boolean;
}

/**
 * What billing needs to know about the products on a bill: which of them are
 * sold by serial, and which units of each are on the shelf.
 *
 * Asked for the bill's own products rather than read out of the register list.
 * That list is the newest 500 units of every product and every status, so after
 * a few months' trading the handset on the counter — received in an older box —
 * is not in it, and a picker built on it has nothing to pick.
 *
 * Which products are tracked is remembered per device, so an offline till still
 * knows to tell the cashier that this sale is going out without its serial.
 *
 * A shop whose plan has no serial register is answered with nothing to do.
 */
export async function getUnitBillingOptions(productIds: string[]): Promise<UnitBillingAnswer> {
  const ids = [...new Set(productIds.filter(Boolean))].sort();
  if (ids.length === 0) return { options: [], live: true };
  try {
    const options = await apiRequest<UnitBillingOption[]>(`/product-units/billing-options?productIds=${ids.map(encodeURIComponent).join(",")}`, { background: true });
    const tracked = new Set(options.map((option) => option.productId));
    const remembered = await rememberedTrackedProducts();
    await offlineDB.setSetting(TRACKED_PRODUCTS_CACHE_KEY, { ...(remembered ?? {}), ...Object.fromEntries(ids.map((id) => [id, tracked.has(id)])) }).catch(() => undefined);
    return { options, live: true };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) return { options: [], live: true };
    // Never hide an auth error behind stale data.
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const remembered = await rememberedTrackedProducts();
    if (!remembered) throw error;
    return {
      options: ids.filter((id) => remembered[id]).map((productId) => ({ productId, registered: 0, sellableCount: 0, units: [] })),
      live: false,
    };
  }
}

function rememberedTrackedProducts() {
  return offlineDB.getSetting<Record<string, boolean>>(TRACKED_PRODUCTS_CACHE_KEY).catch(() => undefined);
}

/**
 * Which of these products are sold by serial — from memory when the device
 * already knows, from the server only for a product it has never asked about.
 *
 * For the question asked as a bill is saved. The control on the bill has
 * already asked the server about this cart, so this is normally a local read,
 * and a sale is not held up behind a second request for the same answer.
 */
export async function trackedProductIds(productIds: string[]): Promise<{ tracked: Set<string>; live: boolean }> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const remembered = await rememberedTrackedProducts();
  if (remembered && ids.every((id) => typeof remembered[id] === "boolean")) {
    return { tracked: new Set(ids.filter((id) => remembered[id])), live: true };
  }
  const answer = await getUnitBillingOptions(ids);
  return { tracked: new Set(answer.options.map((option) => option.productId)), live: answer.live };
}

export function receiveProductUnits(data: ReceiveProductUnitsInput) {
  return apiRequest<ProductUnit[]>("/product-units", { method: "POST", body: JSON.stringify(data) });
}

export function updateProductUnit(id: string, data: Partial<ReceiveProductUnitsInput["units"][number]> & { warrantyMonths?: number }) {
  return apiRequest<ProductUnit>(`/product-units/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function sellProductUnit(id: string, data: SellProductUnitInput = {}) {
  return apiRequest<ProductUnit>(`/product-units/${id}/sell`, { method: "POST", body: JSON.stringify(data) });
}

export function returnProductUnit(id: string, data: { condition?: string; reason?: string } = {}) {
  return apiRequest<ProductUnit>(`/product-units/${id}/return`, { method: "POST", body: JSON.stringify(data) });
}

export function sendProductUnitToService(id: string, reason?: string) {
  return apiRequest<ProductUnit>(`/product-units/${id}/service`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function returnProductUnitFromService(id: string, condition = "refurbished") {
  return apiRequest<ProductUnit>(`/product-units/${id}/service-return`, { method: "POST", body: JSON.stringify({ condition }) });
}

export function writeOffProductUnit(id: string, status: "lost" | "scrapped", reason?: string) {
  return apiRequest<ProductUnit>(`/product-units/${id}/write-off`, { method: "POST", body: JSON.stringify({ status, reason }) });
}

export function deleteProductUnit(id: string) {
  return apiRequest<ProductUnit>(`/product-units/${id}`, { method: "DELETE" });
}
