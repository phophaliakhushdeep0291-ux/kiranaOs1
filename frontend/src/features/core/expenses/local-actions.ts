import { buildOutboxOperation } from "@/features/core/sync/outbox";
import { offlineDB } from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { createLocalId, emitLocalDataChanged } from "@/lib/offline/instant-cache";
import type { Expense, ExpenseInput } from "@/types/api";

type LocalExpense = Expense & {
  local_id: string;
  server_id?: string;
  tenant_id: string;
  store_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  sync_status: "pending_sync" | "syncing" | "synced" | "failed" | "conflict" | "local_only";
};

export async function createExpenseLocalFirst(data: ExpenseInput): Promise<Expense> {
  const scope = getOfflineScope();
  const now = nowIso();
  const id = data.clientExpenseId?.trim() || createLocalId("expense");
  const idempotencyKey = data.idempotencyKey?.trim() || `create-expense:${id}`;
  const expense: LocalExpense = {
    id,
    local_id: id,
    title: data.title.trim(),
    amount: Number(data.amount),
    category: data.category || "general",
    paymentMode: data.paymentMode || "cash",
    vendor: data.vendor?.trim() || null,
    status: data.status || "paid",
    recurringInterval: data.recurringInterval || "none",
    nextDueOn: data.nextDueOn || null,
    notes: data.notes?.trim() || null,
    spentAt: data.spentAt || now,
    createdAt: now,
    updatedAt: now,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1,
    sync_status: "pending_sync",
  };
  const outbox = buildOutboxOperation({
    entity_type: "expense",
    entity_id: id,
    operation_type: "CREATE_EXPENSE",
    idempotency_key: idempotencyKey,
    payload: {
      localExpenseId: id,
      expense: { ...data, clientExpenseId: id, idempotencyKey },
    },
  });
  await offlineDB.transaction(["expenses", "sync_outbox"], async (tx) => {
    await tx.put("expenses", expense);
    await tx.enqueueOutboxOperation(outbox);
  });
  emitLocalDataChanged({ type: "expense", id, action: "created" });
  return expense;
}

export async function updateExpenseLocalFirst(id: string, data: ExpenseInput): Promise<Expense> {
  const existing = await offlineDB.getAll<LocalExpense>("expenses")
    .then((rows) => rows.find((row) => row.id === id || row.server_id === id));
  if (!existing) throw new Error("Expense is not cached on this device");
  const now = nowIso();
  const expense: LocalExpense = {
    ...existing,
    ...data,
    id: existing.id,
    local_id: existing.local_id || existing.id,
    title: data.title.trim(),
    amount: Number(data.amount),
    vendor: data.vendor?.trim() || null,
    notes: data.notes?.trim() || null,
    updatedAt: now,
    updated_at: now,
    version: existing.version + 1,
    sync_status: "pending_sync",
  };
  const opId = createLocalId("update-expense");
  const outbox = buildOutboxOperation({
    op_id: opId,
    entity_type: "expense",
    entity_id: existing.id,
    operation_type: "UPDATE_EXPENSE",
    idempotency_key: opId,
    payload: {
      expenseId: existing.server_id || existing.id,
      localExpenseId: existing.local_id || existing.id,
      changes: data,
    },
  });
  await offlineDB.transaction(["expenses", "sync_outbox"], async (tx) => {
    await tx.put("expenses", expense);
    await tx.enqueueOutboxOperation(outbox);
  });
  emitLocalDataChanged({ type: "expense", id: existing.id, action: "updated" });
  return expense;
}

export async function deleteExpenseLocalFirst(id: string, ownerPin: string): Promise<void> {
  if (!/^\d{4}$/.test(ownerPin)) throw new Error("Enter the 4-digit owner PIN");
  const existing = await offlineDB.getAll<LocalExpense>("expenses")
    .then((rows) => rows.find((row) => row.id === id || row.server_id === id));
  if (!existing) throw new Error("Expense is not cached on this device");
  const now = nowIso();
  const deleted: LocalExpense = {
    ...existing,
    deletedAt: now,
    deleted_at: now,
    updatedAt: now,
    updated_at: now,
    version: existing.version + 1,
    sync_status: "pending_sync",
  };
  const opId = createLocalId("delete-expense");
  const outbox = buildOutboxOperation({
    op_id: opId,
    entity_type: "expense",
    entity_id: existing.id,
    operation_type: "DELETE_EXPENSE",
    idempotency_key: opId,
    payload: {
      expenseId: existing.server_id || existing.id,
      localExpenseId: existing.local_id || existing.id,
      ownerPin,
    },
  });
  await offlineDB.transaction(["expenses", "sync_outbox"], async (tx) => {
    await tx.put("expenses", deleted);
    await tx.enqueueOutboxOperation(outbox);
  });
  emitLocalDataChanged({ type: "expense", id: existing.id, action: "deleted" });
}

export async function listLocalExpenses(): Promise<Expense[]> {
  return offlineDB.getAll<LocalExpense>("expenses")
    .then((rows) => rows.filter((row) => !row.deletedAt && !row.deleted_at))
    .catch(() => []);
}

export async function cacheServerExpenses(rows: Expense[]): Promise<void> {
  const scope = getOfflineScope();
  const now = nowIso();
  const local = await offlineDB.getAll<LocalExpense>("expenses").catch(() => []);
  const pendingIds = new Set(local
    .filter((row) => row.sync_status !== "synced")
    .flatMap((row) => [row.id, row.local_id, row.server_id].filter((id): id is string => typeof id === "string")));
  const safeRows = rows
    .filter((row) => !pendingIds.has(row.id))
    .map((row) => ({
      ...row,
      id: row.id,
      server_id: row.id,
      tenant_id: scope.tenant_id,
      store_id: scope.store_id,
      device_id: scope.device_id,
      created_at: row.createdAt || now,
      updated_at: row.updatedAt || now,
      deleted_at: row.deletedAt || null,
      version: 1,
      sync_status: "synced" as const,
    }));
  if (safeRows.length) await offlineDB.putMany("expenses", safeRows);
}

export function mergeExpenseSnapshots(server: Expense[], local: Expense[]): Expense[] {
  const byIdentity = new Map<string, Expense>();
  for (const row of server) byIdentity.set(row.id, row);
  for (const row of local) {
    const ids = [row.id, (row as LocalExpense).server_id].filter((id): id is string => typeof id === "string");
    for (const id of ids) byIdentity.delete(id);
    byIdentity.set(row.id, row);
  }
  return [...byIdentity.values()].sort((a, b) => String(b.spentAt).localeCompare(String(a.spentAt)));
}
