import { offlineDB } from "@/lib/offline/db";
import { nowIso } from "@/lib/offline/context";
import { upsertCachedListItem } from "@/lib/offline/instant-cache";
import { buildOutboxOperation } from "@/features/core/sync/outbox";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import { parseOrThrow } from "@/lib/offline/actions/utils";
import { buildAuditLogOutboxInput, buildAuditLogRow } from "@/features/core/audit-logs/local-actions";
import type { Customer, Product, Supplier } from "@/types/api";

export type RecyclableEntityType = "customer" | "product" | "supplier";

const TABLE_BY_TYPE: Record<RecyclableEntityType, string> = {
  customer: "customers",
  product: "products",
  supplier: "suppliers",
};

const CACHE_BY_TYPE: Record<RecyclableEntityType, string> = {
  customer: "customers",
  product: "products",
  supplier: "suppliers",
};

const RESTORE_OPERATION_BY_TYPE: Record<RecyclableEntityType, "RESTORE_CUSTOMER_PENDING" | "RESTORE_PRODUCT_PENDING" | "RESTORE_SUPPLIER_PENDING"> = {
  customer: "RESTORE_CUSTOMER_PENDING",
  product: "RESTORE_PRODUCT_PENDING",
  supplier: "RESTORE_SUPPLIER_PENDING",
};

function entityLabel(row: Record<string, unknown>) {
  return String(row.name ?? row.billNumber ?? row.billNo ?? row.id);
}

export async function restoreEntityFromRecycleBinLocalFirst(type: RecyclableEntityType, id: string, ownerPin: string, reason?: string) {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "restore_from_recycle_bin", ownerPin, entityId: id, reason });
  const table = TABLE_BY_TYPE[type];
  const rows = await offlineDB.getAll<Record<string, unknown>>(table).catch(() => []);
  const existing = rows.find((row) => row.id === id || row.local_id === id || row.server_id === id);
  if (!existing) throw new Error(`${type} not found in recycle bin`);
  const now = nowIso();
  const restored: Record<string, unknown> & { id: string } = {
    ...existing,
    id: String(existing.id ?? id),
    deletedAt: null,
    deleted_at: null,
    restoreReason: reason?.trim() || null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync" as const,
  };
  const serverId = typeof restored.server_id === "string" && restored.server_id ? restored.server_id : null;
  const restoreOutboxRow = buildOutboxOperation({
    entity_type: type,
    entity_id: restored.id,
    operation_type: RESTORE_OPERATION_BY_TYPE[type],
    payload: {
      entityType: type,
      entityId: restored.id,
      // Every restore backend resolves its own id from `serverXId ?? xId ?? localXId ?? id`,
      // so `id` is the single spelling all three of them accept from this shared builder —
      // `entityId`/`localId`/`serverId` are names only this file uses. Without it the event
      // reaches the server carrying no id it recognises and 400s ("productId required for
      // RESTORE_PRODUCT sync event"): the bin empties and the row comes back on this device
      // while the server keeps it deleted, and nothing is shown to the shop.
      id: serverId ?? restored.id,
      localId: String(restored.local_id ?? restored.id),
      serverId,
      reason: reason ?? null,
      ownerPin,
      ownerPinProvided: true,
    },
  });
  const auditLog = buildAuditLogRow({
    action: `${type}_restored`,
    entityType: type,
    entityId: restored.id,
    entityLabel: entityLabel(restored),
    oldValue: existing,
    newValue: restored,
    reason,
    ownerPinProvided: ownerPin.length > 0,
    summary: `Restored ${type} ${entityLabel(restored)}`,
  });
  const auditOutboxRow = buildOutboxOperation(buildAuditLogOutboxInput(auditLog));

  await offlineDB.transaction([table, "local_audit_logs", "sync_outbox"], async (tx) => {
    await tx.put(table, restored);
    await tx.put("local_audit_logs", auditLog);
    await tx.enqueueOutboxOperation(auditOutboxRow);
    await tx.enqueueOutboxOperation(restoreOutboxRow);
  });

  upsertCachedListItem<Customer | Product | Supplier>(CACHE_BY_TYPE[type], restored as unknown as Customer | Product | Supplier, 1000);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kirana:local-data-changed", { detail: { type, id: restored.id, action: "restored" } }));
  }
  return restored;
}

export function permanentDeleteDisabledMessage(type: string) {
  if (type === "bill") return "Financial bill records cannot be permanently deleted. Keep them soft-deleted for audit and ledger safety.";
  return "Permanent delete is disabled for normal staff. The owner/backend retention policy must approve final removal.";
}
