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

export interface OfferApprovalInput {
  ownerPin: string;
  auditReason?: string;
}

export function createOffer(data: OfferInput, approval: OfferApprovalInput) {
  return apiRequest<Offer>("/offers", {
    method: "POST",
    ownerPin: approval.ownerPin,
    body: JSON.stringify({ ...data, auditReason: approval.auditReason || undefined }),
  });
}

export function updateOffer(id: string, data: Partial<OfferInput>, approval: OfferApprovalInput) {
  return apiRequest<Offer>(`/offers/${id}`, {
    method: "PATCH",
    ownerPin: approval.ownerPin,
    body: JSON.stringify({ ...data, auditReason: approval.auditReason || undefined }),
  });
}

export function deleteOffer(id: string, approval: OfferApprovalInput) {
  return apiRequest<Offer>(`/offers/${id}`, {
    method: "DELETE",
    ownerPin: approval.ownerPin,
    body: JSON.stringify({ auditReason: approval.auditReason || undefined }),
  });
}

export function restoreOffer(id: string, approval: OfferApprovalInput) {
  return apiRequest<Offer>(`/offers/${id}/restore`, {
    method: "POST",
    ownerPin: approval.ownerPin,
    body: JSON.stringify({ auditReason: approval.auditReason || undefined }),
  });
}

export function applyOffer(subtotal: number, code?: string) {
  return apiRequest<ApplyOfferResult>("/offers/apply", { method: "POST", body: JSON.stringify({ subtotal, code }) });
}

