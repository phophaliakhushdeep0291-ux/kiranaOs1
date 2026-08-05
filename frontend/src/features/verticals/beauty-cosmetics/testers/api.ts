import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type { OpenTesterInput, TesterCost, TesterSummary, TesterUnit } from "@/types/api";

/**
 * Testers are online-first, because opening one moves real stock.
 *
 * A tester recorded offline and replayed later would decrement the shelf twice
 * or not at all, and the whole point of the register is that the shelf figure
 * ends up right. The list is cached so "what is on the counter, and what needs
 * swapping?" still answers without a connection.
 */

const TESTERS_CACHE_KEY = "testers:server-cache:v1";

export interface TesterFilters {
  status?: string;
  productId?: string;
  search?: string;
  dueOnly?: boolean;
}

export async function listTesters(filters: TesterFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  try {
    const testers = await apiRequest<TesterUnit[]>(`/testers${qs ? `?${qs}` : ""}`, { background: true });
    if (!qs) await offlineDB.setSetting(TESTERS_CACHE_KEY, testers).catch(() => undefined);
    return testers;
  } catch (error) {
    // Never hide an auth/permission error behind stale data.
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const cached = await offlineDB.getSetting<TesterUnit[]>(TESTERS_CACHE_KEY).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

export function getTesterSummary() {
  return apiRequest<TesterSummary>("/testers/summary", { background: true });
}

/** What testers cost the shop over a period — the number this module exists to produce. */
export function getTesterCost(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return apiRequest<TesterCost>(`/testers/cost${qs ? `?${qs}` : ""}`, { background: true });
}

export function getTestersForProduct(productId: string) {
  return apiRequest<TesterUnit[]>(`/testers/for-product/${productId}`, { background: true });
}

export function openTester(data: OpenTesterInput) {
  return apiRequest<TesterUnit>("/testers", { method: "POST", body: JSON.stringify(data) });
}

export function closeTester(id: string, status: "replaced" | "discarded", notes?: string) {
  return apiRequest<TesterUnit>(`/testers/${id}/close`, { method: "POST", body: JSON.stringify({ status, notes }) });
}

export function updateTester(id: string, data: { variant?: string | null; expectedDays?: number; costValue?: number; notes?: string | null }) {
  return apiRequest<TesterUnit>(`/testers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteTester(id: string) {
  return apiRequest<TesterUnit>(`/testers/${id}`, { method: "DELETE" });
}
