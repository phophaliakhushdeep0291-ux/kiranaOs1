import { apiRequest } from "@/lib/api/http";
import type { ApplyOfferResult, Offer, OfferInput } from "@/types/api";

export function listOffers() {
  return apiRequest<Offer[]>("/offers");
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

