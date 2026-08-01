import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type { ApplyOfferResult, Offer, OfferInput } from "@/types/api";

const OFFERS_CACHE_KEY = "offers:server-cache:v1";

export async function listOffers() {
  try {
    const offers = await apiRequest<Offer[]>("/offers", { background: true });
    await offlineDB.setSetting(OFFERS_CACHE_KEY, offers).catch(() => undefined);
    return offers;
  } catch (error) {
    // Never hide authentication/permission/client errors behind old data. Cached
    // offers are only a continuity fallback for an unreachable server.
    if (error instanceof ApiClientError && error.status > 0 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
    const cached = await offlineDB.getSetting<Offer[]>(OFFERS_CACHE_KEY).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

export function createOffer(data: OfferInput) {
  return apiRequest<Offer>("/offers", { method: "POST", body: JSON.stringify(data) });
}

export function updateOffer(id: string, data: Partial<OfferInput>) {
  return apiRequest<Offer>(`/offers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteOffer(id: string) {
  return apiRequest<Offer>(`/offers/${id}`, { method: "DELETE" });
}

export function applyOffer(subtotal: number, code?: string) {
  return apiRequest<ApplyOfferResult>("/offers/apply", { method: "POST", body: JSON.stringify({ subtotal, code }) });
}

