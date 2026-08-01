import { offlineDB } from "@/lib/offline/db";
import { clearInstantMemoryCache } from "@/lib/offline/instant-cache";
import { clearAuthStorage } from "@/lib/storage/auth-storage";
import { LOCAL_DATA_TABLES } from "@/lib/offline/local-data-tables";
import { getOfflineScope } from "@/lib/offline/context";

export async function resetDeviceAfterCloudRestore(shopId?: string) {
  try {
    const restoredShopId = shopId ?? getOfflineScope().tenant_id;
    if (!restoredShopId || restoredShopId === "local_tenant") throw new Error("Restore shop scope is unavailable");
    await offlineDB.clearScopedData([...LOCAL_DATA_TABLES], { tenant_id: restoredShopId, store_id: restoredShopId });
  } catch {
    // A stale outbox must never survive a cloud restore. If the scoped wipe
    // cannot be proven, clear this device's entire local database fail-closed.
    await offlineDB.clearAllData();
  }
  clearInstantMemoryCache();
  clearAuthStorage();
}
