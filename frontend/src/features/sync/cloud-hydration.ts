import { apiRequest } from "@/lib/api/http";
import { dexieDB, offlineDB, rowMatchesCurrentScope } from "@/lib/offline/db";
import { writeInstantCache, emitLocalDataChanged } from "@/lib/offline/instant-cache";
import { refreshBusinessCaches } from "@/features/sync/sync-reconcile";
import { syncPull } from "@/features/sync/api";
import { loadPurchaseOverrideMatcher, rowMatchesPurchaseOverride } from "@/features/purchases/sync-guards";
import { writeSubscriptionSnapshot } from "@/features/subscription/access";
import type { Bill, BillListResult, Customer, Product } from "@/types/api";

type AnyRecord = Record<string, unknown>;

const DIRECT_IMPORT_LIMIT = 5000;
const PURCHASE_PULL_LIMIT = 1000;
const PURCHASE_PULL_MAX_PAGES = 10;
const SYNC_SKIP_CURSOR = "2099-12-31T23:59:59.999Z|~";

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function uniqueById<T extends AnyRecord>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = row.id ?? row.server_id ?? row.serverId;
    if (typeof id === "string" && id.length > 0) map.set(id, row);
  }
  return [...map.values()];
}

const PRODUCT_ID_KEYS = ["id", "server_id", "serverId", "clientProductId", "client_product_id", "local_id", "localId"];
const CUSTOMER_ID_KEYS = ["id", "server_id", "serverId", "clientCustomerId", "client_customer_id", "local_id", "localId"];

// Bulk hydration overwrites local rows wholesale. Preserve UNSYNCED local edits/creates
// (sync_status === "pending_sync") so a re-import doesn't clobber a change that hasn't pushed
// yet — e.g. a just-edited stock/price/barcode. Pending local rows win until they sync (the
// incremental pull already conflict-protects edits; this guards the bulk path).
async function preserveLocalPending(table: string, serverRows: AnyRecord[], idKeys: string[]): Promise<AnyRecord[]> {
  const local = await offlineDB.getAll<AnyRecord>(table).catch(() => []);
  const pending = local.filter((row) => String(row.sync_status) === "pending_sync");
  if (pending.length === 0) return serverRows;
  const pendingKeys = new Set<string>();
  for (const row of pending) for (const key of idKeys) {
    const value = row[key];
    if (typeof value === "string" && value) pendingKeys.add(value);
  }
  const serverSafe = serverRows.filter((row) => !idKeys.some((key) => {
    const value = row[key];
    return typeof value === "string" && pendingKeys.has(value);
  }));
  return [...serverSafe, ...pending];
}

function normalizeServerRow<T extends AnyRecord>(row: T): T {
  const id = typeof row.id === "string" && row.id.length > 0
    ? row.id
    : `server_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return {
    ...row,
    id,
    server_id: typeof row.server_id === "string" ? row.server_id : id,
    deleted_at: row.deleted_at ?? row.deletedAt ?? null,
    created_at: typeof row.created_at === "string" ? row.created_at : row.createdAt,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : row.updatedAt,
    sync_status: "synced",
  } as T;
}

async function safeFetch<T>(label: string, fn: () => Promise<T>): Promise<{ label: string; data?: T; error?: string }> {
  try {
    return { label, data: await fn() };
  } catch (error) {
    return { label, error: error instanceof Error ? error.message : String(error) };
  }
}

async function importProducts() {
  const rows = await apiRequest<Product[]>(`/products?limit=${DIRECT_IMPORT_LIMIT}`, { method: "GET", cache: "no-store", background: true });
  const products = Array.isArray(rows) ? rows : [];
  if (products.length > 0) {
    const merged = await preserveLocalPending("products", products as unknown as AnyRecord[], PRODUCT_ID_KEYS);
    await offlineDB.putMany("products", merged);
    writeInstantCache("products", merged);
  }
  return products.length;
}

async function importCustomers() {
  const rows = await apiRequest<Customer[]>(`/customers?limit=${DIRECT_IMPORT_LIMIT}`, { method: "GET", cache: "no-store", background: true });
  const customers = Array.isArray(rows) ? rows.map((customer) => {
    const parsed = Number(customer.udharAmount ?? customer.totalUdhar ?? 0);
    const udhar = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    return { ...customer, udharAmount: udhar, totalUdhar: udhar };
  }) : [];
  if (customers.length > 0) {
    const merged = await preserveLocalPending("customers", customers as unknown as AnyRecord[], CUSTOMER_ID_KEYS);
    await offlineDB.putMany("customers", merged);
    writeInstantCache("customers", merged);
  }
  return customers.length;
}

async function importBills() {
  const now = new Date();
  const from = toDateInput(addDays(now, -730));
  const to = toDateInput(addDays(now, 1));
  const result = await apiRequest<BillListResult>(`/bills?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=all&limit=${DIRECT_IMPORT_LIMIT}`, {
    method: "GET",
    cache: "no-store",
    background: true,
  });
  const bills = Array.isArray(result?.bills) ? result.bills : [];
  const billItems: AnyRecord[] = [];
  const payments: AnyRecord[] = [];

  for (const bill of bills as Array<Bill & AnyRecord>) {
    const billId = bill.id;
    const items = Array.isArray(bill.items) ? bill.items : [];
    const billPayments = Array.isArray(bill.payments) ? bill.payments : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      billItems.push({ ...item, billId, bill_id: item.bill_id ?? item.billId ?? billId });
    }
    for (const payment of billPayments) {
      if (!isRecord(payment)) continue;
      payments.push({ ...payment, billId, bill_id: payment.bill_id ?? payment.billId ?? billId });
    }
  }

  if (bills.length > 0) {
    await offlineDB.putMany("bills", bills as unknown as AnyRecord[]);
    writeInstantCache("bills", bills);
  }
  if (billItems.length > 0) await offlineDB.putMany("bill_items", uniqueById(billItems));
  if (payments.length > 0) {
    await offlineDB.putMany("payments", uniqueById(payments));
    writeInstantCache("payments", uniqueById(payments));
  }
  return { bills: bills.length, billItems: billItems.length, payments: payments.length };
}

async function importInventory() {
  const rows = await apiRequest<AnyRecord[]>(`/inventory`, { method: "GET", cache: "no-store", background: true });
  const invRows = Array.isArray(rows)
    ? rows.map((row) => {
        const id = row.id ?? row.productId ?? row.product_id;
        return typeof id === "string" ? { ...row, id } : row;
      }).filter((row): row is AnyRecord => typeof row.id === "string")
    : [];
  if (invRows.length === 0) return 0;
  // The /inventory view is stock-focused and omits product-only fields (barcode, sku, …). Merge its
  // stock data ONTO the existing local product instead of replacing the row — otherwise hydration
  // wipes those fields (a synced product would lose its barcode on the next refresh).
  const existing = await offlineDB.getAll<AnyRecord>("products").catch(() => []);
  const byId = new Map<string, AnyRecord>();
  for (const product of existing) {
    for (const key of PRODUCT_ID_KEYS) {
      const value = product[key];
      if (typeof value === "string" && value) byId.set(value, product);
    }
  }
  const products = invRows.map((row) => ({ ...(byId.get(String(row.id)) ?? {}), ...row }));
  const merged = await preserveLocalPending("products", products, PRODUCT_ID_KEYS);
  await offlineDB.putMany("products", merged);
  return products.length;
}

/**
 * Replace the device's udhar ledger with the server snapshot (pending local work
 * survives). Exported so a detected balance drift can repair the ledger without
 * waiting for a full cloud bootstrap — see `ledger-drift-repair.ts`.
 */
export async function resyncUdharLedgerFromServer(): Promise<number> {
  return importUdharLedger();
}

async function importUdharLedger() {
  const result = await apiRequest<{ entries?: unknown[]; ledger?: unknown[]; total?: number }>(`/udhar?limit=${DIRECT_IMPORT_LIMIT}`, {
    method: "GET",
    cache: "no-store", background: true,
  });
  const rows = Array.isArray(result?.entries) ? result.entries : Array.isArray(result?.ledger) ? result.ledger : [];
  const entries = rows.filter(isRecord);
  // The endpoint is a full server snapshot. Retaining old server rows makes
  // balances device-dependent, but pending local work must survive hydration.
  const staleKeys = await dexieDB.customer_ledger
    .filter((row) => {
      if (!rowMatchesCurrentScope(row)) return false;
      const status = String(row.sync_status ?? "synced").toLowerCase();
      return !["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(status);
    })
    .primaryKeys();
  if (staleKeys.length > 0) await dexieDB.customer_ledger.bulkDelete(staleKeys as string[]);
  if (entries.length > 0) await offlineDB.putMany("customer_ledger", entries);
  return entries.length;
}

export async function hydratePurchaseHistoryFromSyncPull(): Promise<number> {
  await offlineDB.init();
  let purchaseCursor: string | null = null;
  let imported = 0;
  const overrideMatcher = await loadPurchaseOverrideMatcher().catch(() => ({ keys: new Set<string>() }));

  for (let page = 0; page < PURCHASE_PULL_MAX_PAGES; page += 1) {
    const response = await syncPull({
      since: "1970-01-01T00:00:00.000Z",
      cursor: null,
      cursors: {
        products: SYNC_SKIP_CURSOR,
        customers: SYNC_SKIP_CURSOR,
        bills: SYNC_SKIP_CURSOR,
        stockLedger: SYNC_SKIP_CURSOR,
        udharLedger: SYNC_SKIP_CURSOR,
        suppliers: SYNC_SKIP_CURSOR,
        purchaseHistory: purchaseCursor,
      },
      limit: PURCHASE_PULL_LIMIT,
      background: true,
    });
    const rows = Array.isArray(response.purchaseHistory)
      ? response.purchaseHistory.filter(isRecord).map(normalizeServerRow)
      : [];
    const safeRows = rows.filter((row) => !rowMatchesPurchaseOverride(row, overrideMatcher));
    if (safeRows.length > 0) {
      await offlineDB.putMany("purchase_bills", uniqueById(safeRows));
      imported += safeRows.length;
    }

    const sync = isRecord(response.sync) ? response.sync : {};
    const entityCursors = isRecord(sync.entityCursors) ? sync.entityCursors : {};
    const nextPurchaseCursor = typeof entityCursors.purchaseHistory === "string"
      ? entityCursors.purchaseHistory
      : null;
    const hasMoreByEntity = isRecord(sync.hasMoreByEntity) ? sync.hasMoreByEntity : {};
    if (hasMoreByEntity.purchaseHistory !== true || !nextPurchaseCursor || nextPurchaseCursor === purchaseCursor) break;
    purchaseCursor = nextPurchaseCursor;
  }

  if (imported > 0) {
    await refreshBusinessCaches().catch(() => undefined);
    emitLocalDataChanged({ type: "cloud-hydration", action: "purchase-history-import", count: imported });
  }

  return imported;
}

async function importSubscription() {
  const data = await apiRequest<AnyRecord>(`/subscription/current`, { method: "GET", cache: "no-store", background: true });
  if (isRecord(data)) {
    await writeSubscriptionSnapshot(data);
  }
  return isRecord(data) ? 1 : 0;
}

export interface CloudHydrationResult {
  products: number;
  customers: number;
  bills: number;
  billItems: number;
  payments: number;
  inventoryProducts: number;
  udharLedger: number;
  purchaseHistory: number;
  subscription: number;
  errors: Array<{ label: string; error: string }>;
}

export async function hydrateFromBackendSnapshot(): Promise<CloudHydrationResult> {
  await offlineDB.init();

  const [subscription, products, customers, bills, udharLedger, purchaseHistory] = await Promise.all([
    safeFetch("subscription", importSubscription),
    safeFetch("products", importProducts),
    safeFetch("customers", importCustomers),
    safeFetch("bills", importBills),
    safeFetch("udharLedger", importUdharLedger),
    safeFetch("purchaseHistory", hydratePurchaseHistoryFromSyncPull),
  ]);
  // Inventory merges stock onto products, so run it AFTER products to avoid a race where it reads
  // a not-yet-written product and drops product-only fields (barcode/sku).
  const inventory = await safeFetch("inventory", importInventory);

  const billCounts = isRecord(bills.data) ? bills.data as unknown as { bills?: number; billItems?: number; payments?: number } : {};
  const result: CloudHydrationResult = {
    products: typeof products.data === "number" ? products.data : 0,
    customers: typeof customers.data === "number" ? customers.data : 0,
    bills: typeof billCounts.bills === "number" ? billCounts.bills : 0,
    billItems: typeof billCounts.billItems === "number" ? billCounts.billItems : 0,
    payments: typeof billCounts.payments === "number" ? billCounts.payments : 0,
    inventoryProducts: typeof inventory.data === "number" ? inventory.data : 0,
    udharLedger: typeof udharLedger.data === "number" ? udharLedger.data : 0,
    purchaseHistory: typeof purchaseHistory.data === "number" ? purchaseHistory.data : 0,
    subscription: typeof subscription.data === "number" ? subscription.data : 0,
    errors: [subscription, products, customers, bills, inventory, udharLedger, purchaseHistory]
      .filter((item): item is { label: string; error: string } => typeof item.error === "string")
      .map(({ label, error }) => ({ label, error })),
  };

  await refreshBusinessCaches().catch(() => undefined);
  emitLocalDataChanged({ type: "cloud-hydration", action: "direct-import", result });
  return result;
}
