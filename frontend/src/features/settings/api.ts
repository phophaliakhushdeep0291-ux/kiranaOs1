import { apiRequest } from "@/lib/api/http";
import type { Shop } from "@/types/api";

export function getShop() {
  return apiRequest<Shop>("/shops");
}

export function updateShop(data: Partial<Shop> & { ownerPin?: string }) {
  return apiRequest<Shop>("/shops", {
    method: "PATCH",
    body: JSON.stringify(data),
    ownerPin: data.ownerPin,
  });
}
