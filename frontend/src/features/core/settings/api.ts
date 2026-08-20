import { ApiClientError, apiRequest, isBrowserOnline, isRecoverableNetworkError } from "@/lib/api/http";
import { loadAuthSession } from "@/lib/storage/auth-storage";
import type { Shop } from "@/types/api";
import { isBusinessType, type BusinessType } from "./business-type-store";

export function getShop() {
  return apiRequest<Shop>("/shops");
}

export interface ShopBootstrap {
  shop: { id: string; name: string; businessType: BusinessType; profileVersion: number };
  role: string | null;
  engine: string;
  capabilities: string[];
  navigation: string[];
  setupStatus: "pending" | "complete" | string;
  businessTypeLocked: boolean;
}

const SHOP_BOOTSTRAP_CACHE_PREFIX = "kirana-os:shop-bootstrap:v1:";

function activeShopId() {
  const session = loadAuthSession();
  return session.shop?.id ?? session.user?.shopId ?? null;
}

function isShopBootstrap(value: unknown, expectedShopId: string | null): value is ShopBootstrap {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ShopBootstrap>;
  return Boolean(
    candidate.shop
    && typeof candidate.shop.id === "string"
    && (!expectedShopId || candidate.shop.id === expectedShopId)
    && typeof candidate.shop.name === "string"
    && isBusinessType(candidate.shop.businessType)
    && Array.isArray(candidate.capabilities)
    && candidate.capabilities.every((entry) => typeof entry === "string")
    && Array.isArray(candidate.navigation)
    && candidate.navigation.every((entry) => typeof entry === "string"),
  );
}

export function readCachedShopBootstrap(shopId = activeShopId()): ShopBootstrap | undefined {
  if (!shopId || typeof window === "undefined") return undefined;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${SHOP_BOOTSTRAP_CACHE_PREFIX}${shopId}`) ?? "null") as unknown;
    return isShopBootstrap(parsed, shopId) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function cacheShopBootstrap(value: ShopBootstrap): ShopBootstrap {
  if (!isShopBootstrap(value, value.shop?.id ?? null) || typeof window === "undefined") return value;
  try {
    window.localStorage.setItem(`${SHOP_BOOTSTRAP_CACHE_PREFIX}${value.shop.id}`, JSON.stringify(value));
  } catch {
    // Restricted/private storage must not block route access.
  }
  return value;
}

export async function getShopBootstrap() {
  const shopId = activeShopId();
  const cached = readCachedShopBootstrap(shopId);
  if (!isBrowserOnline()) {
    if (cached) return cached;
    throw new ApiClientError("Business profile is not cached on this device yet.", 0, { code: "SHOP_BOOTSTRAP_OFFLINE" });
  }

  try {
    const current = await apiRequest<ShopBootstrap>("/shops/bootstrap", { background: true, timeoutMs: 2_500 });
    // Refuse a stale/cross-shop response even though the server is tenant scoped.
    if (shopId && current.shop.id !== shopId) {
      throw new ApiClientError("Business profile belongs to another shop.", 409, { code: "SHOP_BOOTSTRAP_SCOPE_MISMATCH" });
    }
    return cacheShopBootstrap(current);
  } catch (error) {
    if (cached && isRecoverableNetworkError(error)) return cached;
    throw error;
  }
}

export interface BusinessTypeCompatibility {
  currentBusinessType: BusinessType;
  targetBusinessType: BusinessType;
  currentEngine: string;
  targetEngine: string;
  counts: { products: number; bills: number; inventoryLots: number };
  disabledCapabilities: string[];
  enabledCapabilities: string[];
  canApplyImmediately: boolean;
  migrationSupported: boolean;
  decision: "NO_CHANGE" | "SAFE_BEFORE_TRANSACTIONS" | "REVIEWED_MIGRATION_REQUIRED" | "NEW_SHOP_REQUIRED";
}

export function getBusinessTypeCompatibility(targetBusinessType: BusinessType) {
  return apiRequest<BusinessTypeCompatibility>("/shops/business-type-change/compatibility", {
    method: "POST",
    body: JSON.stringify({ targetBusinessType }),
  });
}

export async function updateShopSetupStatus(status: "pending" | "complete") {
  const bootstrap = await apiRequest<ShopBootstrap>("/shops/setup-status", {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return cacheShopBootstrap(bootstrap);
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
