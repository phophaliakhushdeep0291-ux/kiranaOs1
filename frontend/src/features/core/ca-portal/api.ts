import { apiRequest } from "@/lib/api/http";
import type { CaAccess, CaLinkResult, CaOverviewData, ClientShopDetailsData, CaPeriodQuery } from "./types";

function periodSearch(query: CaPeriodQuery = {}) {
  const search = new URLSearchParams();
  for (const key of ["from", "to", "month", "status"] as const) {
    if (query[key]) search.set(key, query[key]);
  }
  return search;
}
export function fetchCaOverview(query?: CaPeriodQuery): Promise<CaOverviewData> {
  return apiRequest(`/ca/overview?${periodSearch(query)}`);
}
export function fetchClientShopDetails(shopId: string, query?: CaPeriodQuery): Promise<ClientShopDetailsData> {
  return apiRequest(`/ca/clients/${encodeURIComponent(shopId)}?${periodSearch(query)}`);
}
export function downloadClientTallyXml(shopId: string, params: CaPeriodQuery & { inventory?: boolean } = {}): Promise<Blob> {
  const search = periodSearch(params);
  search.set("format", "xml");
  search.set("inventory", String(params.inventory ?? false));
  return apiRequest(`/ca/clients/${encodeURIComponent(shopId)}/tally?${search}`, { responseType: "blob" });
}
export function linkClientShop(linkCode: string, note?: string): Promise<CaLinkResult> {
  return apiRequest("/ca/link", { method: "POST", body: JSON.stringify({ linkCode, note }) });
}
export function generateShopCaCode(ownerPin: string, expiresInHours = 72): Promise<{ id: string; code: string; expiresAt: string }> {
  return apiRequest("/ca/generate-code", { method: "POST", ownerPin, body: JSON.stringify({ expiresInHours }) });
}
export function fetchShopCaAccess(): Promise<CaAccess[]> {
  return apiRequest("/ca/access");
}
export function revokeShopCaAccess(id: string, ownerPin: string): Promise<{ id: string; revoked: boolean }> {
  return apiRequest(`/ca/access/${encodeURIComponent(id)}`, { method: "DELETE", ownerPin });
}
