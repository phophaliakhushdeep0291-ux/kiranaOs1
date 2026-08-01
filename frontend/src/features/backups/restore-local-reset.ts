import { offlineDB } from "@/lib/offline/db";
import { clearInstantMemoryCache } from "@/lib/offline/instant-cache";
import { clearAuthStorage } from "@/lib/storage/auth-storage";

const RESTORED_SCOPE_TABLES = [
  "products", "customers", "bills", "bill_items", "payments", "customer_ledger",
  "inventory_movements", "suppliers", "purchase_bills", "staff_users", "settings",
  "sync_outbox", "sync_cursor", "sync_conflicts", "id_mappings", "local_audit_logs",
  "subscription_cache", "device_license_cache",
] as const;

export async function resetDeviceAfterCloudRestore() {
  await offlineDB.clearScopedData([...RESTORED_SCOPE_TABLES]);
  clearInstantMemoryCache();
  clearAuthStorage();
}
