import type { Table } from "dexie";
import {
  dexieDB,
  offlineDB,
  rowMatchesCurrentScope,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { writeInstantCache } from "@/lib/offline/instant-cache";
import {
  dedupeBillsForDisplay,
  dedupePaymentsForDisplay,
  findDuplicateLocalPaymentForServerPayment,
} from "@/features/sync/bill-reconciliation";
import { storeConflict } from "@/features/sync/sync-conflicts";
import {
  putIdMapping,
  replaceLocalEntityId,
} from "@/features/sync/sync-id-mapping";
import {
  isLocalPurchaseOverride,
  loadPurchaseOverrideMatcher,
  rowMatchesPurchaseOverride,
} from "@/features/purchases/sync-guards";
import {
  entityTypeFromOperation,
  getStringFrom,
  isRecord,
  tableNameForEntity,
  UNSYNCED_STATUSES,
  type MergeServerChangeStatus,
} from "@/features/sync/sync-types";
import type { SyncPullChange } from "@/types/api";
import type { SyncStatus } from "@/types/domain";
import { calculateLedgerBalance, dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/ledger/accounting";

async function findExistingServerRow(
  tableName: string,
  serverId: string,
  localId?: string,
): Promise<Record<string, unknown> | undefined> {
  const table = dexieDB.table(tableName) as Table<
    Record<string, unknown>,
    string
  >;
  const candidates = [serverId, localId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  for (const id of candidates) {
    const row = await table.get(id);
    if (row && rowMatchesCurrentScope(row)) return row;
  }
  const byServerId = await table
    .where("server_id")
    .equals(serverId)
    .filter(rowMatchesCurrentScope)
    .first()
    .catch(() => undefined);
  if (byServerId) return byServerId;
  if (localId) {
    const byLocalId = await table
      .where("local_id")
      .equals(localId)
      .filter(rowMatchesCurrentScope)
      .first()
      .catch(() => undefined);
    if (byLocalId) return byLocalId;
  }
  return undefined;
}

export async function findLocalIdForServerId(
  serverId: string,
): Promise<string | undefined> {
  const mapping = await dexieDB.id_mappings
    .where("server_id")
    .equals(serverId)
    .filter(rowMatchesCurrentScope)
    .first()
    .catch(() => undefined);
  return mapping?.local_id;
}

function serverEntityFromChange(
  change: SyncPullChange,
): Record<string, unknown> {
  const entity = isRecord(change.entity) ? change.entity : undefined;
  const payload = isRecord(change.payload) ? change.payload : undefined;
  return { ...(payload ?? {}), ...(entity ?? {}) };
}


function readNumberField(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const parsed = Number(record[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeLedgerSourceType(row: Record<string, unknown>): string {
  return String(row.source_type ?? row.sourceType ?? row.type ?? "").trim().toLowerCase();
}

function ledgerSourceId(row: Record<string, unknown>): string | undefined {
  return getStringFrom(row, [
    "source_id",
    "sourceId",
    "bill_id",
    "billId",
    "payment_id",
    "paymentId",
    "local_bill_id",
    "localBillId",
  ]);
}

async function findDuplicateLocalLedgerForServerLedger(
  serverLedger: Record<string, unknown>,
  serverId: string,
): Promise<Record<string, unknown> | undefined> {
  const sourceType = normalizeLedgerSourceType(serverLedger);
  if (!(sourceType === "bill" || sourceType === "debit" || String(serverLedger.type ?? "").toUpperCase() === "BILL")) {
    return undefined;
  }

  const serverBillId = ledgerSourceId(serverLedger);
  if (!serverBillId) return undefined;
  const mappedLocalBillId = await findLocalIdForServerId(serverBillId);
  const billIds = new Set([serverBillId, mappedLocalBillId].filter((value): value is string => Boolean(value)));
  const amount = Math.abs(readNumberField(serverLedger, ["amount"], 0));
  const customerId = getStringFrom(serverLedger, ["customerId", "customer_id"]);

  const rows = await dexieDB.customer_ledger
    .filter(rowMatchesCurrentScope)
    .toArray()
    .catch(() => [] as Record<string, unknown>[]);

  return rows.find((row) => {
    if (row.deleted_at != null || row.deletedAt != null) return false;
    if (getStringFrom(row, ["id"]) === serverId || getStringFrom(row, ["server_id", "serverId"]) === serverId) return true;
    if (getStringFrom(row, ["server_id", "serverId"])) return false;
    const rowSourceType = normalizeLedgerSourceType(row);
    const rowIsBill = rowSourceType === "bill" || rowSourceType === "debit" || String(row.type ?? "").toUpperCase() === "BILL";
    if (!rowIsBill) return false;
    const rowSourceId = ledgerSourceId(row);
    if (!rowSourceId || !billIds.has(rowSourceId)) return false;
    const rowAmount = Math.abs(readNumberField(row, ["amount"], 0));
    if (Math.abs(rowAmount - amount) > 0.005) return false;
    const rowCustomerId = getStringFrom(row, ["customerId", "customer_id"]);
    return !customerId || !rowCustomerId || customerId === rowCustomerId;
  });
}

export async function mergeServerChange(
  change: SyncPullChange,
): Promise<MergeServerChangeStatus> {
  const entityType = String(change.entity_type ?? change.entityType ?? "");
  const tableName = tableNameForEntity(entityType);
  if (!tableName) return "ignored";

  if (tableName === "settings") {
    const entity = serverEntityFromChange(change);
    const key = getStringFrom(entity, ["key", "id"]);
    if (!key) return "ignored";
    await dexieDB.settings.put({
      key,
      value: entity.value ?? entity,
      tenant_id: getOfflineScope().tenant_id,
      store_id: getOfflineScope().store_id,
      updated_at: nowIso(),
      expires_at:
        typeof entity.expires_at === "number" ? entity.expires_at : null,
    });
    return "merged";
  }

  const entity = serverEntityFromChange(change);
  const serverId =
    getStringFrom(change, [
      "entity_id",
      "entityId",
      "server_id",
      "serverId",
      "id",
    ]) ?? getStringFrom(entity, ["server_id", "serverId", "id"]);
  if (!serverId) return "ignored";

  const mappedLocalId = await findLocalIdForServerId(serverId);
  const localId =
    getStringFrom(entity, ["local_id", "localId"]) ?? mappedLocalId;
  const duplicatePayment =
    tableName === "payments"
      ? await findDuplicateLocalPaymentForServerPayment(entity)
      : undefined;
  const duplicateLedger =
    tableName === "customer_ledger"
      ? await findDuplicateLocalLedgerForServerLedger(entity, serverId)
      : undefined;
  const duplicateLocalId = getStringFrom(duplicatePayment ?? duplicateLedger ?? {}, ["id", "local_id", "localId"]);
  const effectiveLocalId = localId ?? duplicateLocalId;
  const existing =
    duplicatePayment ??
    duplicateLedger ??
    (await findExistingServerRow(tableName, serverId, effectiveLocalId));

  if (tableName === "purchase_bills") {
    const serverPurchase = {
      ...entity,
      id: serverId,
      server_id: serverId,
      local_id: effectiveLocalId ?? localId,
    };
    const matcher = await loadPurchaseOverrideMatcher().catch(() => ({ keys: new Set<string>() }));
    const localOverrideWins =
      (existing && isLocalPurchaseOverride(existing)) ||
      rowMatchesPurchaseOverride(serverPurchase, matcher);
    if (localOverrideWins) {
      await putIdMapping(
        entityTypeFromOperation("", entityType),
        effectiveLocalId,
        serverId,
      );
      return "ignored";
    }
  }

  if (
    existing &&
    !duplicatePayment &&
    !duplicateLedger &&
    UNSYNCED_STATUSES.has(
      String(existing.sync_status ?? "synced") as SyncStatus,
    )
  ) {
    await storeConflict({
      entityType: entityTypeFromOperation("", entityType),
      entityId: getStringFrom(existing, ["id"]) ?? serverId,
      sourceId:
        getStringFrom(change, ["change_id"]) ??
        String(change.server_version ?? change.version ?? Date.now()),
      localSnapshot: existing,
      serverSnapshot: entity,
      errorMessage: "Server changed an entity that has unsynced local changes",
    });
    const table = dexieDB.table(tableName) as Table<
      Record<string, unknown>,
      string
    >;
    await table.put({
      ...existing,
      sync_status: "conflict",
      updated_at: nowIso(),
    });
    return "conflict";
  }

  await putIdMapping(
    entityTypeFromOperation("", entityType),
    effectiveLocalId,
    serverId,
  );
  await replaceLocalEntityId(entityType, effectiveLocalId ?? serverId, serverId, entity);
  return "merged";
}


function rowIdSet(row: Record<string, unknown>): Set<string> {
  return new Set(
    [row.id, row.local_id, row.localId, row.server_id, row.serverId]
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

function ledgerCustomerId(row: Partial<CustomerLedgerEntry>): string | null {
  const id = row.customerId ?? row.customer_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function refreshCustomerBalancesFromLocalLedger(): Promise<void> {
  const customers = await offlineDB.getAll<Record<string, unknown>>("customers").catch(() => []);
  const ledger = dedupeLedgerEntries(await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []));
  if (customers.length === 0 || ledger.length === 0) return;

  const table = dexieDB.customers as Table<Record<string, unknown>, string>;
  const now = nowIso();
  for (const customer of customers) {
    const ids = rowIdSet(customer);
    if (ids.size === 0) continue;
    const entries = ledger.filter((entry) => {
      if (entry.deleted_at != null || entry.deletedAt != null) return false;
      const customerId = ledgerCustomerId(entry);
      return customerId ? ids.has(customerId) : false;
    });
    if (entries.length === 0) continue;
    const balance = Math.round((Math.max(0, calculateLedgerBalance(entries)) + Number.EPSILON) * 100) / 100;
    const current = Number(customer.udharAmount ?? customer.totalUdhar ?? 0);
    if (Number.isFinite(current) && Math.abs(current - balance) < 0.005) continue;
    await table.put({
      ...customer,
      type: balance > 0 ? "udhar" : (customer.type ?? "regular"),
      udharAmount: balance,
      totalUdhar: balance,
      udhar_amount: balance,
      total_udhar: balance,
      updatedAt: typeof customer.updatedAt === "string" ? customer.updatedAt : now,
      updated_at: typeof customer.updated_at === "string" ? customer.updated_at : now,
    });
  }
}

export async function refreshBusinessCaches(): Promise<void> {
  await refreshCustomerBalancesFromLocalLedger().catch(() => undefined);
  const listRows = async <T extends Record<string, unknown>>(
    tableName: string,
    limit = 500,
  ) => {
    const rows = await offlineDB.getAll<T>(tableName).catch(() => []);
    return rows
      .filter((row) => row.deleted_at == null && row.deletedAt == null)
      .sort((a, b) =>
        String(
          b.updated_at ?? b.updatedAt ?? b.created_at ?? b.createdAt ?? "",
        ).localeCompare(
          String(
            a.updated_at ?? a.updatedAt ?? a.created_at ?? a.createdAt ?? "",
          ),
        ),
      )
      .slice(0, limit);
  };

  await Promise.all([
    listRows("products", 1000).then((rows) =>
      writeInstantCache("products", rows, 30),
    ),
    listRows("customers", 1000).then((rows) =>
      writeInstantCache("customers", rows, 30),
    ),
    listRows("bills", 500).then((rows) =>
      writeInstantCache("bills", dedupeBillsForDisplay(rows), 30),
    ),
    listRows("payments", 1000).then((rows) =>
      writeInstantCache("payments", dedupePaymentsForDisplay(rows), 30),
    ),
    listRows("customer_ledger", 1000).then((rows) =>
      writeInstantCache("customer_ledger", dedupeLedgerEntries(rows as CustomerLedgerEntry[]), 30),
    ),
    listRows("suppliers", 500).then((rows) =>
      writeInstantCache("suppliers", rows, 30),
    ),
    listRows("inventory_movements", 1000).then((rows) =>
      writeInstantCache("inventory_movements", rows, 30),
    ),
    listRows("purchase_bills", 1000).then((rows) =>
      writeInstantCache("purchase_bills", rows, 30),
    ),
  ]);
}
