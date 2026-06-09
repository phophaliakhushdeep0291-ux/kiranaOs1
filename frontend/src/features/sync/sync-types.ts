import type { PendingSyncEvent, SyncOutboxStatus } from "@/lib/offline/db";
import type {
  SyncPullResponse,
  SyncPushEventResult,
  SyncPushOperationPayload,
} from "@/types/api";
import type { SyncStatus } from "@/types/domain";

export const SYNC_BATCH_SIZE = 50;
export const DEFAULT_CURSOR_ID = "global";
export const LOCAL_ID_PREFIXES = [
  "customer_",
  "product_",
  "bill_",
  "payment_",
  "supplier_",
  "ledger_",
  "stock_",
  "bill_item_",
  "device_",
  "local-",
  "local_",
  "tmp_",
  "temp_",
];

export const UNSYNCED_STATUSES = new Set<SyncStatus>([
  "local_only",
  "pending_sync",
  "syncing",
  "failed",
  "conflict",
]);
export const SUCCESS_STATUSES = new Set([
  "synced",
  "sync_synced",
  "success",
  "ok",
  "duplicate",
]);
export const CONFLICT_STATUSES = new Set(["conflict", "sync_conflict"]);

export interface SyncRunResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  failed: number;
  pending: number;
  skipped: number;
  cursor?: string | number | null;
}

export interface PreparedOperation {
  event: PendingSyncEvent;
  operation: SyncPushOperationPayload;
}

export interface EntityIdPair {
  entityType: string;
  localId?: string;
  serverId?: string;
  serverEntity?: Record<string, unknown>;
}

export type MergeServerChangeStatus = "merged" | "conflict" | "ignored";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLocalId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    LOCAL_ID_PREFIXES.some((prefix) => value.startsWith(prefix))
  );
}

export function statusToSyncStatus(status: SyncOutboxStatus): SyncStatus {
  if (status === "SYNCING") return "syncing";
  if (status === "SYNCED") return "synced";
  if (status === "FAILED") return "failed";
  if (status === "CONFLICT") return "conflict";
  return "pending_sync";
}

export function tableNameForEntity(entityType?: string): string | null {
  const normalized = String(entityType ?? "")
    .toLowerCase()
    .replace(/-/g, "_");
  const map: Record<string, string> = {
    product: "products",
    products: "products",
    customer: "customers",
    customers: "customers",
    bill: "bills",
    bills: "bills",
    bill_item: "bill_items",
    bill_items: "bill_items",
    payment: "payments",
    payments: "payments",
    ledger: "customer_ledger",
    ledger_entry: "customer_ledger",
    customer_ledger: "customer_ledger",
    inventory: "inventory_movements",
    inventory_movement: "inventory_movements",
    inventory_movements: "inventory_movements",
    stock_ledger: "inventory_movements",
    stockledger: "inventory_movements",
    udhar_ledger: "customer_ledger",
    udharledger: "customer_ledger",
    supplier: "suppliers",
    suppliers: "suppliers",
    purchase_bill: "purchase_bills",
    purchase_bills: "purchase_bills",
    purchase_history: "purchase_bills",
    purchasehistory: "purchase_bills",
    setting: "settings",
    settings: "settings",
    subscription: "subscription_cache",
    subscription_cache: "subscription_cache",
    device_license: "device_license_cache",
    device_license_cache: "device_license_cache",
    staff: "local_audit_logs",
    staff_action: "local_audit_logs",
    audit_log: "local_audit_logs",
    audit_logs: "local_audit_logs",
  };
  return map[normalized] ?? null;
}

export function entityTypeFromOperation(operationType: string, fallback?: string) {
  if (fallback && fallback !== "unknown") return fallback;
  if (operationType.includes("CUSTOMER")) return "customer";
  if (operationType.includes("PRODUCT")) return "product";
  if (operationType.includes("BILL")) return "bill";
  if (operationType.includes("PAYMENT")) return "payment";
  if (operationType.includes("LEDGER")) return "ledger_entry";
  if (operationType.includes("STOCK")) return "inventory_movement";
  if (operationType.includes("PURCHASE")) return "purchase_history";
  if (operationType.includes("SUPPLIER")) return "supplier";
  if (operationType.includes("SETTINGS")) return "settings";
  if (operationType.includes("SUBSCRIPTION")) return "subscription";
  if (operationType.includes("STAFF")) return "staff";
  if (operationType.includes("AUDIT")) return "audit_log";
  return fallback ?? "unknown";
}

export function getStringFrom(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function getVersion(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function nextCursorFromResponse(
  response: SyncPullResponse | Record<string, unknown>,
): string | number | null | undefined {
  const sync = isRecord(response.sync) ? response.sync : {};
  const value =
    sync.nextCursor ??
    sync.next_cursor ??
    response.next_cursor ??
    response.nextCursor ??
    response.cursor ??
    response.server_version;
  return typeof value === "string" ||
    typeof value === "number" ||
    value === null ||
    value === undefined
    ? value
    : undefined;
}

export function resultListFromPush(
  response: Record<string, unknown>,
): SyncPushEventResult[] {
  const results = response.results ?? response.operations;
  return Array.isArray(results)
    ? (results.filter(isRecord) as SyncPushEventResult[])
    : [];
}

export function normalizeResultStatus(
  result: SyncPushEventResult,
): "success" | "conflict" | "failed" {
  const status = String(result.status ?? "").toLowerCase();
  if (result.success === true || SUCCESS_STATUSES.has(status)) return "success";
  if (CONFLICT_STATUSES.has(status) || isRecord(result.conflict))
    return "conflict";
  return "failed";
}

export function entityIdKeys(entityType: string) {
  const normalized = entityType.toLowerCase();
  const specific: Record<string, string[]> = {
    customer: ["customerId", "customer_id"],
    product: ["productId", "product_id"],
    bill: ["billId", "bill_id", "serverBillId", "server_bill_id"],
    payment: ["paymentId", "payment_id"],
    supplier: ["supplierId", "supplier_id"],
    purchase_bill: ["purchaseHistoryId", "purchase_history_id", "purchaseBillId", "purchase_bill_id"],
    purchase_history: ["purchaseHistoryId", "purchase_history_id", "purchaseBillId", "purchase_bill_id"],
    inventory_movement: [
      "movementId",
      "movement_id",
      "inventoryMovementId",
      "inventory_movement_id",
      "stockLedgerId",
      "stock_ledger_id",
    ],
    ledger_entry: ["ledgerEntryId", "ledger_entry_id"],
  };
  return ["server_id", "serverId", "id", ...(specific[normalized] ?? [])];
}

export function localIdKeys(entityType: string) {
  const normalized = entityType.toLowerCase();
  const specific: Record<string, string[]> = {
    customer: ["localCustomerId", "local_customer_id"],
    product: ["localProductId", "local_product_id"],
    bill: ["localBillId", "local_bill_id", "clientBillId", "client_bill_id"],
    payment: ["localPaymentId", "local_payment_id"],
    supplier: ["localSupplierId", "local_supplier_id"],
    purchase_bill: ["localPurchaseHistoryId", "local_purchase_history_id", "localPurchaseBillId", "local_purchase_bill_id"],
    purchase_history: ["localPurchaseHistoryId", "local_purchase_history_id", "localPurchaseBillId", "local_purchase_bill_id"],
    inventory_movement: ["localMovementId", "local_movement_id", "localInventoryMovementId", "local_inventory_movement_id"],
  };
  return ["local_id", "localId", ...(specific[normalized] ?? [])];
}

export function extractIdPair(
  result: SyncPushEventResult,
  event?: PendingSyncEvent,
): EntityIdPair {
  const eventEntityType = entityTypeFromOperation(
    event?.operation_type ?? event?.type ?? "",
    event?.entity_type,
  );
  const resultEntityType = getStringFrom(result, ["entity_type", "entityType"]);
  const resultRecord = isRecord(result.result) ? result.result : {};
  const entity = isRecord(result.entity)
    ? result.entity
    : isRecord(resultRecord.entity)
      ? (resultRecord.entity as Record<string, unknown>)
      : resultRecord;
  const entityType = entityTypeFromOperation(
    event?.operation_type ?? event?.type ?? "",
    resultEntityType ?? eventEntityType,
  );
  const serverId =
    getStringFrom(result, entityIdKeys(entityType)) ??
    getStringFrom(resultRecord, entityIdKeys(entityType)) ??
    getStringFrom(entity, entityIdKeys(entityType));
  const localId =
    getStringFrom(result, localIdKeys(entityType)) ??
    getStringFrom(resultRecord, localIdKeys(entityType)) ??
    getStringFrom(entity, localIdKeys(entityType)) ??
    event?.entity_id;
  return {
    entityType,
    localId,
    serverId,
    serverEntity: Object.keys(entity).length > 0 ? entity : undefined,
  };
}
