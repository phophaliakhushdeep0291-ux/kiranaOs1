import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type {
  RentalAvailability,
  RentalBooking,
  RentalBookingInput,
  RentalSummary,
} from "@/types/api";

/**
 * Rentals are online-first, like offers: availability has to be decided by the
 * server so two counters cannot promise the same lehenga for the same wedding.
 * The booking list is cached so the shop can still look up "who has what" when
 * the connection drops; creating and closing bookings needs a connection.
 */

const RENTALS_CACHE_KEY = "rentals:server-cache:v1";

export interface RentalListFilters {
  status?: string;
  from?: string;
  to?: string;
  search?: string;
}

function query(filters: RentalListFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listRentals(filters: RentalListFilters = {}) {
  try {
    const bookings = await apiRequest<RentalBooking[]>(`/rentals${query(filters)}`, { background: true });
    // Only the unfiltered list is worth caching — a cached filter would be a
    // confusing half-truth the next time the page opens offline.
    if (Object.keys(filters).length === 0) {
      await offlineDB.setSetting(RENTALS_CACHE_KEY, bookings).catch(() => undefined);
    }
    return bookings;
  } catch (error) {
    // Never hide an auth/permission error behind stale data.
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const cached = await offlineDB.getSetting<RentalBooking[]>(RENTALS_CACHE_KEY).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

export function getRentalSummary() {
  return apiRequest<RentalSummary>("/rentals/summary", { background: true });
}

/** What is free to rent across a window. `excludeBookingId` lets a booking being edited ignore its own hold. */
export function getRentalAvailability(from: string, to: string, excludeBookingId?: string) {
  const params = new URLSearchParams({ from, to });
  if (excludeBookingId) params.set("excludeBookingId", excludeBookingId);
  return apiRequest<RentalAvailability>(`/rentals/availability?${params.toString()}`, { background: true });
}

export function createRental(data: RentalBookingInput) {
  return apiRequest<RentalBooking>("/rentals", { method: "POST", body: JSON.stringify(data) });
}

export function updateRental(id: string, data: Partial<RentalBookingInput>) {
  return apiRequest<RentalBooking>(`/rentals/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function markRentalPickedUp(id: string) {
  return apiRequest<RentalBooking>(`/rentals/${id}/pickup`, { method: "POST" });
}

export function markRentalReturned(id: string, data: { lateFee?: number; damageCharge?: number; notes?: string } = {}) {
  return apiRequest<RentalBooking>(`/rentals/${id}/return`, { method: "POST", body: JSON.stringify(data) });
}

export function cancelRental(id: string, reason?: string) {
  return apiRequest<RentalBooking>(`/rentals/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function deleteRental(id: string) {
  return apiRequest<RentalBooking>(`/rentals/${id}`, { method: "DELETE" });
}
