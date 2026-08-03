import { offlineDB } from "@/lib/offline/db";
import { ownerPinRequiredActionSchema, supplierCreationSchema } from "@/lib/validation";
import { createLocalId, emitLocalDataChanged, removeCachedListItem, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { buildOutboxOperation, type EnqueueOutboxOperationInput } from "@/features/core/sync/outbox";
import { makeLocalEntity, parseOrThrow, touchLocalEntity } from "@/lib/offline/actions/utils";
import type { Supplier } from "@/types/api";
import { buildAuditLogOutboxInput, buildAuditLogRow, type WriteAuditLogInput } from "@/features/core/audit-logs/local-actions";

const CACHE_KEY = "suppliers";
async function commitSupplierMutation(supplier: Supplier, auditInput: WriteAuditLogInput, outboxInput: EnqueueOutboxOperationInput) {
  const audit = buildAuditLogRow(auditInput);
  const auditOutbox = buildOutboxOperation(buildAuditLogOutboxInput(audit));
  const operationOutbox = buildOutboxOperation(outboxInput);
  await offlineDB.transaction(["suppliers", "local_audit_logs", "sync_outbox"], async (tx) => {
    await tx.put("suppliers", supplier);
    await tx.put("local_audit_logs", audit);
    await tx.enqueueOutboxOperation(auditOutbox);
    await tx.enqueueOutboxOperation(operationOutbox);
  });
}

function toSupplier(data: Partial<Supplier>, id = createLocalId("supplier"), existing?: Supplier): Supplier {
  const now = new Date().toISOString();
  return {
    ...existing,
    id,
    name: data.name?.trim() || existing?.name || "Supplier",
    mobile: data.mobile?.trim() || existing?.mobile || null,
    address: data.address ?? existing?.address ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export async function createSupplierLocalFirst(data: Partial<Supplier>): Promise<Supplier> {
  const validated = parseOrThrow(supplierCreationSchema, { ...data, name: data.name ?? "" }) as unknown as Partial<Supplier>;
  const supplier = makeLocalEntity(toSupplier(validated), "supplier", "pending_sync");
  await commitSupplierMutation(
    supplier,
    { action: "supplier_created", entityType: "supplier", entityId: supplier.id, entityLabel: supplier.name, newValue: supplier, summary: `Supplier ${supplier.name} created` },
    { entity_type: "supplier", entity_id: supplier.id, operation_type: "CREATE_SUPPLIER", idempotency_key: `create-supplier:${supplier.id}`, payload: { localSupplierId: supplier.id, supplier: data } },
  );
  upsertCachedListItem<Supplier>(CACHE_KEY, supplier, 1000);
  emitLocalDataChanged({ type: "supplier", id: supplier.id, action: "created" });
  return supplier;
}

export async function updateSupplierLocalFirst(id: string, data: Partial<Supplier>): Promise<Supplier> {
  const existing = await offlineDB.getAll<Supplier>("suppliers").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  const validated = parseOrThrow(supplierCreationSchema, { ...existing, ...data, name: data.name ?? existing?.name ?? "" }) as unknown as Partial<Supplier>;
  const supplier = touchLocalEntity(toSupplier(validated, id, existing), "pending_sync");
  await commitSupplierMutation(
    supplier,
    { action: "supplier_edited", entityType: "supplier", entityId: id, entityLabel: supplier.name, oldValue: existing ?? null, newValue: supplier, summary: `Supplier ${supplier.name} edited` },
    { entity_type: "supplier", entity_id: id, operation_type: "UPDATE_SUPPLIER", idempotency_key: `update-supplier:${id}:${String((supplier as Supplier & { updatedAt?: string }).updatedAt ?? "")}`, payload: { supplierId: id, supplier: data } },
  );
  upsertCachedListItem<Supplier>(CACHE_KEY, supplier, 1000);
  emitLocalDataChanged({ type: "supplier", id: supplier.id, action: "updated" });
  return supplier;
}

export interface DeleteSupplierLocalFirstInput {
  id: string;
  ownerPin: string;
  reason?: string;
}

export async function deleteSupplierLocalFirst(input: DeleteSupplierLocalFirstInput): Promise<{ success: true; pendingSync: true }> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "delete_supplier", ownerPin: input.ownerPin, reason: input.reason, entityId: input.id });
  const id = input.id;
  const now = new Date().toISOString();
  const existing = await offlineDB.getAll<Supplier>("suppliers").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  const deleted = { ...(existing ?? { id, name: "Deleted supplier" }), id, deletedAt: now, deleted_at: now, updatedAt: now, sync_status: "pending_sync" } as Supplier;
  await commitSupplierMutation(
    deleted,
    { action: "supplier_deleted", entityType: "supplier", entityId: id, entityLabel: existing?.name ?? id, oldValue: existing ?? null, reason: (input.reason?.trim() || "Moved to recycle bin"), ownerPinProvided: true, summary: `Supplier ${existing?.name ?? id} moved to recycle bin` },
    { entity_type: "supplier", entity_id: id, operation_type: "DELETE_SUPPLIER_PENDING", idempotency_key: `delete-supplier:${id}`, payload: { supplierId: id, ownerPin: input.ownerPin, reason: input.reason?.trim(), ownerPinProvided: true } },
  );
  removeCachedListItem<Supplier>(CACHE_KEY, id);
  emitLocalDataChanged({ type: "supplier", id, action: "deleted" });
  return { success: true, pendingSync: true };
}
