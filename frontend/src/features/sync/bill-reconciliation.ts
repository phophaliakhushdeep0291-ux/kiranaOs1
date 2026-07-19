import { roundMoney } from "@/lib/money";
import type { Table } from "dexie";
import {
  dexieDB,
  offlineDB,
  rowMatchesCurrentScope,
  type PendingSyncEvent,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import {
  writeInstantCache,
  pruneRecentRows,
} from "@/lib/offline/instant-cache";
import type { Bill, SyncPushEventResult } from "@/types/api";

const FINANCIAL_TABLES = [
  "bills",
  "bill_items",
  "payments",
  "customer_ledger",
  "inventory_movements",
] as const;

type MutableRow = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringFrom(record: unknown, keys: string[]): string | undefined {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function getArrayFrom(record: unknown, keys: string[]): MutableRow[] {
  if (!isRecord(record)) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function getNumberFrom(record: unknown, keys: string[]): number | undefined {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}




function readMoney(record: unknown, keys: string[], fallback = 0): number {
  const value = getNumberFrom(record, keys);
  return value === undefined ? fallback : roundMoney(value);
}

function paymentMode(payment: unknown): string {
  return isRecord(payment) ? String(payment.mode ?? "").toLowerCase() : "";
}

function isCreditPayment(payment: unknown): boolean {
  return paymentMode(payment) === "credit";
}

function sumPayments(payments: unknown[], credit: boolean): number {
  return roundMoney(
    payments
      .filter((payment) => isCreditPayment(payment) === credit)
      .reduce<number>((sum, payment) => sum + readMoney(payment, ["amount"], 0), 0),
  );
}

function billTotal(record: unknown): number {
  return readMoney(record, ["grandTotal", "grand_total", "totalAmount", "total_amount", "netAmount", "net_amount", "actualAmount", "actual_amount"], 0);
}

function billCreditAmount(record: unknown, payments: unknown[] = []): number {
  return readMoney(record, ["creditAmount", "credit_amount", "dueAmount", "due_amount"], sumPayments(payments, true));
}

function billPaidAmount(record: unknown, payments: unknown[] = []): number {
  return readMoney(record, ["paidAmount", "paid_amount", "buyerPaidAmount", "buyer_paid_amount"], sumPayments(payments, false));
}

function shouldProtectLocalUdhar(
  localBill: MutableRow | undefined,
  serverBill: MutableRow,
  serverPayments: MutableRow[],
): boolean {
  if (!localBill) return false;
  const localPayments = Array.isArray(localBill.payments) ? localBill.payments : [];
  const localCredit = billCreditAmount(localBill, localPayments);
  if (localCredit <= 0) return false;

  const total = billTotal(serverBill) || billTotal(localBill);
  const serverCredit = billCreditAmount(serverBill, serverPayments);
  const serverPaid = billPaidAmount(serverBill, serverPayments);
  const serverHasCreditPayment = serverPayments.some(isCreditPayment);

  return (
    serverCredit <= 0.009 ||
    serverPaid >= Math.max(0, total - 0.009) ||
    serverHasCreditPayment
  );
}

function localUdharIntegrityFields(localBill: MutableRow | undefined): MutableRow {
  if (!localBill) return {};
  const localPayments = Array.isArray(localBill.payments) ? localBill.payments : [];
  const paidAmount = billPaidAmount(localBill, localPayments);
  const creditAmount = billCreditAmount(localBill, localPayments);
  const total = billTotal(localBill);
  return {
    paidAmount,
    paid_amount: paidAmount,
    buyerPaidAmount: paidAmount,
    buyer_paid_amount: paidAmount,
    creditAmount,
    credit_amount: creditAmount,
    dueAmount: roundMoney(Math.max(0, total - paidAmount)),
    due_amount: roundMoney(Math.max(0, total - paidAmount)),
    paymentStatus: creditAmount > 0 ? (paidAmount > 0 ? "partial" : "credit") : "paid",
    payment_status: creditAmount > 0 ? (paidAmount > 0 ? "partial" : "credit") : "paid",
  };
}

const UNSYNCED_BILL_STATUSES = new Set([
  "local_only",
  "pending_sync",
  "syncing",
  "failed",
  "conflict",
  "draft",
]);

function readBooleanFrom(record: unknown, keys: string[]): boolean | undefined {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return undefined;
}

export function isBillSynced(bill: Record<string, unknown>): boolean {
  const explicit = readBooleanFrom(bill, ["isSynced", "is_synced"]);
  if (explicit !== undefined) return explicit;
  const syncStatus = String(bill.sync_status ?? "").toLowerCase();
  const status = String(bill.status ?? "").toLowerCase();
  if (UNSYNCED_BILL_STATUSES.has(syncStatus)) return false;
  if (UNSYNCED_BILL_STATUSES.has(status)) return false;
  return true;
}

/**
 * A "merged twin" is the local optimistic bill row after its server copy has
 * synced back: reconcile stamps merged_into_id (and deleted_at) on it. It is a
 * sync artifact, NOT a user-deleted bill, so it must never appear in the recycle
 * bin. Financial aggregation, reports, and sales already exclude merged_into_id;
 * this predicate lets the Bills recycle-bin view apply the same rule.
 */
export function isMergedBillTwin(bill: Record<string, unknown>): boolean {
  const mergedInto = typeof bill.merged_into_id === "string"
    ? bill.merged_into_id
    : typeof bill.mergedIntoId === "string" ? bill.mergedIntoId : null;
  if (!mergedInto) return false;
  // A row can never be a twin of ITSELF. The surviving row can inherit this marker
  // from the tombstone it replaced (same id), and treating that as "merged away"
  // would hide a real bill from the list.
  const self = [bill.id, bill.local_id, bill.server_id].filter((v) => typeof v === "string");
  return !self.includes(mergedInto);
}

export function withBillSyncFlag<T extends object>(bill: T): T & { isSynced: boolean; is_synced: boolean } {
  const synced = isBillSynced(bill as Record<string, unknown>);
  return {
    ...bill,
    isSynced: synced,
    is_synced: synced,
  };
}

function normalizeBillSignatureText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getBillTotalForSignature(bill: Record<string, unknown>): string | undefined {
  const amount = getNumberFrom(bill, [
    "grandTotal",
    "grand_total",
    "totalAmount",
    "total_amount",
    "netAmount",
    "net_amount",
  ]);
  return amount === undefined ? undefined : amount.toFixed(2);
}

function getBillCreatedBucket(bill: Record<string, unknown>): string | undefined {
  const created = getStringFrom(bill, ["createdAt", "created_at", "billDate", "bill_date"]);
  if (!created) return undefined;
  const time = new Date(created).getTime();
  if (!Number.isFinite(time)) return created.slice(0, 16);
  // Five-minute buckets are tight enough to catch local->server echoes without
  // hiding genuine repeated purchases later in the day.
  return String(Math.floor(time / (5 * 60 * 1000)));
}

function billItemSignature(bill: Record<string, unknown>): string | undefined {
  const items = getArrayFrom(bill, ["items", "billItems", "bill_items"]);
  if (items.length === 0) return undefined;
  return items
    .map((item) => {
      const name = normalizeBillSignatureText(getStringFrom(item, ["name", "productName", "product_name"]));
      const product = normalizeBillSignatureText(getStringFrom(item, ["productId", "product_id", "product_local_id"]));
      const qty = getNumberFrom(item, ["quantity", "qty"])?.toFixed(3) ?? "";
      const rate = getNumberFrom(item, ["ratePerRateUnit", "rate_per_rate_unit", "rate", "price"])?.toFixed(2) ?? "";
      return `${product || name}:${qty}:${rate}`;
    })
    .sort()
    .join(";");
}

function billContentSignature(bill: Record<string, unknown>): string | undefined {
  const total = getBillTotalForSignature(bill);
  const createdBucket = getBillCreatedBucket(bill);
  const items = billItemSignature(bill);
  if (!total || !createdBucket || !items) return undefined;
  const customer = normalizeBillSignatureText(
    getStringFrom(bill, ["customerId", "customer_id", "customerName", "customer_name", "customerMobile", "customer_mobile"]),
  );
  const billType = normalizeBillSignatureText(getStringFrom(bill, ["billType", "bill_type"]));
  return [createdBucket, billType, customer, total, items].join("|");
}

function sameOptionalScope(left: Record<string, unknown>, right: Record<string, unknown>, key: string): boolean {
  const leftValue = getStringFrom(left, [key]);
  const rightValue = getStringFrom(right, [key]);
  return !leftValue || !rightValue || leftValue === rightValue;
}

function billTimeDistanceMinutes(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftCreated = getStringFrom(left, ["createdAt", "created_at", "billDate", "bill_date"]);
  const rightCreated = getStringFrom(right, ["createdAt", "created_at", "billDate", "bill_date"]);
  if (!leftCreated || !rightCreated) return Number.POSITIVE_INFINITY;
  const leftTime = new Date(leftCreated).getTime();
  const rightTime = new Date(rightCreated).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime) / 60_000;
}

function sameMoney(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return true;
  return Math.abs(roundMoney(left) - roundMoney(right)) < 0.005;
}

function customerEchoKey(bill: Record<string, unknown>): string {
  return normalizeBillSignatureText(
    getStringFrom(bill, [
      "customerId",
      "customer_id",
      "customerName",
      "customer_name",
      "customerMobile",
      "customer_mobile",
      "mobile",
    ]),
  );
}

function customerMobileKey(bill: Record<string, unknown>): string {
  return normalizeBillSignatureText(getStringFrom(bill, ["customerMobile", "customer_mobile", "mobile"]));
}

function hasPendingLocalBillIdentity(bill: Record<string, unknown>): boolean {
  const billNo = normalizeBillSignatureText(getStringFrom(bill, ["billNo", "billNumber", "bill_no", "number"]));
  const id = normalizeBillSignatureText(getStringFrom(bill, ["id", "local_id", "localId", "clientBillId", "client_bill_id"]));
  return billNo.startsWith("pending") || id.includes("local") || id.includes("pending");
}

export function isLikelySyncedCopyOfPendingBill(
  pendingBill: Record<string, unknown>,
  syncedBill: Record<string, unknown>,
): boolean {
  if (isBillSynced(pendingBill) || !isBillSynced(syncedBill)) return false;
  if (!sameOptionalScope(pendingBill, syncedBill, "tenant_id")) return false;
  if (!sameOptionalScope(pendingBill, syncedBill, "store_id")) return false;

  const pendingTotal = getNumberFrom(pendingBill, ["grandTotal", "grand_total", "totalAmount", "total_amount", "netAmount", "net_amount"]);
  const syncedTotal = getNumberFrom(syncedBill, ["grandTotal", "grand_total", "totalAmount", "total_amount", "netAmount", "net_amount"]);
  if (!sameMoney(pendingTotal, syncedTotal)) return false;
  if (!sameMoney(getNumberFrom(pendingBill, ["paidAmount", "paid_amount"]), getNumberFrom(syncedBill, ["paidAmount", "paid_amount"]))) return false;
  if (!sameMoney(getNumberFrom(pendingBill, ["creditAmount", "credit_amount", "dueAmount", "due_amount"]), getNumberFrom(syncedBill, ["creditAmount", "credit_amount", "dueAmount", "due_amount"]))) return false;

  const pendingCustomer = customerEchoKey(pendingBill);
  const syncedCustomer = customerEchoKey(syncedBill);
  const pendingMobile = customerMobileKey(pendingBill);
  const syncedMobile = customerMobileKey(syncedBill);
  if (pendingMobile && syncedMobile && pendingMobile !== syncedMobile) return false;
  if (pendingCustomer && syncedCustomer && pendingCustomer !== syncedCustomer) return false;

  const pendingSignature = billContentSignature(pendingBill);
  const syncedSignature = billContentSignature(syncedBill);
  if (pendingSignature && syncedSignature) return pendingSignature === syncedSignature;

  return hasPendingLocalBillIdentity(pendingBill) && billTimeDistanceMinutes(pendingBill, syncedBill) <= 90;
}

function getServerEntityFromPushResult(
  result: SyncPushEventResult,
): MutableRow {
  const candidates = [
    result.bill,
    result.entity,
    result.result,
    isRecord(result.result) ? result.result.bill : undefined,
    isRecord(result.result) ? result.result.entity : undefined,
    isRecord(result.result) ? result.result.data : undefined,
    result.data,
    isRecord(result.data) ? result.data.bill : undefined,
  ];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const hasBillShape =
      getStringFrom(candidate, [
        "id",
        "billId",
        "bill_id",
        "server_id",
        "serverId",
        "billNo",
        "billNumber",
        "bill_no",
      ]) ||
      Array.isArray(candidate.items) ||
      Array.isArray(candidate.bill_items) ||
      Array.isArray(candidate.payments);
    if (hasBillShape) return candidate;
  }
  return {};
}

function getServerBillId(
  result: SyncPushEventResult,
  serverBill: MutableRow,
): string | undefined {
  return (
    getStringFrom(result, [
      "serverBillId",
      "server_bill_id",
      "billId",
      "bill_id",
      "server_id",
      "serverId",
      "entity_id",
      "entityId",
      "id",
    ]) ??
    getStringFrom(serverBill, [
      "id",
      "server_id",
      "serverId",
      "billId",
      "bill_id",
    ])
  );
}

function getLocalBillId(
  event: PendingSyncEvent,
  result: SyncPushEventResult,
  serverBill: MutableRow,
): string {
  return (
    getStringFrom(event.payload, [
      "localBillId",
      "local_bill_id",
      "clientBillId",
      "client_bill_id",
    ]) ??
    getStringFrom(result, [
      "localBillId",
      "local_bill_id",
      "local_id",
      "localId",
    ]) ??
    getStringFrom(serverBill, [
      "localBillId",
      "local_bill_id",
      "local_id",
      "localId",
    ]) ??
    event.entity_id
  );
}

function getBillNo(serverBill: MutableRow, localBill: MutableRow | undefined) {
  return (
    getStringFrom(serverBill, ["billNo", "billNumber", "bill_no", "number"]) ??
    getStringFrom(localBill, ["billNo", "billNumber", "bill_no", "number"])
  );
}

function getCreatedAt(server: MutableRow, local?: MutableRow) {
  return (
    getStringFrom(server, ["createdAt", "created_at"]) ??
    getStringFrom(local, ["createdAt", "created_at"]) ??
    nowIso()
  );
}

function getUpdatedAt(server: MutableRow, local?: MutableRow) {
  return (
    getStringFrom(server, ["updatedAt", "updated_at"]) ??
    getStringFrom(local, ["updatedAt", "updated_at"]) ??
    nowIso()
  );
}

function normalizeSyncedBill(
  localBill: MutableRow | undefined,
  existingServerBill: MutableRow | undefined,
  serverBill: MutableRow,
  localBillId: string,
  serverBillId: string,
): MutableRow {
  const scope = getOfflineScope();
  const billNo = getBillNo(serverBill, localBill ?? existingServerBill);
  const serverItems = getArrayFrom(serverBill, [
    "items",
    "billItems",
    "bill_items",
  ]);
  const serverPayments = getArrayFrom(serverBill, [
    "payments",
    "billPayments",
    "bill_payments",
  ]);
  const localItems = Array.isArray(localBill?.items) ? localBill.items : [];
  const localPayments = Array.isArray(localBill?.payments)
    ? localBill.payments
    : [];
  const serverStatus = getStringFrom(serverBill, ["status"]);
  const localStatus = getStringFrom(localBill, ["status"]);
  const nextStatus =
    serverStatus ??
    (localStatus === "pending_sync"
      ? "completed"
      : (localStatus ?? "completed"));
  const protectUdhar = shouldProtectLocalUdhar(localBill, serverBill, serverPayments);
  const safePayments = protectUdhar ? localPayments : (serverPayments.length > 0 ? serverPayments : localPayments);
  const udharFields = protectUdhar ? localUdharIntegrityFields(localBill) : {};

  return {
    ...(localBill ?? {}),
    ...(existingServerBill ?? {}),
    ...serverBill,
    id: serverBillId,
    local_id: localBillId,
    server_id: serverBillId,
    billNo,
    billNumber:
      getStringFrom(serverBill, [
        "billNumber",
        "billNo",
        "bill_no",
        "number",
      ]) ?? billNo,
    status: nextStatus,
    createdAt:
      getStringFrom(serverBill, ["createdAt", "created_at"]) ??
      getStringFrom(localBill, ["createdAt", "created_at"]),
    updatedAt: getUpdatedAt(serverBill, localBill),
    created_at: getCreatedAt(serverBill, localBill),
    updated_at: getUpdatedAt(serverBill, localBill),
    deleted_at: null,
    deletedAt: null,
    tenant_id:
      getStringFrom(serverBill, ["tenant_id", "tenantId"]) ??
      getStringFrom(localBill, ["tenant_id", "tenantId"]) ??
      scope.tenant_id,
    store_id:
      getStringFrom(serverBill, ["store_id", "storeId"]) ??
      getStringFrom(localBill, ["store_id", "storeId"]) ??
      scope.store_id,
    device_id:
      getStringFrom(localBill, ["device_id", "deviceId"]) ?? scope.device_id,
    sync_status: "synced",
    isSynced: true,
    is_synced: true,
    clientBillId:
      getStringFrom(serverBill, ["clientBillId", "client_bill_id"]) ??
      getStringFrom(localBill, ["clientBillId", "client_bill_id"]) ??
      localBillId,
    client_bill_id:
      getStringFrom(serverBill, ["client_bill_id", "clientBillId"]) ??
      getStringFrom(localBill, ["client_bill_id", "clientBillId"]) ??
      localBillId,
    localBillId,
    local_bill_id: localBillId,
    idempotency_key:
      getStringFrom(serverBill, ["idempotency_key", "idempotencyKey"]) ??
      getStringFrom(localBill, ["idempotency_key", "idempotencyKey"]),
    idempotencyKey:
      getStringFrom(serverBill, ["idempotencyKey", "idempotency_key"]) ??
      getStringFrom(localBill, ["idempotencyKey", "idempotency_key"]),
    version:
      getNumberFrom(serverBill, ["version", "server_version"]) ??
      getNumberFrom(localBill, ["version"]) ??
      1,
    items: serverItems.length > 0 ? serverItems : localItems,
    payments: safePayments,
    ...udharFields,
  };
}

async function putIdMapping(
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

async function getRowsByBillId(
  tableName: (typeof FINANCIAL_TABLES)[number],
  billId: string,
): Promise<MutableRow[]> {
  const table = dexieDB.table(tableName) as Table<MutableRow, string>;
  const rows = new Map<string, MutableRow>();
  const add = (items: MutableRow[]) =>
    items.forEach((item) => {
      const id = getStringFrom(item, ["id"]);
      if (id) rows.set(id, item);
    });
  await table
    .where("bill_id")
    .equals(billId)
    .filter(rowMatchesCurrentScope)
    .toArray()
    .then(add)
    .catch(() => undefined);
  await table
    .where("billId")
    .equals(billId)
    .filter(rowMatchesCurrentScope)
    .toArray()
    .then(add)
    .catch(() => undefined);
  await table
    .where("reference_id")
    .equals(billId)
    .filter(rowMatchesCurrentScope)
    .toArray()
    .then(add)
    .catch(() => undefined);
  return [...rows.values()];
}

function tombstoneMergedRow(row: MutableRow, serverId: string): MutableRow {
  const now = nowIso();
  return {
    ...row,
    server_id: serverId,
    merged_into_id: serverId,
    sync_status: "synced",
    isSynced: true,
    is_synced: true,
    deleted_at: now,
    deletedAt: now,
    updated_at: now,
    updatedAt: now,
  };
}

function mergeChildRow(
  localRow: MutableRow | undefined,
  serverRow: MutableRow | undefined,
  fallbackId: string,
  billId: string,
): MutableRow {
  const scope = getOfflineScope();
  const localId = getStringFrom(localRow, ["local_id", "localId", "id"]);
  const serverId = getStringFrom(serverRow, ["id", "server_id", "serverId"]);
  const id = serverId ?? getStringFrom(localRow, ["id"]) ?? fallbackId;
  const now = nowIso();
  return {
    ...(localRow ?? {}),
    ...(serverRow ?? {}),
    id,
    local_id: localId,
    server_id: serverId ?? getStringFrom(localRow, ["server_id", "serverId"]),
    billId,
    bill_id: billId,
    reference_id:
      getStringFrom(localRow, ["reference_id"]) ===
      getStringFrom(localRow, ["billId", "bill_id"])
        ? billId
        : (getStringFrom(localRow, ["reference_id"]) ??
          getStringFrom(serverRow, ["reference_id"])),
    tenant_id:
      getStringFrom(serverRow, ["tenant_id", "tenantId"]) ??
      getStringFrom(localRow, ["tenant_id", "tenantId"]) ??
      scope.tenant_id,
    store_id:
      getStringFrom(serverRow, ["store_id", "storeId"]) ??
      getStringFrom(localRow, ["store_id", "storeId"]) ??
      scope.store_id,
    device_id:
      getStringFrom(localRow, ["device_id", "deviceId"]) ?? scope.device_id,
    sync_status: "synced",
    deleted_at: null,
    deletedAt: null,
    updated_at: getUpdatedAt(serverRow ?? {}, localRow) ?? now,
    updatedAt: getUpdatedAt(serverRow ?? {}, localRow) ?? now,
  };
}

async function reconcileChildRows(
  tableName:
    | "bill_items"
    | "payments"
    | "customer_ledger"
    | "inventory_movements",
  localBillId: string,
  serverBillId: string,
  serverRows: MutableRow[],
  entityType: string,
): Promise<void> {
  const table = dexieDB.table(tableName) as Table<MutableRow, string>;
  const localRows = await getRowsByBillId(tableName, localBillId);
  const usedLocalIds = new Set<string>();

  for (const [index, serverRow] of serverRows.entries()) {
    const localRow = localRows[index];
    if (localRow) {
      const localRowId = getStringFrom(localRow, ["id"]);
      if (localRowId) usedLocalIds.add(localRowId);
    }
    const fallbackId =
      getStringFrom(localRow, ["id"]) ??
      `${entityType}_${serverBillId}_${index}`;
    const merged = mergeChildRow(localRow, serverRow, fallbackId, serverBillId);
    await table.put(merged);
    const localId = getStringFrom(localRow, ["id", "local_id", "localId"]);
    const serverId = getStringFrom(merged, ["server_id", "id"]);
    await putIdMapping(entityType, localId, serverId);
    const localPrimaryId = getStringFrom(localRow, ["id"]);
    const mergedId = getStringFrom(merged, ["id"]);
    if (localRow && localPrimaryId && mergedId && localPrimaryId !== mergedId) {
      await table.put(tombstoneMergedRow(localRow, mergedId));
    }
  }

  for (const localRow of localRows) {
    const localRowId = getStringFrom(localRow, ["id"]);
    if (localRowId && usedLocalIds.has(localRowId)) continue;
    const merged = mergeChildRow(
      localRow,
      undefined,
      localRowId ?? `${entityType}_${serverBillId}_${usedLocalIds.size}`,
      serverBillId,
    );
    await table.put(merged);
  }
}

function collectServerLedgerRows(
  result: SyncPushEventResult,
  serverBill: MutableRow,
): MutableRow[] {
  const rows: MutableRow[] = [];
  const addOne = (value: unknown) => {
    if (isRecord(value)) rows.push(value);
  };
  const addMany = (value: unknown) => {
    if (Array.isArray(value)) rows.push(...value.filter(isRecord));
  };

  addOne(result.udharLedgerEntry);
  addOne(result.udhar_ledger_entry);
  addMany(result.udharLedgerEntries);
  addMany(result.udhar_ledger_entries);
  addMany(result.ledgerEntries);
  addMany(result.ledger_entries);
  addMany(result.customerLedgerEntries);
  addMany(result.customer_ledger_entries);
  addMany(result.customer_ledger);

  if (isRecord(result.result)) {
    addOne(result.result.udharLedgerEntry);
    addOne(result.result.udhar_ledger_entry);
    addMany(result.result.udharLedgerEntries);
    addMany(result.result.udhar_ledger_entries);
    addMany(result.result.ledgerEntries);
    addMany(result.result.ledger_entries);
    addMany(result.result.customerLedgerEntries);
    addMany(result.result.customer_ledger_entries);
    addMany(result.result.customer_ledger);
  }

  addOne(serverBill.udharLedgerEntry);
  addOne(serverBill.udhar_ledger_entry);
  addMany(serverBill.udharLedgerEntries);
  addMany(serverBill.udhar_ledger_entries);
  addMany(serverBill.ledgerEntries);
  addMany(serverBill.ledger_entries);
  addMany(serverBill.customer_ledger);

  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const key = getStringFrom(row, [
      "id",
      "server_id",
      "serverId",
      "localLedgerEntryId",
      "local_ledger_entry_id",
      "localLedgerId",
      "local_ledger_id",
      "clientLedgerId",
      "client_ledger_id",
      "ledgerUniqueId",
      "ledger_unique_id",
    ]) ?? `${getStringFrom(row, ["source_id", "sourceId", "bill_id", "billId"]) ?? "row"}:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function reconcileLedgerRows(
  localBillId: string,
  serverBillId: string,
  serverBill: MutableRow,
  result: SyncPushEventResult,
): Promise<void> {
  const serverRows = collectServerLedgerRows(result, serverBill);
  await reconcileChildRows(
    "customer_ledger",
    localBillId,
    serverBillId,
    serverRows,
    "ledger_entry",
  );
}

async function reconcileSaleMovements(
  localBillId: string,
  serverBillId: string,
): Promise<void> {
  const localRows = await getRowsByBillId("inventory_movements", localBillId);
  const table = dexieDB.inventory_movements as Table<MutableRow, string>;
  for (const row of localRows) {
    const id = getStringFrom(row, ["id"]);
    if (!id) continue;
    await table.put({
      ...row,
      billId: serverBillId,
      bill_id: serverBillId,
      reference_id: serverBillId,
      sync_status: "synced",
      updated_at: nowIso(),
      updatedAt: nowIso(),
    });
  }
}

export async function reconcileSyncedBillFromPush(
  event: PendingSyncEvent,
  result: SyncPushEventResult,
): Promise<boolean> {
  if (event.operation_type !== "CREATE_BILL") return false;
  await dexieDB.open();

  const serverBill = getServerEntityFromPushResult(result);
  const serverBillId = getServerBillId(result, serverBill);
  const localBillId = getLocalBillId(event, result, serverBill);
  if (!serverBillId) return false;

  const serverItems = getArrayFrom(serverBill, [
    "items",
    "billItems",
    "bill_items",
  ]);
  const serverPayments = getArrayFrom(serverBill, [
    "payments",
    "billPayments",
    "bill_payments",
  ]);

  await dexieDB.transaction(
    "rw",
    [
      dexieDB.bills,
      dexieDB.bill_items,
      dexieDB.payments,
      dexieDB.customer_ledger,
      dexieDB.inventory_movements,
      dexieDB.id_mappings,
    ],
    async () => {
      const localBill = await dexieDB.bills.get(localBillId);
      const existingServerBill =
        (await dexieDB.bills.get(serverBillId)) ??
        (await dexieDB.bills
          .where("server_id")
          .equals(serverBillId)
          .first()
          .catch(() => undefined));
      const syncedBill = normalizeSyncedBill(
        localBill,
        existingServerBill,
        serverBill,
        localBillId,
        serverBillId,
      );

      await putIdMapping("bill", localBillId, serverBillId);
      await dexieDB.bills.put(syncedBill as never);
      if (localBill && localBillId !== serverBillId) {
        await dexieDB.bills.put(
          tombstoneMergedRow(localBill, serverBillId) as never,
        );
      }

      await reconcileChildRows(
        "bill_items",
        localBillId,
        serverBillId,
        serverItems,
        "bill_item",
      );
      const protectUdhar = shouldProtectLocalUdhar(localBill, serverBill, serverPayments);
      await reconcileChildRows(
        "payments",
        localBillId,
        serverBillId,
        protectUdhar ? [] : serverPayments,
        "payment",
      );
      await reconcileLedgerRows(localBillId, serverBillId, serverBill, result);
      await reconcileSaleMovements(localBillId, serverBillId);
    },
  );

  await refreshBillAndPaymentCaches();
  return true;
}

export function billIdentityKeys(bill: Record<string, unknown>): string[] {
  return [
    getStringFrom(bill, ["id"]),
    getStringFrom(bill, ["server_id", "serverId"]),
    getStringFrom(bill, ["local_id", "localId"]),
    getStringFrom(bill, ["merged_into_id", "mergedIntoId"]),
    getStringFrom(bill, ["localBillId", "local_bill_id"]),
    getStringFrom(bill, ["clientBillId", "client_bill_id"]),
    getStringFrom(bill, ["idempotency_key", "idempotencyKey"]),
    getStringFrom(bill, ["uniqueBillId", "unique_bill_id"]),
  ].filter((key): key is string => Boolean(key));
}

/**
 * Deterministic same-bill check based only on the client-generated identity
 * (clientBillId / localBillId / idempotencyKey). A pending local bill stores its
 * client id as its own primary id/local_id, so those are matched against the
 * server bill's client identity. Server ids are intentionally excluded — a pending
 * local bill and its synced server echo never share a server id, only the client id.
 *
 * When this returns true the two rows are provably the same bill, so the sync merge
 * path can collapse them without relying on the fuzzy content/time heuristic. This
 * only becomes true once the backend stamps the durable client identity onto the
 * bill, so legacy bills (no client identity) correctly fall through to the heuristic.
 */
/**
 * True when a bill carries a durable, client-generated identity (clientBillId or
 * idempotencyKey). Such a bill is collapsed to its twin SOLELY by that identity;
 * the createdAt/content heuristic must never be applied to it. Only legacy bills
 * (created before the backend stamped a durable identity) fall back to the
 * heuristic — which is why that path is gated on the absence of this.
 */
export function hasDurableClientIdentity(bill: Record<string, unknown>): boolean {
  return Boolean(
    getStringFrom(bill, ["clientBillId", "client_bill_id"]) ||
      getStringFrom(bill, ["idempotencyKey", "idempotency_key"]),
  );
}

export function billsShareClientIdentity(
  localBill: Record<string, unknown>,
  serverBill: Record<string, unknown>,
): boolean {
  const serverClientIdentity = new Set(
    [
      getStringFrom(serverBill, ["clientBillId", "client_bill_id"]),
      getStringFrom(serverBill, ["localBillId", "local_bill_id"]),
      getStringFrom(serverBill, ["idempotency_key", "idempotencyKey"]),
    ].filter((key): key is string => Boolean(key)),
  );
  if (serverClientIdentity.size === 0) return false;
  const localIdentity = [
    getStringFrom(localBill, ["id"]),
    getStringFrom(localBill, ["local_id", "localId"]),
    getStringFrom(localBill, ["localBillId", "local_bill_id"]),
    getStringFrom(localBill, ["clientBillId", "client_bill_id"]),
    getStringFrom(localBill, ["idempotency_key", "idempotencyKey"]),
  ].filter((key): key is string => Boolean(key));
  return localIdentity.some((key) => serverClientIdentity.has(key));
}

function isDeleted(row: Record<string, unknown>): boolean {
  return row.deleted_at != null || row.deletedAt != null;
}

function syncPriority(row: Record<string, unknown>): number {
  const syncStatus = String(row.sync_status ?? "");
  const status = String(row.status ?? "");
  if (isBillSynced(row) || syncStatus === "synced") return 4;
  if (syncStatus === "failed" || syncStatus === "conflict") return 1;
  if (
    status === "pending_sync" ||
    syncStatus === "pending_sync" ||
    syncStatus === "syncing"
  )
    return 2;
  return 3;
}

export function dedupeBillsForDisplay<T extends object>(bills: T[]): T[] {
  const candidates = bills
    .filter((bill) => !isDeleted(bill as Record<string, unknown>))
    .map((bill) => withBillSyncFlag(bill));
  const sorted = [...candidates].sort((a, b) => {
    const priorityDelta =
      syncPriority(b as Record<string, unknown>) -
      syncPriority(a as Record<string, unknown>);
    if (priorityDelta !== 0) return priorityDelta;
    const bRecord = b as Record<string, unknown>;
    const aRecord = a as Record<string, unknown>;
    return String(
      bRecord.updated_at ??
        bRecord.updatedAt ??
        bRecord.created_at ??
        bRecord.createdAt ??
        "",
    ).localeCompare(
      String(
        aRecord.updated_at ??
          aRecord.updatedAt ??
          aRecord.created_at ??
          aRecord.createdAt ??
          "",
      ),
    );
  });
  const seen = new Set<string>();
  const seenSyncedContentSignatures = new Set<string>();
  const picked: Array<T & { isSynced: boolean; is_synced: boolean }> = [];
  for (const bill of sorted) {
    const record = bill as Record<string, unknown>;
    const keys = billIdentityKeys(record);
    if (keys.some((key) => seen.has(key))) continue;

    const contentSignature = billContentSignature(record);
    const synced = isBillSynced(record);
    // The content/time heuristic is a LEGACY-ONLY fallback. A pending bill that
    // carries a durable client identity was already collapsed against its synced
    // twin by the identity `seen` check above; if it survived to here it is a
    // genuinely distinct sale, so it must NOT be folded into an unrelated synced
    // bill that merely shares a total/time bucket (e.g. the same item sold twice
    // in five minutes). Only bills lacking a clientBillId/idempotencyKey fall back.
    const legacyFallback = !hasDurableClientIdentity(record);
    if (!synced && legacyFallback && contentSignature && seenSyncedContentSignatures.has(contentSignature)) {
      continue;
    }
    if (!synced && legacyFallback && picked.some((pickedBill) => isLikelySyncedCopyOfPendingBill(record, pickedBill as Record<string, unknown>))) {
      continue;
    }

    keys.forEach((key) => seen.add(key));
    if (synced && contentSignature) seenSyncedContentSignatures.add(contentSignature);
    picked.push(bill);
  }
  return picked.sort((a, b) => {
    const bRecord = b as Record<string, unknown>;
    const aRecord = a as Record<string, unknown>;
    return String(bRecord.createdAt ?? bRecord.created_at ?? "").localeCompare(
      String(aRecord.createdAt ?? aRecord.created_at ?? ""),
    );
  }) as T[];
}

function paymentIdentityKeys(payment: Record<string, unknown>): string[] {
  return [
    getStringFrom(payment, ["id"]),
    getStringFrom(payment, ["server_id", "serverId"]),
    getStringFrom(payment, ["local_id", "localId"]),
    getStringFrom(payment, [
      "clientPaymentId",
      "client_payment_id",
      "localPaymentId",
      "local_payment_id",
    ]),
    getStringFrom(payment, ["idempotencyKey", "idempotency_key"]),
  ].filter((key): key is string => Boolean(key));
}

function isLocalLikePaymentId(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const normalized = value.toLowerCase();
  return (
    normalized.startsWith("payment_") ||
    normalized.startsWith("local_") ||
    normalized.startsWith("tmp_") ||
    normalized.startsWith("temp_") ||
    normalized.includes("pending")
  );
}

function isLocalPaymentEcho(payment: Record<string, unknown>): boolean {
  const status = String(payment.sync_status ?? payment.status ?? "").toLowerCase();
  if (["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(status)) return true;
  return (
    isLocalLikePaymentId(payment.id) ||
    isLocalLikePaymentId(payment.local_id) ||
    isLocalLikePaymentId(payment.localId) ||
    isLocalLikePaymentId(payment.bill_id) ||
    isLocalLikePaymentId(payment.billId)
  );
}

function isServerPaymentEcho(payment: Record<string, unknown>): boolean {
  const status = String(payment.sync_status ?? payment.status ?? "").toLowerCase();
  if (status === "synced") return true;
  if (typeof payment.server_id === "string" || typeof payment.serverId === "string") return true;
  const id = String(payment.id ?? "");
  return id.length > 0 && !isLocalLikePaymentId(id);
}

function paymentEchoSignature(payment: Record<string, unknown>): string | null {
  const customerId = getStringFrom(payment, ["customer_id", "customerId"]);
  const mode = getStringFrom(payment, ["mode"])?.toLowerCase();
  const amount = getNumberFrom(payment, ["amount"]);
  if (!mode || amount === undefined || amount <= 0) return null;

  const paidAt = getStringFrom(payment, [
    "paid_at",
    "paidAt",
    "created_at",
    "createdAt",
  ]);
  const time = paidAt ? new Date(paidAt).getTime() : NaN;
  if (!Number.isFinite(time)) return null;
  const fifteenMinuteBucket = Math.floor(time / (15 * 60 * 1000));
  const customerKey = customerId ?? "walk-in";

  return `payment-echo:${customerKey}|${mode}|${amount.toFixed(2)}|${fifteenMinuteBucket}`;
}

function paymentBillDisplaySignature(payment: Record<string, unknown>): string | null {
  const billId = getStringFrom(payment, [
    "bill_id",
    "billId",
    "localBillId",
    "local_bill_id",
    "serverBillId",
    "server_bill_id",
  ]);
  const customerId = getStringFrom(payment, ["customer_id", "customerId"]);
  const mode = getStringFrom(payment, ["mode"])?.toLowerCase();
  const amount = getNumberFrom(payment, ["amount"]);
  if (!mode || amount === undefined || amount <= 0) return null;

  const paidAt = getStringFrom(payment, [
    "paid_at",
    "paidAt",
    "created_at",
    "createdAt",
  ]);
  const time = paidAt ? new Date(paidAt).getTime() : NaN;
  if (!Number.isFinite(time)) return null;

  const billKey = billId ?? `customer:${customerId ?? "walk-in"}`;
  const fiveMinuteBucket = Math.floor(time / (5 * 60 * 1000));
  return `payment-display:${billKey}|${mode}|${amount.toFixed(2)}|${fiveMinuteBucket}`;
}

function shouldCollapsePaymentEcho(previous: Record<string, unknown>, current: Record<string, unknown>): boolean {
  const previousMode = getStringFrom(previous, ["mode"])?.toLowerCase();
  const currentMode = getStringFrom(current, ["mode"])?.toLowerCase();
  if (!previousMode || previousMode !== currentMode) return false;
  const oneLocal = isLocalPaymentEcho(previous) || isLocalPaymentEcho(current);
  const oneServer = isServerPaymentEcho(previous) || isServerPaymentEcho(current);
  return oneLocal && oneServer;
}

export function dedupePaymentsForDisplay<T extends object>(payments: T[]): T[] {
  const candidates = payments.filter(
    (payment) => !isDeleted(payment as Record<string, unknown>),
  );
  const seenIdentity = new Set<string>();
  const pickedByEchoSignature = new Map<string, T>();
  const pickedByDisplaySignature = new Map<string, T>();
  const picked: T[] = [];

  for (const payment of candidates.sort((a, b) => {
    const priorityDelta =
      syncPriority(b as Record<string, unknown>) -
      syncPriority(a as Record<string, unknown>);
    if (priorityDelta !== 0) return priorityDelta;
    const bRecord = b as Record<string, unknown>;
    const aRecord = a as Record<string, unknown>;
    return String(bRecord.updated_at ?? bRecord.updatedAt ?? bRecord.created_at ?? bRecord.createdAt ?? "")
      .localeCompare(String(aRecord.updated_at ?? aRecord.updatedAt ?? aRecord.created_at ?? aRecord.createdAt ?? ""));
  })) {
    const record = payment as Record<string, unknown>;
    const identityKeys = paymentIdentityKeys(record);
    if (identityKeys.some((key) => seenIdentity.has(key))) continue;

    const displaySignature = paymentBillDisplaySignature(record);
    if (displaySignature && pickedByDisplaySignature.has(displaySignature)) {
      identityKeys.forEach((key) => seenIdentity.add(key));
      continue;
    }

    const echoSignature = paymentEchoSignature(record);
    const previousEcho = echoSignature ? pickedByEchoSignature.get(echoSignature) : undefined;
    if (previousEcho && shouldCollapsePaymentEcho(previousEcho as Record<string, unknown>, record)) {
      identityKeys.forEach((key) => seenIdentity.add(key));
      continue;
    }

    identityKeys.forEach((key) => seenIdentity.add(key));
    if (echoSignature && !pickedByEchoSignature.has(echoSignature)) {
      pickedByEchoSignature.set(echoSignature, payment);
    }
    if (displaySignature && !pickedByDisplaySignature.has(displaySignature)) {
      pickedByDisplaySignature.set(displaySignature, payment);
    }
    picked.push(payment);
  }
  return picked.sort((a, b) => {
    const bRecord = b as Record<string, unknown>;
    const aRecord = a as Record<string, unknown>;
    return String(
      bRecord.paid_at ??
        bRecord.paidAt ??
        bRecord.created_at ??
        bRecord.createdAt ??
        "",
    ).localeCompare(
      String(
        aRecord.paid_at ??
          aRecord.paidAt ??
          aRecord.created_at ??
          aRecord.createdAt ??
          "",
      ),
    );
  });
}

function billItemIdentityKeys(item: Record<string, unknown>): string[] {
  return [
    getStringFrom(item, ["id"]),
    getStringFrom(item, ["server_id", "serverId"]),
    getStringFrom(item, ["local_id", "localId"]),
    getStringFrom(item, [
      "billItemId",
      "bill_item_id",
      "clientBillItemId",
      "client_bill_item_id",
      "localBillItemId",
      "local_bill_item_id",
      "localItemId",
      "local_item_id",
    ]),
  ].filter((key): key is string => Boolean(key));
}

function itemAmount(item: Record<string, unknown>): number {
  const quantity = getNumberFrom(item, ["quantity", "qty"]) ?? 0;
  const rate = getNumberFrom(item, ["ratePerRateUnit", "rate_per_rate_unit", "rate", "price"]) ?? 0;
  return roundMoney(getNumberFrom(item, ["line_total", "lineTotal", "total"]) ?? quantity * rate);
}

function billItemBusinessSignature(item: Record<string, unknown>): string | null {
  const product = normalizeBillSignatureText(getStringFrom(item, ["productId", "product_id", "product_local_id"]));
  const name = normalizeBillSignatureText(getStringFrom(item, ["name", "productName", "product_name"]));
  const quantity = getNumberFrom(item, ["quantity", "qty"]);
  const rate = getNumberFrom(item, ["ratePerRateUnit", "rate_per_rate_unit", "rate", "price"]);
  const total = itemAmount(item);
  if (!product && !name) return null;
  if (quantity === undefined && rate === undefined && total <= 0) return null;
  return [
    product || name,
    (quantity ?? 0).toFixed(3),
    (rate ?? 0).toFixed(2),
    total.toFixed(2),
  ].join("|");
}

function billItemPriority(item: Record<string, unknown>): number {
  let score = syncPriority(item);
  if (getStringFrom(item, ["server_id", "serverId"])) score += 3;
  if (getStringFrom(item, ["local_id", "localId", "localItemId", "local_item_id"])) score += 1;
  return score;
}

export function dedupeBillItemsForDisplay<T extends object>(items: T[], expectedTotal?: number): T[] {
  const candidates = items
    .filter((item) => !isDeleted(item as Record<string, unknown>))
    .sort((a, b) => billItemPriority(b as Record<string, unknown>) - billItemPriority(a as Record<string, unknown>));
  const seenIdentity = new Set<string>();
  const picked: T[] = [];

  for (const item of candidates) {
    const record = item as Record<string, unknown>;
    const identityKeys = billItemIdentityKeys(record);
    if (identityKeys.length > 0 && identityKeys.some((key) => seenIdentity.has(key))) continue;
    identityKeys.forEach((key) => seenIdentity.add(key));
    picked.push(item);
  }

  const expected = Number(expectedTotal ?? 0);
  const total = picked.reduce((sum, item) => sum + itemAmount(item as Record<string, unknown>), 0);
  if (!Number.isFinite(expected) || expected <= 0 || total <= expected + 0.01) {
    return picked.sort((a, b) => String((a as Record<string, unknown>).createdAt ?? (a as Record<string, unknown>).created_at ?? "").localeCompare(String((b as Record<string, unknown>).createdAt ?? (b as Record<string, unknown>).created_at ?? "")));
  }

  const bySignature = new Map<string, T>();
  for (const item of picked) {
    const signature = billItemBusinessSignature(item as Record<string, unknown>);
    if (!signature) {
      bySignature.set(`id:${picked.indexOf(item)}`, item);
      continue;
    }
    const previous = bySignature.get(signature);
    if (!previous || billItemPriority(item as Record<string, unknown>) > billItemPriority(previous as Record<string, unknown>)) {
      bySignature.set(signature, item);
    }
  }

  return [...bySignature.values()].sort((a, b) => String((a as Record<string, unknown>).createdAt ?? (a as Record<string, unknown>).created_at ?? "").localeCompare(String((b as Record<string, unknown>).createdAt ?? (b as Record<string, unknown>).created_at ?? "")));
}

export async function findDuplicateLocalPaymentForServerPayment(
  serverPayment: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const mode = getStringFrom(serverPayment, ["mode"])?.toLowerCase();
  const amount = getNumberFrom(serverPayment, ["amount"]);
  const serverBillId = getStringFrom(serverPayment, ["bill_id", "billId"]);
  const customerId = getStringFrom(serverPayment, ["customer_id", "customerId"]);
  const serverSignature = paymentEchoSignature(serverPayment);

  const candidates = new Map<string, Record<string, unknown>>();
  if (serverBillId) {
    for (const row of await getRowsByBillId("payments", serverBillId)) {
      const id = getStringFrom(row, ["id"]);
      if (id) candidates.set(id, row);
    }
  }

  if (customerId) {
    const customerRows = await dexieDB.payments
      .where("customer_id")
      .equals(customerId)
      .filter(rowMatchesCurrentScope)
      .toArray()
      .catch(() => []);
    for (const row of customerRows as unknown as Record<string, unknown>[]) {
      const id = getStringFrom(row, ["id"]);
      if (id) candidates.set(id, row);
    }
  }

  if (candidates.size === 0) {
    const fallbackRows = await dexieDB.payments
      .filter(rowMatchesCurrentScope)
      .toArray()
      .catch(() => []);
    for (const row of fallbackRows as unknown as Record<string, unknown>[]) {
      const id = getStringFrom(row, ["id"]);
      if (id) candidates.set(id, row);
    }
  }

  return [...candidates.values()].find((payment) => {
    if (payment.deleted_at != null || payment.deletedAt != null) return false;
    if (getStringFrom(payment, ["server_id", "serverId"])) return false;
    const localMode = getStringFrom(payment, ["mode"])?.toLowerCase();
    const sameMode = !mode || !localMode || localMode === mode;
    const localAmount = getNumberFrom(payment, ["amount"]);
    const sameAmount =
      amount === undefined ||
      localAmount === undefined ||
      Math.abs(localAmount - amount) < 0.005;
    const signatureMatches =
      serverSignature != null && paymentEchoSignature(payment) === serverSignature;
    return sameMode && sameAmount && (signatureMatches || shouldCollapsePaymentEcho(serverPayment, payment));
  });
}

export async function refreshBillAndPaymentCaches(): Promise<void> {
  const bills = await offlineDB.getAll<Record<string, unknown>>("bills");
  const payments = await offlineDB.getAll<Record<string, unknown>>("payments");
  writeInstantCache(
    "bills",
    pruneRecentRows(dedupeBillsForDisplay(bills) as unknown as Bill[], 30),
    30,
  );
  writeInstantCache(
    "payments",
    pruneRecentRows(dedupePaymentsForDisplay(payments), 30),
    30,
  );
}
