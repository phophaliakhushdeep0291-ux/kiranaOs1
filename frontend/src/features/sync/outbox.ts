import { offlineDB, type PendingSyncEvent } from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { createLocalId } from "@/lib/offline/instant-cache";

export type SyncOutboxStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";

export type SyncOutboxOperationType =
  | "CREATE_CUSTOMER"
  | "UPDATE_CUSTOMER"
  | "DELETE_CUSTOMER_PENDING"
  | "CREATE_PRODUCT"
  | "UPDATE_PRODUCT"
  | "DELETE_PRODUCT_PENDING"
  | "CREATE_BILL"
  | "CANCEL_BILL_PENDING"
  | "SOFT_DELETE_BILL_PENDING"
  | "RESTORE_BILL_PENDING"
  | "RECORD_PAYMENT"
  | "REVERSE_PAYMENT"
  | "CREATE_LEDGER_ADJUSTMENT"
  | "STOCK_PURCHASE"
  | "STOCK_SALE"
  | "STOCK_DAMAGE"
  | "STOCK_CORRECTION"
  | "UPDATE_PURCHASE_BILL"
  | "DELETE_PURCHASE_BILL"
  | "CREATE_SUPPLIER"
  | "UPDATE_SUPPLIER"
  | "DELETE_SUPPLIER_PENDING"
  | "UPDATE_SETTINGS"
  | "STAFF_ACTION"
  | "SUBSCRIPTION_REFRESH"
  | "DEVICE_ADD_PENDING"
  | "DEVICE_REMOVE_PENDING"
  | "AUDIT_LOG_APPEND"
  | "RESTORE_CUSTOMER_PENDING"
  | "RESTORE_PRODUCT_PENDING"
  | "RESTORE_SUPPLIER_PENDING";

export type SyncOutboxEntityType =
  | "customer"
  | "product"
  | "bill"
  | "payment"
  | "ledger_entry"
  | "inventory_movement"
  | "purchase_history"
  | "supplier"
  | "settings"
  | "staff"
  | "subscription"
  | "device_license"
  | "audit_log";

export interface EnqueueOutboxOperationInput {
  entity_type: SyncOutboxEntityType;
  entity_id: string;
  operation_type: SyncOutboxOperationType;
  payload: Record<string, unknown>;
  op_id?: string;
  idempotency_key?: string;
}

export function createOutboxId(prefix = "op") {
  return createLocalId(prefix);
}

export function buildOutboxOperation(input: EnqueueOutboxOperationInput): PendingSyncEvent {
  const scope = getOfflineScope();
  const opId = input.op_id ?? createOutboxId(input.operation_type.toLowerCase());
  const now = nowIso();
  return {
    op_id: opId,
    clientEventId: opId,
    type: input.operation_type,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    operation_type: input.operation_type,
    payload: input.payload,
    client_created_at: now,
    status: "PENDING",
    retry_count: 0,
    idempotency_key: input.idempotency_key ?? opId,
    error_message: null,
    last_attempt_at: null,
    createdAt: Date.now(),
    attempts: 0,
    sync_status: "pending_sync",
    next_retry_at: null,
    last_error: null,
  };
}

export async function enqueueOutboxOperation(input: EnqueueOutboxOperationInput): Promise<PendingSyncEvent> {
  const row = buildOutboxOperation(input);
  await offlineDB.enqueueOutboxOperation(row);
  return row;
}
