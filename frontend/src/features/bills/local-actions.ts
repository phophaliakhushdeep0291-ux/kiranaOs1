import { offlineDB } from "@/lib/offline/db";
import { createLocalId, emitLocalDataChanged, readInstantCache, upsertCachedListItem, writeInstantCache } from "@/lib/offline/instant-cache";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import { makeLocalEntity, parseOrThrow, readNumber, roundMoney } from "@/lib/offline/actions/utils";
import { ownerPinRequiredActionSchema } from "@/lib/validation";
import type { Bill, Customer } from "@/types/api";
import { writeAuditLog } from "@/features/audit-logs/local-actions";

const BILL_CACHE_KEY = "bills";
const CUSTOMER_CACHE_KEY = "customers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function billNumberOf(bill: Partial<Bill> & Record<string, unknown>) {
  return String(bill.billNumber ?? bill.billNo ?? bill.id ?? "bill");
}

async function findBill(id: string): Promise<(Bill & Record<string, unknown>) | undefined> {
  const rows = await offlineDB.getAll<Record<string, unknown>>("bills").catch(() => []);
  const match = rows.find((row) => row.id === id || row.local_id === id || row.server_id === id || row.billNo === id || row.billNumber === id);
  if (match) return match as Bill & Record<string, unknown>;
  return readInstantCache<Array<Bill & Record<string, unknown>>>(BILL_CACHE_KEY, []).find((bill) => bill.id === id || bill.billNo === id || bill.billNumber === id);
}

async function writeAudit(action: string, bill: Bill & Record<string, unknown>, ownerPin: string, reason?: string, oldValue?: unknown) {
  const normalizedAction = action === "cancel_bill" ? "bill_cancelled" : action === "soft_delete_bill" ? "bill_soft_deleted" : action === "restore_bill" ? "bill_restored" : action;
  await writeAuditLog({
    action: normalizedAction,
    entityType: "bill",
    entityId: bill.id,
    entityLabel: billNumberOf(bill),
    oldValue: oldValue ?? null,
    newValue: bill,
    reason,
    ownerPinProvided: ownerPin.length > 0,
    summary: `${normalizedAction.replaceAll("_", " ")} ${billNumberOf(bill)}`,
  });
}

function updateBillCache(updated: Bill & Record<string, unknown>) {
  const cached = readInstantCache<Array<Bill & Record<string, unknown>>>(BILL_CACHE_KEY, []);
  const next = cached.map((bill) => bill.id === updated.id ? { ...bill, ...updated } : bill);
  if (!next.some((bill) => bill.id === updated.id)) next.unshift(updated);
  writeInstantCache(BILL_CACHE_KEY, next, 30);
  upsertCachedListItem(BILL_CACHE_KEY, updated, 500);
}

async function adjustCustomerUdhar(customerId: unknown, amountDelta: number) {
  if (typeof customerId !== "string" || !customerId || amountDelta === 0) return;
  const rows = await offlineDB.getAll<Customer & Record<string, unknown>>("customers").catch(() => []);
  const customer = rows.find((row) => row.id === customerId || row.local_id === customerId || row.server_id === customerId);
  if (!customer) return;
  const nextUdhar = Math.max(0, roundMoney(readNumber(customer.udharAmount ?? customer.totalUdhar, 0) + amountDelta));
  const updated = { ...customer, udharAmount: nextUdhar, totalUdhar: nextUdhar, updatedAt: new Date().toISOString(), sync_status: "pending_sync" as const };
  await offlineDB.put("customers", updated);
  upsertCachedListItem<Customer & Record<string, unknown>>(CUSTOMER_CACHE_KEY, updated, 1000);
}

async function createCancellationLedgerCorrection(bill: Bill & Record<string, unknown>, reason?: string) {
  const credit = readNumber(bill.creditAmount, 0);
  const now = new Date().toISOString();
  if (credit <= 0 && !bill.customerId) return;
  const entry = makeLocalEntity({
    id: createLocalId("ledger_cancel"),
    customerId: bill.customerId ?? null,
    customer_id: bill.customerId ?? null,
    customerName: bill.customerName ?? null,
    type: "bill_cancel_correction",
    source_type: "bill",
    source_id: bill.id,
    billId: bill.id,
    bill_id: bill.id,
    amount: -Math.abs(credit),
    note: reason || `Cancelled ${billNumberOf(bill)}`,
    entry_at: now,
    createdAt: now,
    created_at: now,
  }, "ledger_entry", "pending_sync");
  await offlineDB.put("customer_ledger", entry);
  await adjustCustomerUdhar(bill.customerId, -Math.abs(credit));
}

// Mirror of createCancellationLedgerCorrection for restores: the server re-applies the bill's
// udhar when a bill is restored, so the local ledger re-adds the debt immediately too.
async function createRestoreLedgerCorrection(bill: Bill & Record<string, unknown>, reason?: string) {
  const credit = readNumber(bill.creditAmount, 0);
  const now = new Date().toISOString();
  if (credit <= 0 || !bill.customerId) return;
  const entry = makeLocalEntity({
    id: createLocalId("ledger_restore"),
    customerId: bill.customerId ?? null,
    customer_id: bill.customerId ?? null,
    customerName: bill.customerName ?? null,
    type: "bill_restore_correction",
    source_type: "bill",
    source_id: bill.id,
    billId: bill.id,
    bill_id: bill.id,
    amount: Math.abs(credit),
    note: reason || `Restored ${billNumberOf(bill)}`,
    entry_at: now,
    createdAt: now,
    created_at: now,
  }, "ledger_entry", "pending_sync");
  await offlineDB.put("customer_ledger", entry);
  await adjustCustomerUdhar(bill.customerId, Math.abs(credit));
}

export async function cancelBillWithOwnerPinLocalFirst(id: string, ownerPin: string, reason?: string): Promise<Bill> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "cancel_bill", ownerPin, entityId: id, reason });
  const existing = await findBill(id);
  if (!existing) throw new Error("Bill not found in local records");
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    status: "cancelled",
    cancelled_at: now,
    cancelReason: reason?.trim() || null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync" as const,
    isSynced: false,
    is_synced: false,
  } as Bill & Record<string, unknown>;
  await offlineDB.put("bills", updated);
  await createCancellationLedgerCorrection(updated, reason);
  await writeAudit("cancel_bill", updated, ownerPin, reason, existing);
  updateBillCache(updated);
  await enqueueOutboxOperation({
    entity_type: "bill",
    entity_id: updated.id,
    operation_type: "CANCEL_BILL_PENDING",
    payload: { billId: updated.id, localBillId: updated.local_id ?? updated.id, serverBillId: updated.server_id ?? null, reason: reason ?? null, ownerPin, ownerPinProvided: true },
  });
  emitLocalDataChanged({ type: "bill", id: updated.id, action: "cancelled" });
  return updated;
}

export async function softDeleteBillWithOwnerPinLocalFirst(id: string, ownerPin: string, reason?: string): Promise<Bill> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "delete_bill", ownerPin, entityId: id, reason });
  const existing = await findBill(id);
  if (!existing) throw new Error("Bill not found in local records");
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    deleted_at: now,
    deletedAt: now,
    deleteReason: reason?.trim() || null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync" as const,
    isSynced: false,
    is_synced: false,
  } as Bill & Record<string, unknown>;
  await offlineDB.put("bills", updated);
  await writeAudit("soft_delete_bill", updated, ownerPin, reason, existing);
  updateBillCache(updated);
  await enqueueOutboxOperation({
    entity_type: "bill",
    entity_id: updated.id,
    operation_type: "SOFT_DELETE_BILL_PENDING",
    payload: { billId: updated.id, localBillId: updated.local_id ?? updated.id, serverBillId: updated.server_id ?? null, reason: reason ?? null, ownerPin, ownerPinProvided: true },
  });
  emitLocalDataChanged({ type: "bill", id: updated.id, action: "soft_deleted" });
  return updated;
}

export async function restoreBillWithOwnerPinLocalFirst(id: string, ownerPin: string, reason?: string): Promise<Bill> {
  parseOrThrow(ownerPinRequiredActionSchema, { action: "restore_from_recycle_bin", ownerPin, entityId: id, reason });
  const existing = await findBill(id);
  if (!existing) throw new Error("Bill not found in local records");
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    deleted_at: null,
    deletedAt: null,
    restoreReason: reason?.trim() || null,
    updatedAt: now,
    updated_at: now,
    sync_status: "pending_sync" as const,
    isSynced: false,
    is_synced: false,
  } as Bill & Record<string, unknown>;
  await offlineDB.put("bills", updated);
  // Restoring from the recycle bin syncs as RESTORE_BILL, which re-applies the bill's udhar on
  // the server — re-add the customer's debt locally right away so balances stay coherent offline.
  // The recycle-bin move wrote the matching -credit correction, so this nets out exactly.
  await writeAudit("restore_bill", updated, ownerPin, reason, existing);
  updateBillCache(updated);
  await enqueueOutboxOperation({
    entity_type: "bill",
    entity_id: updated.id,
    operation_type: "RESTORE_BILL_PENDING",
    payload: { billId: updated.id, localBillId: updated.local_id ?? updated.id, serverBillId: updated.server_id ?? null, reason: reason ?? null, ownerPin, ownerPinProvided: true },
  });
  emitLocalDataChanged({ type: "bill", id: updated.id, action: "restored" });
  return updated;
}

export function isDeletedBill(value: unknown) {
  return isRecord(value) && (typeof value.deleted_at === "string" || typeof value.deletedAt === "string");
}
