import { getActiveLocationId } from "@/features/core/stores/location-context";
import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type {
  FurnitureOrder,
  FurnitureOrderInput,
  FurnitureOrderStatus,
  FurnitureOrderSummary,
} from "@/types/api";

/**
 * Sales orders are online-first, like the other trade registers.
 *
 * An order number has to be unique across every desk in the showroom, and an
 * advance recorded on two devices at once would be counted twice against what
 * the customer owes. The order book is cached so "what did we promise this
 * customer?" still answers on a dropped connection; writing needs one.
 */

const ORDERS_CACHE_KEY = "furniture-orders:server-cache:v1";

export interface FurnitureOrderFilters {
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  overdueOnly?: boolean;
}

export async function listFurnitureOrders(filters: FurnitureOrderFilters = {}) {
  const cacheKey = `${ORDERS_CACHE_KEY}:${getActiveLocationId() ?? "primary"}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  try {
    const orders = await apiRequest<FurnitureOrder[]>(`/furniture-orders${qs ? `?${qs}` : ""}`, { background: true });
    // Only the unfiltered list is worth caching — a cached filter would be a
    // confusing half-truth the next time the page opens offline.
    if (!qs) await offlineDB.setSetting(cacheKey, orders).catch(() => undefined);
    return orders;
  } catch (error) {
    // Never hide an auth/permission error behind stale data.
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const cached = await offlineDB.getSetting<FurnitureOrder[]>(cacheKey).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

export function getFurnitureOrder(id: string) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}`, { background: true });
}

export function getFurnitureOrderSummary() {
  return apiRequest<FurnitureOrderSummary>("/furniture-orders/summary", { background: true });
}

export interface FurnitureInvoiceLine {
  lineId: string; name: string; quantity: number; enteredUnit: string; amount: number; gstRate: number; hsn?: string; productId?: string;
}
export interface FurnitureInvoicePreview {
  legacyDelivery?: boolean;
  order: FurnitureOrder; previewToken: string; lines: FurnitureInvoiceLine[];
  customers: { id: string; name: string; mobile: string | null }[];
}
export interface FurnitureInvoiceInput {
  legacyStockConfirmed?: boolean; businessDate?: string;
  previewToken: string; taxMode: "none" | "inclusive"; customerId?: string; reason: string;
  taxes: { lineId: string; gstRate: number; hsn?: string }[];
}
export function previewFurnitureInvoice(id: string) {
  return apiRequest<FurnitureInvoicePreview>(`/furniture-orders/${id}/invoice-preview`, { cache: "no-store" });
}
export function createFurnitureInvoice(id: string, input: FurnitureInvoiceInput, ownerPin: string) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}/invoice`, { method: "POST", body: JSON.stringify(input), ownerPin });
}

/**
 * How much of each product is promised to someone.
 *
 * Three sofas on the floor and two already sold means only one is actually for
 * sale — the mistake this prevents is selling the same piece twice.
 */
export function getReservations() {
  return apiRequest<Record<string, number>>("/furniture-orders/reservations", { background: true });
}

/** Every open order a product is promised on — "who is waiting for this sofa?" */
export function getOrdersForProduct(productId: string) {
  return apiRequest<FurnitureOrder[]>(`/furniture-orders/for-product/${productId}`, { background: true });
}

export function createFurnitureOrder(data: FurnitureOrderInput) {
  return apiRequest<FurnitureOrder>("/furniture-orders", { method: "POST", body: JSON.stringify(data) });
}

export function updateFurnitureOrder(id: string, data: Partial<FurnitureOrderInput>) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function setFurnitureOrderStatus(
  id: string,
  status: FurnitureOrderStatus,
  extra: { billId?: string | null; billNumber?: string | null; note?: string } = {},
) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status, ...extra }),
  });
}

export function cancelFurnitureOrder(id: string, reason?: string) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function addFurnitureOrderPayment(
  id: string,
  data: { amount: number; clientRequestId: string; expectedPaidTotal?: number; mode?: string; paidOn?: string; reference?: string | null; notes?: string | null },
) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}/payments`, { method: "POST", body: JSON.stringify(data) });
}

export function removeFurnitureOrderPayment(id: string, paymentId: string) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}/payments/${paymentId}`, { method: "DELETE" });
}

export function deleteFurnitureOrder(id: string) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}`, { method: "DELETE" });
}

export interface FurniturePaymentAdjustment {
  clientRequestId: string;
  kind: "refund" | "correction";
  amount: number;
  expectedPaidTotal: number;
  reason: string;
  mode?: string;
  reference?: string;
}

export function adjustFurniturePayment(id: string, paymentId: string, data: FurniturePaymentAdjustment, ownerPin: string) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}/payments/${paymentId}/adjust`, { method: "POST", body: JSON.stringify(data), ownerPin });
}

export function reconcileFurnitureHistory(id: string, input: { reason: string; receipts: Array<{ paymentId: string; amount: number; mode: string }> }, ownerPin: string) {
  return apiRequest<FurnitureOrder>(`/furniture-orders/${id}/reconcile-history`, { method: "POST", body: JSON.stringify(input), ownerPin });
}
