import { apiRequest, buildQuery } from "@/lib/api/http";
import {
  dexieDB,
  offlineDB,
  rowMatchesCurrentScope,
  type OfflineRow,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { emitLocalDataChanged, writeInstantCache } from "@/lib/offline/instant-cache";
import { refreshBusinessCaches } from "@/features/sync/sync-reconcile";
import { hydratePurchaseHistoryFromSyncPull } from "@/features/sync/cloud-hydration";
import type { Bill, BillListResult, Customer, InventoryItem, Product } from "@/types/api";

const SERVER_TABLES = [
  "products",
  "customers",
  "bills",
  "bill_items",
  "payments",
  "customer_ledger",
  "inventory_movements",
] as const;

const UNSYNCED_STATUSES = new Set([
  "pending_sync",
  "syncing",
  "failed",
  "conflict",
  "PENDING",
  "SYNCING",
  "FAILED",
  "CONFLICT",
]);

type MutableRow = Record<string, unknown>;

interface CloudSnapshotImportResult {
  products: number;
  customers: number;
  bills: number;
  billItems: number;
  payments: number;
  inventory: number;
  ledger: number;
  purchaseHistory: number;
}

function isRecord(value: unknown): value is MutableRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item;
    if (typeof item === "number" && Number.isFinite(item)) return String(item);
  }
  return undefined;
}

function isUnsyncedLocalRow(row: MutableRow): boolean {
  return UNSYNCED_STATUSES.has(String(row.sync_status ?? row.status ?? ""));
}

function startDate(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addCacheBust(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}_force=${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function getNoStore<T>(path: string): Promise<T> {
  return apiRequest<T>(addCacheBust(path), {
    method: "GET",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

function withServerMeta<T extends MutableRow>(row: T): T {
  const scope = getOfflineScope();
  const id = getString(row, ["id", "server_id", "serverId"]) ?? `snapshot_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const now = nowIso();
  return {
    ...row,
    id,
    server_id: getString(row, ["server_id", "serverId", "id"]) ?? id,
    tenant_id: getString(row, ["tenant_id", "tenantId"]) ?? scope.tenant_id,
    store_id: getString(row, ["store_id", "storeId"]) ?? scope.store_id,
    device_id: getString(row, ["device_id", "deviceId"]) ?? scope.device_id,
    sync_status: "synced",
    deleted_at: row.deleted_at ?? row.deletedAt ?? null,
    created_at: getString(row, ["created_at", "createdAt"]) ?? now,
    updated_at: getString(row, ["updated_at", "updatedAt"]) ?? now,
  } as T;
}

function normalizeBill(bill: Bill): MutableRow {
  const raw = bill as unknown as MutableRow;
  const billNo = getString(raw, ["billNo", "billNumber", "bill_no", "number"]);
  return withServerMeta({
    ...raw,
    billNo,
    billNumber: getString(raw, ["billNumber", "billNo", "bill_no", "number"]) ?? billNo,
    totalAmount: raw.totalAmount ?? raw.grandTotal,
    netAmount: raw.netAmount ?? raw.grandTotal,
  });
}

function normalizeBillItem(item: unknown, bill: Bill, index: number): MutableRow {
  const raw = isRecord(item) ? item : {};
  const billId = bill.id;
  return withServerMeta({
    ...raw,
    id: getString(raw, ["id", "server_id", "serverId"]) ?? `bill_item_${billId}_${index}`,
    billId,
    bill_id: billId,
  });
}

function normalizePayment(payment: unknown, bill: Bill, index: number): MutableRow {
  const raw = isRecord(payment) ? payment : {};
  const billId = bill.id;
  return withServerMeta({
    ...raw,
    id: getString(raw, ["id", "server_id", "serverId"]) ?? `payment_${billId}_${index}`,
    billId,
    bill_id: billId,
    customerId: raw.customerId ?? bill.customerId,
    customer_id: raw.customer_id ?? bill.customerId,
  });
}

function extractBillItems(bills: Bill[]): MutableRow[] {
  return bills.flatMap((bill) => {
    const raw = bill as unknown as MutableRow;
    const items = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.billItems)
        ? raw.billItems
        : Array.isArray(raw.bill_items)
          ? raw.bill_items
          : [];
    return items.map((item, index) => normalizeBillItem(item, bill, index));
  });
}

function extractPayments(bills: Bill[]): MutableRow[] {
  return bills.flatMap((bill) => {
    const raw = bill as unknown as MutableRow;
    const payments = Array.isArray(raw.payments)
      ? raw.payments
      : Array.isArray(raw.billPayments)
        ? raw.billPayments
        : Array.isArray(raw.bill_payments)
          ? raw.bill_payments
          : [];
    return payments.map((payment, index) => normalizePayment(payment, bill, index));
  });
}

async function deleteServerBackedRows(tableName: (typeof SERVER_TABLES)[number]): Promise<void> {
  const table = dexieDB.table(tableName) as import("dexie").Table<MutableRow, string>;
  const keys: string[] = [];
  await table
    .filter((row) => rowMatchesCurrentScope(row) && !isUnsyncedLocalRow(row))
    .each((_row, cursor) => keys.push(String(cursor.primaryKey)));
  if (keys.length > 0) await table.bulkDelete(keys);
}

async function replaceServerBackedSnapshot(rows: Partial<Record<(typeof SERVER_TABLES)[number], MutableRow[]>>) {
  await offlineDB.init();
  await dexieDB.transaction(
    "rw",
    SERVER_TABLES.map((name) => dexieDB.table(name)),
    async () => {
      for (const table of SERVER_TABLES) await deleteServerBackedRows(table);
      for (const [table, values] of Object.entries(rows) as [(typeof SERVER_TABLES)[number], MutableRow[]][]) {
        if (values.length > 0) await dexieDB.table(table).bulkPut(values as never[]);
      }
    },
  );
}

async function clearSyncCursors(): Promise<void> {
  await offlineDB.init();
  const keys = await dexieDB.sync_cursor
    .filter((row) => rowMatchesCurrentScope(row))
    .primaryKeys();
  if (keys.length > 0) await dexieDB.sync_cursor.bulkDelete(keys as string[]);
}

function normalizeLedgerResult(value: unknown): MutableRow[] {
  if (Array.isArray(value)) return value.filter(isRecord).map(withServerMeta);
  if (!isRecord(value)) return [];
  const rows = Array.isArray(value.entries)
    ? value.entries
    : Array.isArray(value.ledger)
      ? value.ledger
      : Array.isArray(value.data)
        ? value.data
        : [];
  return rows.filter(isRecord).map(withServerMeta);
}

export async function forceCloudSnapshotImport(): Promise<CloudSnapshotImportResult> {
  const [products, customers, billResult] = await Promise.all([
    getNoStore<Product[]>(`/products${buildQuery({ limit: 5000 })}`),
    getNoStore<Customer[]>(`/customers${buildQuery({ limit: 5000 })}`),
    getNoStore<BillListResult>(
      `/bills${buildQuery({ from: startDate(365), to: todayDate(), status: "all", limit: 5000 })}`,
    ),
  ]);
  const [inventory, udharLedger] = await Promise.all([
    getNoStore<InventoryItem[]>("/inventory").catch(() => []),
    getNoStore<unknown>(`/udhar${buildQuery({ limit: 5000 })}`).catch(() => ({ entries: [], total: 0 })),
  ]);

  const bills = (billResult.bills ?? []).map(normalizeBill);
  const billItems = extractBillItems(billResult.bills ?? []);
  const payments = extractPayments(billResult.bills ?? []);
  const customerLedger = normalizeLedgerResult(udharLedger);
  const productRows = products.map((row) => withServerMeta(row as unknown as MutableRow));
  const customerRows = customers.map((row) => withServerMeta(row as unknown as MutableRow));
  const inventoryRows = inventory.map((row) => withServerMeta(row as unknown as MutableRow));

  await replaceServerBackedSnapshot({
    products: productRows,
    customers: customerRows,
    bills,
    bill_items: billItems,
    payments,
    customer_ledger: customerLedger,
  });
  await clearSyncCursors();

  writeInstantCache("products", productRows, 30);
  writeInstantCache("customers", customerRows, 30);
  writeInstantCache("inventory", inventoryRows.length > 0 ? inventoryRows : productRows, 30);
  writeInstantCache("bills", bills, 30);
  writeInstantCache("payments", payments, 30);
  writeInstantCache("customer_ledger", customerLedger, 30);
  const purchaseHistory = await hydratePurchaseHistoryFromSyncPull().catch(() => 0);
  await refreshBusinessCaches();
  emitLocalDataChanged({ type: "sync", action: "cloud_snapshot_import" });

  return {
    products: productRows.length,
    customers: customerRows.length,
    bills: bills.length,
    billItems: billItems.length,
    payments: payments.length,
    inventory: inventoryRows.length,
    ledger: customerLedger.length,
    purchaseHistory,
  };
}
