import { apiRequest } from "@/lib/api/http";
import type { Shop } from "@/types/api";

export function getShop() {
  return apiRequest<Shop>("/shops");
}

export interface ShopBootstrap {
  shop: { id: string; name: string; businessType: string; profileVersion: number };
  role: string | null;
  engine: string;
  capabilities: string[];
  navigation: string[];
  setupStatus: "pending" | "complete" | string;
  businessTypeLocked: boolean;
}

export function getShopBootstrap() {
  return apiRequest<ShopBootstrap>("/shops/bootstrap", { background: true });
}

export function updateShop(data: Partial<Shop> & { ownerPin?: string }) {
  return apiRequest<Shop>("/shops", {
    method: "PATCH",
    body: JSON.stringify(data),
    ownerPin: data.ownerPin,
  });
}

/** Whether this shop's owner has a PIN set — the server never returns the hash. */
export function checkOwnerPin() {
  return apiRequest<{ hasPin: boolean }>("/auth/pin/check");
}

/** Server-side PIN check; throws on a wrong PIN. Used by the lock screen and Danger Zone. */
export function verifyOwnerPin(pin: string) {
  return apiRequest<{ valid: boolean }>("/auth/pin/verify", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}
