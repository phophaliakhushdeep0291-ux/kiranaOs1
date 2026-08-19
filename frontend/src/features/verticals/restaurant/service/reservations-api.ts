import { apiRequest } from "@/lib/api/http";

/**
 * The booking diary. Types live here rather than in `@/types/api` for the same
 * reason the KOT ticket shape does: this is one pack's own record, and putting it
 * in the shared file would let a trade that never books a table pull it in.
 */
export type ReservationStatus = "booked" | "seated" | "completed" | "cancelled" | "no_show";

export interface Reservation {
  id: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  reservedFor: string;
  endsAt: string;
  durationMinutes: number;
  status: ReservationStatus;
  source: "phone" | "walk_in" | "online";
  note: string | null;
  tableId: string | null;
  table: { id: string; code: string; name: string; section: string; seats: number } | null;
}

export interface ReservationInput {
  guestName: string;
  guestPhone?: string | null;
  partySize: number;
  reservedFor: string;
  durationMinutes?: number;
  tableId?: string | null;
  source?: "phone" | "walk_in" | "online";
  note?: string | null;
}

const BASE = "/restaurant/service-ops";

export function listReservations(params: { from?: string; to?: string; status?: ReservationStatus } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, String(value));
  const suffix = query.toString();
  return apiRequest<Reservation[]>(`${BASE}/reservations${suffix ? `?${suffix}` : ""}`);
}

export function createReservation(input: ReservationInput) {
  return apiRequest<Reservation>(`${BASE}/reservations`, { method: "POST", body: JSON.stringify(input) });
}

export function setReservationStatus(id: string, status: Exclude<ReservationStatus, "booked">) {
  return apiRequest<Reservation>(`${BASE}/reservations/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
}
