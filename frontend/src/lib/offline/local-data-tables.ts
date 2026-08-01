export const EXPORT_TABLES = [
  "products", "customers", "bills", "bill_items", "payments", "customer_ledger",
  "inventory_movements", "suppliers", "purchase_bills", "staff_users", "settings",
] as const;

export const LOCAL_DATA_TABLES = [
  ...EXPORT_TABLES, "sync_outbox", "sync_cursor", "sync_conflicts", "id_mappings",
  "local_audit_logs", "subscription_cache", "device_license_cache",
] as const;
