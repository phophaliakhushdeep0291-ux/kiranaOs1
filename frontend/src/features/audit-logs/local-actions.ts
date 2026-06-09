import { offlineDB } from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { createLocalId } from "@/lib/offline/instant-cache";
import { enqueueOutboxOperation, type EnqueueOutboxOperationInput } from "@/features/sync/outbox";
import type { SyncStatus } from "@/types/domain";

export type AuditAction =
  | "bill_created"
  | "bill_cancelled"
  | "bill_soft_deleted"
  | "bill_restored"
  | "payment_recorded"
  | "payment_reversed"
  | "customer_created"
  | "customer_edited"
  | "customer_deleted"
  | "customer_restored"
  | "product_created"
  | "product_edited"
  | "product_deleted"
  | "product_restored"
  | "stock_adjusted"
  | "staff_login"
  | "staff_action"
  | "owner_pin_action"
  | "subscription_change"
  | "device_activation"
  | "sync_conflict"
  | "supplier_created"
  | "supplier_edited"
  | "supplier_deleted"
  | "supplier_restored";

export interface WriteAuditLogInput {
  action: AuditAction | string;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  userId?: string | null;
  userName?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ownerPinProvided?: boolean;
  summary?: string | null;
  syncStatus?: SyncStatus;
  enqueueSync?: boolean;
}

export interface AuditLogRow extends Record<string, unknown> {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label?: string | null;
  actor_id: string;
  actor_name: string;
  device_id: string;
  reason?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  summary?: string | null;
  owner_pin_provided?: boolean;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
}

export function buildAuditLogRow(input: WriteAuditLogInput): AuditLogRow {
  const scope = getOfflineScope();
  const now = nowIso();
  const id = createLocalId("audit");
  return {
    id,
    local_id: id,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    entity_label: input.entityLabel ?? null,
    actor_id: input.userId ?? "local-user",
    actor_name: input.userName ?? "Local user",
    reason: input.reason?.trim() || null,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    summary: input.summary ?? `${input.action.replaceAll("_", " ")} ${input.entityLabel ?? input.entityId}`,
    owner_pin_provided: Boolean(input.ownerPinProvided),
    createdAt: now,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: input.syncStatus ?? "pending_sync",
    last_modified_by: input.userId ?? "local-user",
  };
}

export function buildAuditLogOutboxInput(row: AuditLogRow): EnqueueOutboxOperationInput {
  return {
    entity_type: "audit_log",
    entity_id: row.id,
    operation_type: "AUDIT_LOG_APPEND",
    idempotency_key: `audit-log:${row.tenant_id}:${row.store_id}:${row.id}`,
    payload: { auditLogId: row.id, auditLog: row },
  };
}

export async function writeAuditLog(input: WriteAuditLogInput): Promise<AuditLogRow> {
  const row = buildAuditLogRow(input);
  await offlineDB.put("local_audit_logs", row);
  if (input.enqueueSync ?? true) {
    await enqueueOutboxOperation(buildAuditLogOutboxInput(row));
  }
  return row;
}
