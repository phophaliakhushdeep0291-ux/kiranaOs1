import type { Table } from "dexie";
import {
  dexieDB,
  offlineDB,
  rowMatchesCurrentScope,
  type OfflineRow,
  type PendingSyncEvent,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import {
  entityTypeFromOperation,
  getStringFrom,
  getVersion,
  isLocalId,
  isRecord,
  tableNameForEntity,
} from "@/features/sync/sync-types";

export function deepReplaceMappedIds(
  value: unknown,
  idMap: Record<string, string>,
): unknown {
  if (typeof value === "string") return idMap[value] ?? value;
  if (Array.isArray(value))
    return value.map((item) => deepReplaceMappedIds(item, idMap));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      deepReplaceMappedIds(item, idMap),
    ]),
  );
}

const LOCAL_IDENTITY_PAYLOAD_KEYS = new Set([
  "id",
  "local_id",
  "localId",
  "paymentId",
  "payment_id",
  "clientPaymentId",
  "client_payment_id",
  "localBillId",
  "local_bill_id",
  "clientBillId",
  "client_bill_id",
  "localItemId",
  "local_item_id",
  "localPaymentId",
  "local_payment_id",
  "localCustomerId",
  "local_customer_id",
  "ledgerEntryId",
  "ledger_entry_id",
  "clientLedgerId",
  "client_ledger_id",
  "localLedgerEntryId",
  "local_ledger_entry_id",
  "localLedgerId",
  "local_ledger_id",
  "movementId",
  "movement_id",
  "clientMovementId",
  "client_movement_id",
  "localMovementId",
  "local_movement_id",
  "inventoryMovementId",
  "inventory_movement_id",
  "localInventoryMovementId",
  "local_inventory_movement_id",
  "purchaseHistoryId",
  "purchase_history_id",
  "purchaseBillId",
  "purchase_bill_id",
  "localPurchaseHistoryId",
  "local_purchase_history_id",
  "localPurchaseBillId",
  "local_purchase_bill_id",
  "local_items",
  "local_payments",
  "local_ledger_entries",
]);

export function collectUnmappedLocalIds(
  value: unknown,
  idMap: Record<string, string>,
  allowedLocalIds = new Set<string>(),
): string[] {
  const found = new Set<string>();
  const walk = (item: unknown) => {
    if (isLocalId(item) && !idMap[item] && !allowedLocalIds.has(item)) {
      found.add(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (isRecord(item)) {
      for (const [key, child] of Object.entries(item)) {
        // Local child identity fields are sent to let the server echo mappings back.
        // They are not foreign-key references that should block CREATE_BILL push.
        if (LOCAL_IDENTITY_PAYLOAD_KEYS.has(key)) continue;
        walk(child);
      }
    }
  };
  walk(value);
  return [...found];
}

export async function putIdMapping(
  entityType: string,
  localId?: string,
  serverId?: string,
): Promise<void> {
  if (!localId || !serverId || localId === serverId) return;
  const scope = getOfflineScope();
  await dexieDB.id_mappings.put({
    local_id: localId,
    server_id: serverId,
    entity_type: entityType,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    updated_at: nowIso(),
  });
}


const ID_MAPPING_ENTITY_ALIASES: Record<string, string> = {
  products: "product",
  product: "product",
  customers: "customer",
  customer: "customer",
  bills: "bill",
  bill: "bill",
  payments: "payment",
  payment: "payment",
  suppliers: "supplier",
  supplier: "supplier",
  purchaseHistory: "purchase_history",
  purchase_history: "purchase_history",
  purchaseBills: "purchase_bill",
  purchase_bills: "purchase_bill",
  ledgerEntries: "ledger_entry",
  ledger_entries: "ledger_entry",
  ledgerEntry: "ledger_entry",
  ledger_entry: "ledger_entry",
  customerLedger: "ledger_entry",
  customer_ledger: "ledger_entry",
  udharLedger: "ledger_entry",
  udhar_ledger: "ledger_entry",
  stockLedger: "stock_ledger",
  stock_ledger: "stock_ledger",
  inventoryMovements: "inventory_movement",
  inventory_movements: "inventory_movement",
};

function normalizeMappingEntityType(entityType: string): string {
  return ID_MAPPING_ENTITY_ALIASES[entityType] ?? entityType;
}

export async function applyIdMappingsFromResponse(
  idMappings: unknown,
): Promise<number> {
  if (!isRecord(idMappings)) return 0;
  let applied = 0;
  for (const [rawEntityType, mappings] of Object.entries(idMappings)) {
    if (!isRecord(mappings)) continue;
    const entityType = normalizeMappingEntityType(rawEntityType);
    for (const [localId, serverId] of Object.entries(mappings)) {
      if (typeof localId !== "string" || typeof serverId !== "string") continue;
      if (!localId || !serverId || localId === serverId) continue;
      await putIdMapping(entityType, localId, serverId);
      await replaceLocalEntityId(entityType, localId, serverId);
      applied += 1;
    }
  }
  return applied;
}

export async function loadIdMap(): Promise<Record<string, string>> {
  const rows = await offlineDB
    .getAll<{ local_id: string; server_id: string }>("id_mappings")
    .catch(() => []);
  return Object.fromEntries(rows.map((row) => [row.local_id, row.server_id]));
}

const NON_REFERENCE_IDENTITY_KEYS = new Set([
  "id",
  "local_id",
  "localId",
  "server_id",
  "serverId",
  "clientEventId",
  "op_id",
  "opId",
  "idempotency_key",
  "idempotencyKey",
]);

function deepReplaceExact(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value))
    return value.map((item) => deepReplaceExact(item, from, to));
  if (!isRecord(value)) return value;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (NON_REFERENCE_IDENTITY_KEYS.has(key)) {
      next[key] = item;
      continue;
    }
    const replaced = deepReplaceExact(item, from, to);
    if (replaced !== item) changed = true;
    next[key] = replaced;
  }
  return changed ? next : value;
}

export async function replaceReferences(
  localId: string,
  serverId: string,
): Promise<void> {
  const tableNames = [
    "products",
    "customers",
    "bills",
    "bill_items",
    "payments",
    "customer_ledger",
    "inventory_movements",
    "suppliers",
    "purchase_bills",
    "settings",
    "sync_outbox",
  ];
  await dexieDB.transaction(
    "rw",
    tableNames.map((name) => dexieDB.table(name)),
    async () => {
      for (const name of tableNames) {
        const table = dexieDB.table(name) as Table<
          Record<string, unknown>,
          string
        >;
        await table.filter(rowMatchesCurrentScope).modify((row) => {
          const replaced = deepReplaceExact(row, localId, serverId);
          if (isRecord(replaced)) Object.assign(row, replaced);
        });
      }
    },
  );
}


function readMoneyFrom(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const parsed = Number(record[key] ?? undefined);
    if (Number.isFinite(parsed)) return Math.round((parsed + Number.EPSILON) * 100) / 100;
  }
  return fallback;
}

function sumPaymentMode(payments: unknown, credit: boolean): number {
  if (!Array.isArray(payments)) return 0;
  return Math.round((payments.reduce((sum, payment) => {
    if (!isRecord(payment)) return sum;
    const isCredit = String(payment.mode ?? "").toLowerCase() === "credit";
    if (isCredit !== credit) return sum;
    const amount = Number(payment.amount ?? 0);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0) + Number.EPSILON) * 100) / 100;
}

function protectLocalUdharFields(
  localRow: Record<string, unknown>,
  serverEntity: Record<string, unknown>,
  merged: OfflineRow,
): OfflineRow {
  const localCredit = readMoneyFrom(
    localRow,
    ["creditAmount", "credit_amount", "dueAmount", "due_amount"],
    sumPaymentMode(localRow.payments, true),
  );
  if (localCredit <= 0) return merged;

  const localPaid = readMoneyFrom(
    localRow,
    ["paidAmount", "paid_amount", "buyerPaidAmount", "buyer_paid_amount"],
    sumPaymentMode(localRow.payments, false),
  );
  const total = readMoneyFrom(
    merged,
    ["grandTotal", "grand_total", "totalAmount", "total_amount", "netAmount", "net_amount", "actualAmount", "actual_amount"],
    localPaid + localCredit,
  );
  const serverCredit = readMoneyFrom(
    serverEntity,
    ["creditAmount", "credit_amount", "dueAmount", "due_amount"],
    sumPaymentMode(serverEntity.payments, true),
  );
  const serverPaid = readMoneyFrom(
    serverEntity,
    ["paidAmount", "paid_amount", "buyerPaidAmount", "buyer_paid_amount"],
    sumPaymentMode(serverEntity.payments, false),
  );
  const serverHasCreditPayment = Array.isArray(serverEntity.payments) && serverEntity.payments.some((payment) => isRecord(payment) && String(payment.mode ?? "").toLowerCase() === "credit");
  const serverLooksAutoPaid = serverCredit <= 0.009 || serverPaid >= Math.max(0, total - 0.009) || serverHasCreditPayment;
  if (!serverLooksAutoPaid) return merged;

  return {
    ...merged,
    paidAmount: localPaid,
    paid_amount: localPaid,
    buyerPaidAmount: localPaid,
    buyer_paid_amount: localPaid,
    creditAmount: localCredit,
    credit_amount: localCredit,
    dueAmount: Math.round((Math.max(0, total - localPaid) + Number.EPSILON) * 100) / 100,
    due_amount: Math.round((Math.max(0, total - localPaid) + Number.EPSILON) * 100) / 100,
    paymentStatus: localCredit > 0 ? (localPaid > 0 ? "partial" : "credit") : "paid",
    payment_status: localCredit > 0 ? (localPaid > 0 ? "partial" : "credit") : "paid",
    payments: Array.isArray(localRow.payments) ? localRow.payments : merged.payments,
  };
}

function mergeServerIntoLocal(
  localRow: Record<string, unknown>,
  serverEntity: Record<string, unknown>,
  serverId: string,
  localId?: string,
): OfflineRow {
  const scope = getOfflineScope();
  const now = nowIso();
  const createdAt =
    serverEntity.created_at ??
    serverEntity.createdAt ??
    localRow.created_at ??
    localRow.createdAt ??
    now;
  const updatedAt = serverEntity.updated_at ?? serverEntity.updatedAt ?? now;
  const rawMergedInto = localRow.merged_into_id ?? localRow.mergedIntoId;
  const inheritedMergedInto = typeof rawMergedInto === "string" ? rawMergedInto : null;
  const merged = {
    ...localRow,
    ...serverEntity,
    id: serverId,
    local_id:
      localId ??
      (typeof localRow.local_id === "string" ? localRow.local_id : undefined),
    server_id: serverId,
    tenant_id:
      typeof serverEntity.tenant_id === "string"
        ? serverEntity.tenant_id
        : typeof localRow.tenant_id === "string"
          ? localRow.tenant_id
          : scope.tenant_id,
    store_id:
      typeof serverEntity.store_id === "string"
        ? serverEntity.store_id
        : typeof localRow.store_id === "string"
          ? localRow.store_id
          : scope.store_id,
    created_at: typeof createdAt === "string" ? createdAt : now,
    updated_at: typeof updatedAt === "string" ? updatedAt : now,
    deleted_at:
      typeof serverEntity.deleted_at === "string" ||
      serverEntity.deleted_at === null
        ? (serverEntity.deleted_at as string | null)
        : typeof localRow.deleted_at === "string" ||
            localRow.deleted_at === null
          ? (localRow.deleted_at as string | null)
          : null,
    version:
      getVersion(
        serverEntity.version ?? serverEntity.server_version ?? localRow.version,
      ) || 1,
    sync_status: "synced",
    last_modified_by:
      typeof serverEntity.last_modified_by === "string" ||
      serverEntity.last_modified_by === null
        ? (serverEntity.last_modified_by as string | null)
        : typeof localRow.last_modified_by === "string" ||
            localRow.last_modified_by === null
          ? (localRow.last_modified_by as string | null)
          : null,
    device_id:
      typeof localRow.device_id === "string"
        ? localRow.device_id
        : scope.device_id,
    // merged_into_id is LOCAL bookkeeping meaning "this row was retired into another".
    // The winner is built by spreading the local row, which may already be a tombstone
    // pointing at this very server id — and the server entity has no value to override
    // it. Left as-is the surviving row points at ITSELF, and every consumer that treats
    // merged_into_id as "gone" (financial aggregation, reports, sales, the bills list)
    // silently drops a real bill. A row can never be a twin of itself, so clear it.
    merged_into_id: inheritedMergedInto === serverId ? null : (localRow.merged_into_id ?? null),
    mergedIntoId: inheritedMergedInto === serverId ? null : (localRow.mergedIntoId ?? null),
  } as OfflineRow;

  return protectLocalUdharFields(localRow, serverEntity, merged);
}

function withSyncedBillFlagIfNeeded(
  tableName: string,
  row: OfflineRow,
  localId?: string,
): OfflineRow {
  if (tableName !== "bills") return row;
  return {
    ...row,
    sync_status: "synced",
    isSynced: true,
    is_synced: true,
    clientBillId:
      typeof row.clientBillId === "string"
        ? row.clientBillId
        : typeof row.client_bill_id === "string"
          ? row.client_bill_id
          : localId,
    client_bill_id:
      typeof row.client_bill_id === "string"
        ? row.client_bill_id
        : typeof row.clientBillId === "string"
          ? row.clientBillId
          : localId,
    localBillId:
      typeof row.localBillId === "string"
        ? row.localBillId
        : typeof row.local_bill_id === "string"
          ? row.local_bill_id
          : localId,
    local_bill_id:
      typeof row.local_bill_id === "string"
        ? row.local_bill_id
        : typeof row.localBillId === "string"
          ? row.localBillId
          : localId,
  };
}

export async function replaceLocalEntityId(
  entityType: string,
  localId?: string,
  serverId?: string,
  serverEntity?: Record<string, unknown>,
): Promise<void> {
  if (!serverId) return;
  const tableName = tableNameForEntity(entityType);
  if (!tableName || tableName === "settings") return;
  await dexieDB.open();
  const table = dexieDB.table(tableName) as Table<
    Record<string, unknown>,
    string
  >;
  const localCandidate = localId ? await table.get(localId) : undefined;
  const serverCandidate = await table.get(serverId);
  const localRow =
    localCandidate && rowMatchesCurrentScope(localCandidate)
      ? localCandidate
      : undefined;
  const serverRow =
    serverCandidate && rowMatchesCurrentScope(serverCandidate)
      ? serverCandidate
      : undefined;
  if (!localRow && !serverRow && !serverEntity) {
    if (localId && localId !== serverId) await replaceReferences(localId, serverId);
    return;
  }
  const baseRow = serverRow ?? localRow ?? {};
  const merged = withSyncedBillFlagIfNeeded(
    tableName,
    mergeServerIntoLocal(
      baseRow,
      serverEntity ?? {},
      serverId,
      localId,
    ),
    localId,
  );
  await table.put(merged);
  if (localId && localId !== serverId && localRow) {
    const financialTables = new Set([
      "bills",
      "bill_items",
      "payments",
      "customer_ledger",
      "inventory_movements",
      "purchase_bills",
    ]);
    if (financialTables.has(tableName)) {
      const now = nowIso();
      await table.put({
        ...localRow,
        server_id: serverId,
        merged_into_id: serverId,
        sync_status: "synced",
        isSynced: tableName === "bills" ? true : localRow.isSynced,
        is_synced: tableName === "bills" ? true : localRow.is_synced,
        deleted_at: now,
        deletedAt: now,
        updated_at: now,
        updatedAt: now,
      });
    } else {
      await table.delete(localId);
    }
  }
  if (localId && localId !== serverId)
    await replaceReferences(localId, serverId);
}

export async function markEntitySynced(
  event: PendingSyncEvent,
  serverEntity?: Record<string, unknown>,
  serverId?: string,
): Promise<void> {
  const entityType = entityTypeFromOperation(
    event.operation_type,
    event.entity_type,
  );
  const tableName = tableNameForEntity(entityType);
  if (!tableName || tableName === "settings") return;
  const id = serverId ?? event.entity_id;
  const table = dexieDB.table(tableName) as Table<
    Record<string, unknown>,
    string
  >;
  const candidate = (await table.get(id)) ?? (await table.get(event.entity_id));
  const row =
    candidate && rowMatchesCurrentScope(candidate) ? candidate : undefined;
  if (!row) return;
  const localId =
    serverId && serverId !== event.entity_id
      ? event.entity_id
      : getStringFrom(row, ["local_id", "localId"]);
  const merged = withSyncedBillFlagIfNeeded(
    tableName,
    mergeServerIntoLocal(
      row,
      serverEntity ?? {},
      id,
      localId,
    ),
    localId,
  );
  await table.put(merged);
}
