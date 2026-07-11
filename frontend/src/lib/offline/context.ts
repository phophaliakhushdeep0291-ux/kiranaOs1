import { loadAuthSession } from "@/lib/storage/auth-storage";
import { getPermanentDeviceId } from "@/lib/device-identity";

export interface OfflineScope {
  tenant_id: string;
  store_id: string;
  device_id: string;
}

const DEFAULT_TENANT_ID = "local_tenant";
const DEFAULT_STORE_ID = "local_store";
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
    device_id: getPermanentDeviceId(),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
