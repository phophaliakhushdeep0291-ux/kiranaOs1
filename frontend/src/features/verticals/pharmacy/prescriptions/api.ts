import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type { Prescription, PrescriptionInput, PrescriptionSummary } from "@/types/api";

/**
 * The prescription register is online-first, like rentals.
 *
 * The register number has to be unique and gapless across every counter in the
 * shop, and a legal record is not something to write optimistically on a device
 * and reconcile later. The list is cached so a chemist can still look up "what
 * did we give this patient?" when the connection drops; recording a new entry
 * and dispensing against one need a connection.
 */

const PRESCRIPTIONS_CACHE_KEY = "prescriptions:server-cache:v1";

export interface PrescriptionListFilters {
  status?: string;
  scheduleType?: string;
  from?: string;
  to?: string;
  search?: string;
}

function query(filters: PrescriptionListFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listPrescriptions(filters: PrescriptionListFilters = {}) {
  try {
    const rows = await apiRequest<Prescription[]>(`/prescriptions${query(filters)}`, { background: true });
    // Only the unfiltered list is worth caching — a cached filter would be a
    // confusing half-truth the next time the page opens offline.
    if (Object.keys(filters).length === 0) {
      await offlineDB.setSetting(PRESCRIPTIONS_CACHE_KEY, rows).catch(() => undefined);
    }
    return rows;
  } catch (error) {
    // Never hide an auth/permission error behind stale data.
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const cached = await offlineDB.getSetting<Prescription[]>(PRESCRIPTIONS_CACHE_KEY).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

export function getPrescriptionSummary() {
  return apiRequest<PrescriptionSummary>("/prescriptions/summary", { background: true });
}

/** Every register entry naming a medicine — "who was this given to before, and on whose prescription?" */
export function getPrescriptionsForProduct(productId: string, limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return apiRequest<Prescription[]>(`/prescriptions/for-product/${productId}${qs}`, { background: true });
}

export function createPrescription(data: PrescriptionInput) {
  return apiRequest<Prescription>("/prescriptions", { method: "POST", body: JSON.stringify(data) });
}

export function updatePrescription(id: string, data: Partial<PrescriptionInput>) {
  return apiRequest<Prescription>(`/prescriptions/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function dispensePrescription(id: string, data: { billId?: string | null; billNumber?: string | null; notes?: string } = {}) {
  return apiRequest<Prescription>(`/prescriptions/${id}/dispense`, { method: "POST", body: JSON.stringify(data) });
}

export function cancelPrescription(id: string, reason?: string) {
  return apiRequest<Prescription>(`/prescriptions/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function deletePrescription(id: string) {
  return apiRequest<Prescription>(`/prescriptions/${id}`, { method: "DELETE" });
}
