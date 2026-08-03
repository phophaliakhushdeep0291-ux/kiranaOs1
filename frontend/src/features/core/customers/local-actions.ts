import { offlineDB } from "@/lib/offline/db";
import { customerCreationSchema, ownerPinRequiredActionSchema } from "@/lib/validation";
import { createLocalId, removeCachedListItem, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { buildOutboxOperation, type EnqueueOutboxOperationInput } from "@/features/core/sync/outbox";
import { makeLocalEntity, parseOrThrow, touchLocalEntity, readNumber } from "@/lib/offline/actions/utils";
import type { Customer, CustomerInput } from "@/types/api";
import { buildAuditLogOutboxInput, buildAuditLogRow, type AuditLogRow } from "@/features/core/audit-logs/local-actions";

const CACHE_KEY = "customers";

const CUSTOMER_WRITE_TRANSACTION_TABLES = [
  "customers",
  "local_audit_logs",
  "sync_outbox",
];

type CustomerLocalRecord = Customer & {
  local_id?: string;
  server_id?: string;
  base_updated_at?: string;
  deleted_at?: string | null;
  deleteReason?: string | null;
  updated_at?: string;
  sync_status?: string;
};

export function normaliseLocalCustomer(customer: Customer): Customer {
  const udhar = Math.max(0, readNumber(customer.udharAmount ?? customer.totalUdhar, 0));
  return { ...customer, udharAmount: udhar, totalUdhar: udhar };
}

function toCustomer(data: CustomerInput, id = createLocalId("customer"), existing?: Customer): Customer {
  const now = new Date().toISOString();
  return normaliseLocalCustomer({
    ...existing,
    id,
    name: data.name?.trim() || existing?.name || "Customer",
    mobile: data.mobile?.trim() || existing?.mobile || null,
    type: data.type ?? existing?.type ?? "regular",
    reminderOverrideUntil: data.reminderOverrideUntil ?? existing?.reminderOverrideUntil ?? null,
    address: data.address ?? existing?.address ?? null,
    gstNumber: data.gstNumber ?? existing?.gstNumber ?? null,
    stateCode: data.stateCode ?? existing?.stateCode ?? null,
    dueDate: data.dueDate ?? existing?.dueDate ?? null,
    promiseToPayDate: data.promiseToPayDate ?? existing?.promiseToPayDate ?? null,
    udharLimit: data.udharLimit ?? existing?.udharLimit ?? undefined,
    customerSpecificPricing: data.customerSpecificPricing ?? existing?.customerSpecificPricing ?? null,
    notes: data.notes ?? existing?.notes ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  });
}

async function commitCustomerWrite(input: {
  customer: CustomerLocalRecord;
  auditLogs: AuditLogRow[];
  outbox: EnqueueOutboxOperationInput;
}) {
  const auditOutboxRows = input.auditLogs.map((row) => buildOutboxOperation(buildAuditLogOutboxInput(row)));
  const customerOutboxRow = buildOutboxOperation(input.outbox);

  await offlineDB.transaction(CUSTOMER_WRITE_TRANSACTION_TABLES, async (tx) => {
    await tx.put("customers", input.customer);
    for (const auditLog of input.auditLogs) {
      await tx.put("local_audit_logs", auditLog);
    }
    for (const auditOutbox of auditOutboxRows) {
      await tx.enqueueOutboxOperation(auditOutbox);
    }
    await tx.enqueueOutboxOperation(customerOutboxRow);
  });
}

export async function createCustomerLocalFirst(data: CustomerInput): Promise<Customer> {
  const validated = parseOrThrow(customerCreationSchema, { ...data, name: data.name ?? "" }) as unknown as CustomerInput;
  const customer = makeLocalEntity(toCustomer(validated), "customer", "pending_sync") as CustomerLocalRecord;

  await commitCustomerWrite({
    customer,
    auditLogs: [
      buildAuditLogRow({
        action: "customer_created",
        entityType: "customer",
        entityId: customer.id,
        entityLabel: customer.name,
        newValue: customer,
        summary: `Customer ${customer.name} created`,
      }),
    ],
    outbox: {
      entity_type: "customer",
      entity_id: customer.id,
      operation_type: "CREATE_CUSTOMER",
      payload: { localCustomerId: customer.id, customer: validated },
    },
  });

  upsertCachedListItem<Customer>(CACHE_KEY, customer, 1000);
  return customer;
}

export async function updateCustomerLocalFirst(id: string, data: CustomerInput): Promise<Customer> {
  const existing = await offlineDB.getAll<CustomerLocalRecord>("customers").then((rows) => rows.find((row) => row.id === id)).catch(() => undefined);
  const baseUpdatedAt = existing?.sync_status === "synced"
    ? existing.updatedAt ?? existing.updated_at
    : existing?.base_updated_at ?? existing?.updatedAt ?? existing?.updated_at;
  const candidate = { ...existing, ...data, name: data.name ?? existing?.name ?? "" };
  const validated = parseOrThrow(customerCreationSchema, candidate) as unknown as CustomerInput;
  const customer = {
    ...touchLocalEntity(toCustomer(validated, id, existing), "pending_sync"),
    ...(baseUpdatedAt ? { base_updated_at: baseUpdatedAt } : {}),
  } as CustomerLocalRecord;

  await commitCustomerWrite({
    customer,
    auditLogs: [
      buildAuditLogRow({
        action: "customer_edited",
        entityType: "customer",
        entityId: id,
        entityLabel: customer.name,
        oldValue: existing ?? null,
        newValue: customer,
        summary: `Customer ${customer.name} edited`,
      }),
    ],
    outbox: {
      entity_type: "customer",
      entity_id: id,
      operation_type: "UPDATE_CUSTOMER",
      payload: { customerId: id, customer: validated, ...(baseUpdatedAt ? { baseUpdatedAt } : {}) },
    },
  });

  upsertCachedListItem<Customer>(CACHE_KEY, customer, 1000);
  return customer;
}

export interface DeleteCustomerLocalFirstInput {
  id: string;
  ownerPin: string;
  reason?: string;
}

export async function deleteCustomerLocalFirst(input: DeleteCustomerLocalFirstInput): Promise<{ success: boolean; message?: string }> {
  const id = input.id.trim();
  const reason = input.reason?.trim() || "Moved to recycle bin";

  parseOrThrow(ownerPinRequiredActionSchema, {
    action: "delete_customer",
    ownerPin: input.ownerPin,
    entityId: id,
    reason,
  });

  const now = new Date().toISOString();
  const existing = await offlineDB
    .getAll<CustomerLocalRecord>("customers")
    .then((rows) => rows.find((row) => row.id === id || row.local_id === id || row.server_id === id))
    .catch(() => undefined);

  const deletedCustomer: CustomerLocalRecord = existing
    ? {
        ...existing,
        deletedAt: now,
        deleted_at: now,
        deleteReason: reason,
        updatedAt: now,
        updated_at: now,
        sync_status: "pending_sync" as const,
      }
    : makeLocalEntity(
        {
          id,
          name: "Deleted customer",
          mobile: null,
          type: "regular" as const,
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
          deleteReason: reason,
        },
        "customer",
        "pending_sync",
      ) as CustomerLocalRecord;

  await commitCustomerWrite({
    customer: deletedCustomer,
    auditLogs: [
      buildAuditLogRow({
        action: "customer_deleted",
        entityType: "customer",
        entityId: id,
        entityLabel: existing?.name ?? id,
        oldValue: existing ?? null,
        newValue: deletedCustomer,
        reason,
        ownerPinProvided: true,
        summary: `Customer ${existing?.name ?? id} moved to recycle bin`,
      }),
    ],
    outbox: {
      entity_type: "customer",
      entity_id: id,
      operation_type: "DELETE_CUSTOMER_PENDING",
      idempotency_key: `delete-customer:${id}`,
      payload: {
        customerId: id,
        localCustomerId: deletedCustomer.local_id ?? id,
        serverCustomerId: deletedCustomer.server_id ?? null,
        reason,
        ownerPinProvided: true,
        ownerPin: input.ownerPin,
      },
    },
  });

  removeCachedListItem<Customer>(CACHE_KEY, id);
  return { success: true, message: "Customer delete queued for sync" };
}
