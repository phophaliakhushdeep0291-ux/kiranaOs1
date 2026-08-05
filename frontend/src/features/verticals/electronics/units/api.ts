import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type {
  ProductUnit,
  ProductUnitSummary,
  ReceiveProductUnitsInput,
  SellProductUnitInput,
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
