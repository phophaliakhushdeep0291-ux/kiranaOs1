import { loadAuthSession } from "@/lib/storage/auth-storage";

export interface OfflineScope {
  tenant_id: string;
  store_id: string;
  device_id: string;
}

const DEFAULT_TENANT_ID = "local_tenant";
const DEFAULT_STORE_ID = "local_store";
const DEVICE_ID_KEY = "kirana-os:device-id:v1";

function safeStorageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Device id is only a local convenience. If storage is blocked, regenerate per session.
    }
  }
}

function ensureDeviceId(): string {
  const existing = safeStorageGet(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = `device_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  safeStorageSet(DEVICE_ID_KEY, generated);
  return generated;
}

export function getOfflineScope(): OfflineScope {
  const session = loadAuthSession();
  const shop = session.shop;
  const user = session.user;
  const shopId = typeof shop?.id === "string" ? shop.id : undefined;
  const userShopId = typeof user?.shopId === "string" ? user.shopId : undefined;
  const tenantId = shopId ?? userShopId ?? DEFAULT_TENANT_ID;

  return {
    tenant_id: tenantId,
    store_id: shopId ?? userShopId ?? DEFAULT_STORE_ID,
    device_id: ensureDeviceId(),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
