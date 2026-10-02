import { tableNameForEntity } from "@/features/core/sync/sync-types";

export const BUSINESS_CACHE_LIMITS: Record<string, number> = { products: 1000, customers: 1000, bills: 500, payments: 1000, customer_ledger: 1000, suppliers: 500, inventory_movements: 1000, purchase_bills: 1000 };

/** Includes derived balances and references rewritten when an entity's ID changes. */
export function cacheTablesForEntity(entity: string): string[] | null {
  const name = entity === "purchase" ? "purchase_bills" : entity === "product_import" ? "products" : entity === "inventory_lot" ? "inventory_movements" : tableNameForEntity(entity);
  switch (name) {
    case "products": return ["products", "inventory_movements", "bills", "purchase_bills"];
    case "bills": case "bill_items": return ["bills", "payments", "customer_ledger", "customers", "products", "inventory_movements"];
    case "customers": case "customer_ledger": case "payments": return ["customers", "customer_ledger", "payments", "bills"];
    case "inventory_movements": return ["products", "inventory_movements"];
    case "suppliers": return ["suppliers", "purchase_bills"];
    case "purchase_bills": return ["purchase_bills", "suppliers", "products", "inventory_movements"];
    case "expenses": case "settings": case "subscription_cache": case "device_license_cache": case "local_audit_logs": return [];
    default: return null;
  }
}
