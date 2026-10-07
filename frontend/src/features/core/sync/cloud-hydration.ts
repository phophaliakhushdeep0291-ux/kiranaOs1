import { apiRequest } from "@/lib/api/http";
import { assertCurrentOfflineScope, dexieDB, offlineDB } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import { writeInstantCache, emitLocalDataChanged } from "@/lib/offline/instant-cache";
import { refreshBusinessCaches } from "@/features/core/sync/sync-reconcile";
import { syncPull } from "@/features/core/sync/api";
import { loadIdMap } from "@/features/core/sync/sync-id-mapping";
import { loadPurchaseOverrideMatcher, rowMatchesPurchaseOverride } from "@/features/core/purchases/sync-guards";
import { writeSubscriptionSnapshot } from "@/features/core/subscription/access";
import { loadAuthSession } from "@/lib/storage/auth-storage";
import type { Bill, BillListResult, Customer, Product } from "@/types/api";

type AnyRecord = Record<string, unknown>;

const DIRECT_IMPORT_LIMIT = 5000;
/** The maximum `/bills` accepts; asking for more answers 400. */
const BILL_IMPORT_PAGE_LIMIT = 2000;
const BILL_IMPORT_MAX_PAGES = 10;
/** 100,000 entries; a ledger past that is read partly and left otherwise untouched. */
const UDHAR_IMPORT_MAX_PAGES = 20;
/**
 * Which bills a snapshot reads, and whether it may remove local ones.
 *
 * The full window is the repair: two years, authoritative, so a synced bill the
 * server no longer has is quarantined. Every bill carries its lines and payments,
 * so on a shop with history that is megabytes — a till doing a hundred bills a day
 * reaches the 20,000-bill paging cap — and the routine snapshot read it every ten
 * minutes on every counter, while the incremental pull was already delivering each
 * change. A routine snapshot now re-reads only the last few days and removes
 * nothing, which also keeps the window's moving edge from ever quarantining a bill.
 * The full window still runs once a day on each device, and for every explicit
 * repair: the first cloud bootstrap, Sync now and remote support.
 */
const FULL_BILL_WINDOW = { days: 730, authoritative: true } as const;
const RECENT_BILL_WINDOW = { days: 3, authoritative: false } as const;
type BillWindow = typeof FULL_BILL_WINDOW | typeof RECENT_BILL_WINDOW;
/**
 * The tables a routine snapshot reads in full only once a day per device.
 *
 * The same reasoning as bills, for the rest of the snapshot. Products (with their
 * stock), customers and the udhar ledger are each re-read whole — up to 5,000 rows
 * apiece, about 1.2 KB a product — and purchase history is re-pulled from its very
 * first row, then announced as an import that refreshes every screen. Every ten
 * minutes on every counter, for rows the incremental pull had already delivered.
 * A routine snapshot skips a table whose daily read is not due; an explicit repair
 * reads them all.
 */
type FullReadTable = "bills" | "products" | "customers" | "udharLedger" | "purchaseHistory";
const FULL_READ_EVERY_MS = 24 * 60 * 60_000;
const PURCHASE_PULL_LIMIT = 1000;
const PURCHASE_PULL_MAX_PAGES = 10;
const SYNC_SKIP_CURSOR = "2099-12-31T23:59:59.999Z|~";

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Everything this module writes came from the server, so everything it announces
 * carries the sync engine's own tag — `type: "sync"`, the marker a finished push or
 * pull uses.
 *
 * Pages refresh on the event whatever its detail says; the two schedulers read the
 * tag. Without it they took a hydration for a local edit, so every snapshot was
 * chased by a cycle 450ms later plus a forced queue recovery at 900ms
 * (`useOfflineStatus`) and one 250ms later (`useMultiDeviceSync`) — none of them
 * with anything to send. A hydration enqueues no outbox work at all: the rows it
 * writes are the server's already, so nothing it announces can be work to push.
 */
function snapshotImport(detail: AnyRecord): AnyRecord {
  return { type: "sync", ...detail };
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
const BILL_ID_KEYS = ["id", "server_id", "serverId", "clientBillId", "client_bill_id", "localBillId", "local_bill_id", "local_id", "localId"];

function identityValues(rows: AnyRecord[], keys: string[]): Set<string> {
  return new Set(rows.flatMap((row) => keys
    .map((key) => row[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)));
}

// A row is "unsynced" — carrying local work the server hasn't accepted — in any of these
// states. A push that FAILED (e.g. a soft-delete whose CANCEL_BILL was rejected) lands in
// "failed"/"conflict", not "pending_sync", so preserving only pending_sync would still let
// bulk hydration resurrect it. Matches the udhar-ledger import below.
const UNSYNCED_LOCAL_STATUSES = new Set(["pending_sync", "syncing", "failed", "conflict", "local_only"]);

// Bulk hydration overwrites local rows wholesale. Preserve UNSYNCED local edits/creates/deletes
// so a re-import doesn't clobber a change that hasn't been accepted by the server yet — e.g. a
// just-edited stock/price/barcode, or a bill moved to the recycle bin. Local rows win until they
// sync (the incremental pull already conflict-protects edits; this guards the bulk path).
/**
 * Has the server already taken this row, under an id of its own?
 *
 * A row created on this device is keyed by the id the device minted. When sync
 * accepts it the server answers with its own id, an id_mapping is recorded and the
 * local row is replaced — but a bulk hydration racing that replacement reads the
 * echo as ordinary pending work and preserves it beside the server's row. The shop
 * then has the same customer twice, one copy stuck "pending" forever, and it
 * survives a reload because this path writes it back to IndexedDB.
 *
 * A mapping for the row's own id is the proof it has been accepted. Rows that
 * already carry a server id are left alone: those are pending EDITS to something
 * the server knows about, and they must still win here.
 */
export function isSupersededLocalEcho(row: AnyRecord, idMap: Record<string, string>): boolean {
  // A retired twin can still carry a server id and a stale pending edit from an
  // older build. It must not suppress the surviving row in a recovery snapshot.
  const mergedInto = row.merged_into_id ?? row.mergedIntoId;
  if (typeof mergedInto === "string" && mergedInto.length > 0
    && mergedInto !== row.id && mergedInto !== row.local_id) return true;
  const serverId = row.server_id ?? row.serverId;
  if (typeof serverId === "string" && serverId.length > 0) return false;
  const id = typeof row.id === "string" ? row.id : null;
  const localId = typeof row.local_id === "string" ? row.local_id : null;
  return Boolean((id && idMap[id]) || (localId && idMap[localId]));
}

async function preserveLocalPending(table: string, serverRows: AnyRecord[], idKeys: string[]): Promise<AnyRecord[]> {
  const local = await offlineDB.getAll<AnyRecord>(table).catch(() => []);
  const idMap = await loadIdMap().catch(() => ({}) as Record<string, string>);
  const pending = local
    .filter((row) => UNSYNCED_LOCAL_STATUSES.has(String(row.sync_status ?? "synced").toLowerCase()))
    .filter((row) => !isSupersededLocalEcho(row, idMap));
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
  const scope = getOfflineScope();
  const rows = await apiRequest<Product[]>(`/products?limit=${DIRECT_IMPORT_LIMIT}`, { method: "GET", cache: "no-store", background: true });
  const products = Array.isArray(rows) ? rows : [];
  const merged = await preserveLocalPending("products", products as unknown as AnyRecord[], PRODUCT_ID_KEYS);
  assertCurrentOfflineScope(scope);
  await offlineDB.replaceSyncedSnapshot("products", merged, scope);
  await offlineDB.removeOrphans(
    "inventory_movements",
    identityValues(merged, PRODUCT_ID_KEYS),
    ["product_id", "productId"],
    scope,
  );
  assertCurrentOfflineScope(scope);
  writeInstantCache("products", merged);
  return products.length;
}

async function importCustomers() {
  const scope = getOfflineScope();
  const rows = await apiRequest<Customer[]>(`/customers?limit=${DIRECT_IMPORT_LIMIT}`, { method: "GET", cache: "no-store", background: true });
  const customers = Array.isArray(rows) ? rows.map((customer) => {
    const parsed = Number(customer.udharAmount ?? customer.totalUdhar ?? 0);
    const udhar = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    return { ...customer, udharAmount: udhar, totalUdhar: udhar };
  }) : [];
  const merged = await preserveLocalPending("customers", customers as unknown as AnyRecord[], CUSTOMER_ID_KEYS);
  assertCurrentOfflineScope(scope);
  await offlineDB.replaceSyncedSnapshot("customers", merged, scope);
  assertCurrentOfflineScope(scope);
  writeInstantCache("customers", merged);
  return customers.length;
}

/**
 * Every bill in the window, a page at a time.
 *
 * `/bills` caps `limit` at BILL_IMPORT_PAGE_LIMIT, so the single 5,000-row request
 * this used to make answered 400 on every hydration — and `safeFetch` swallowed it,
 * so bills were the one table cloud hydration silently never filled while products,
 * customers and udhar succeeded around it.
 *
 * `complete` matters as much as the rows: the caller treats this result as
 * AUTHORITATIVE for the window and quarantines any synced bill missing from it, so
 * handing back a truncated page would delete real history from the till. A window
 * too large to page through is reported incomplete instead, and the caller leaves
 * the local copy alone for the incremental pull to reconcile.
 */
async function fetchBillWindow(from: string, to: string): Promise<{ bills: unknown[]; complete: boolean }> {
  const bills: unknown[] = [];
  for (let page = 1; page <= BILL_IMPORT_MAX_PAGES; page++) {
    const result = await apiRequest<BillListResult>(
      `/bills?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=all&limit=${BILL_IMPORT_PAGE_LIMIT}&page=${page}`,
      { method: "GET", cache: "no-store", background: true },
    );
    const batch = Array.isArray(result?.bills) ? result.bills : [];
    bills.push(...batch);
    const total = Number(result?.total);
    const drained = batch.length < BILL_IMPORT_PAGE_LIMIT;
    const counted = Number.isFinite(total) && bills.length >= total;
    if (drained || counted) return { bills, complete: true };
  }
  return { bills, complete: false };
}

/**
 * Per user and role, not only per shop: the pull hides cost and profit fields from
 * a cashier, so the owner signing in on a counter a cashier has been syncing needs
 * a full read of their own before routine reads may stand in for it.
 */
function fullReadKey(scope: { tenant_id: string; store_id: string }, table: FullReadTable) {
  const user = loadAuthSession().user;
  return `kirana.snapshot.fullReadAt::${table}::${scope.tenant_id}::${scope.store_id}::${user?.id ?? "-"}:${user?.role ?? "-"}`;
}

/** Due when this device has no record of a full read of the table for the shop in the last day. */
function fullReadDue(scope: { tenant_id: string; store_id: string }, table: FullReadTable): boolean {
  try {
    const at = Number(localStorage.getItem(fullReadKey(scope, table)));
    const age = Date.now() - at;
    return !Number.isFinite(at) || at <= 0 || age < 0 || age >= FULL_READ_EVERY_MS;
  } catch {
    return true; // Without storage there is no record, and the full read is the safe default.
  }
}

function recordFullRead(scope: { tenant_id: string; store_id: string }, table: FullReadTable) {
  try {
    localStorage.setItem(fullReadKey(scope, table), String(Date.now()));
  } catch {
    // The next routine snapshot reads the table in full again, which is only slower.
  }
}

const LOCAL_TABLE: Record<FullReadTable, string> = {
  bills: "bills",
  products: "products",
  customers: "customers",
  udharLedger: "customer_ledger",
  purchaseHistory: "purchase_bills",
};

/**
 * A table the device holds nothing of is read in full whatever the record says: a
 * fresh browser, or a local reset that cleared IndexedDB and left localStorage.
 * A shop that genuinely has none of something pays one empty read.
 */
async function holdsRows(scope: { tenant_id: string; store_id: string }, table: FullReadTable): Promise<boolean> {
  try {
    const count = await dexieDB.table(LOCAL_TABLE[table])
      .where("[tenant_id+store_id]").equals([scope.tenant_id, scope.store_id]).count();
    return count > 0;
  } catch {
    return false;
  }
}

async function importBills(billWindow: BillWindow) {
  const scope = getOfflineScope();
  const now = new Date();
  const from = toDateInput(addDays(now, -billWindow.days));
  const to = toDateInput(addDays(now, 1));
  const { bills, complete } = await fetchBillWindow(from, to);
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

  // Reconcile the same two-year window requested above. Older local history is retained,
  // but a recent synced bill absent from this shop's authoritative result is quarantined.
  const merged = await preserveLocalPending("bills", bills as unknown as AnyRecord[], BILL_ID_KEYS);
  assertCurrentOfflineScope(scope);
  const fromTime = new Date(`${from}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${to}T23:59:59.999Z`).getTime();
  // Only a COMPLETE window may quarantine: this call removes synced bills the result
  // does not contain, so replacing from a truncated read would erase the shop's older
  // history. An incomplete read still writes what it fetched (below) and leaves the
  // existing rows for the incremental pull to reconcile. A recent window is never
  // authoritative, and writes what it fetched the same way.
  const authoritative = complete && billWindow.authoritative;
  if (authoritative) {
    await offlineDB.replaceSyncedSnapshot("bills", merged, scope, (row) => {
      const raw = row.businessDate ?? row.business_date ?? row.createdAt ?? row.created_at;
      const time = new Date(String(raw ?? "")).getTime();
      return Number.isFinite(time) && time >= fromTime && time <= toTime;
    });
  } else if (merged.length > 0) {
    await offlineDB.putMany("bills", merged);
  }
  assertCurrentOfflineScope(scope);
  // A few days of bills is not the bills cache; refreshBusinessCaches rebuilds it
  // from IndexedDB once the snapshot finishes.
  if (billWindow.authoritative) writeInstantCache("bills", merged);
  if (billItems.length > 0) {
    assertCurrentOfflineScope(scope);
    await offlineDB.putMany("bill_items", uniqueById(billItems));
  }
  if (payments.length > 0) {
    assertCurrentOfflineScope(scope);
    await offlineDB.putMany("payments", uniqueById(payments));
    assertCurrentOfflineScope(scope);
    if (billWindow.authoritative) writeInstantCache("payments", uniqueById(payments));
  }
  const allCurrentBills = await offlineDB.getAll<AnyRecord>("bills");
  assertCurrentOfflineScope(scope);
  const currentBillIds = identityValues(allCurrentBills, BILL_ID_KEYS);
  await offlineDB.removeOrphans("bill_items", currentBillIds, ["bill_id", "billId"], scope);
  await offlineDB.removeOrphans(
    "payments",
    currentBillIds,
    ["bill_id", "billId"],
    scope,
    { removeWhenForeignKeyMissing: false },
  );
  return { bills: bills.length, billItems: billItems.length, payments: payments.length };
}

async function importInventory() {
  const scope = getOfflineScope();
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
  assertCurrentOfflineScope(scope);
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

/**
 * The whole udhar ledger, a page at a time.
 *
 * `/udhar` answers newest first. This used to ask for one page of 5,000 and treat
 * it as the ledger, so a shop past 5,000 entries lost its oldest udhar from every
 * device at each snapshot — the pull never re-sends what is behind its cursor — and
 * local balances, a sum over the device's entries, came out short.
 *
 * `complete` is the count the server reported, reached by distinct entries. Paging
 * by offset can drop a row that moves between pages while they are read; a read
 * one short must not be allowed to delete that row from the device.
 */
async function fetchUdharLedger(): Promise<{ entries: AnyRecord[]; complete: boolean }> {
  const entries: AnyRecord[] = [];
  let total = Number.NaN;
  for (let page = 1; page <= UDHAR_IMPORT_MAX_PAGES; page++) {
    const result = await apiRequest<{ entries?: unknown[]; ledger?: unknown[]; total?: number }>(
      `/udhar?limit=${DIRECT_IMPORT_LIMIT}&page=${page}`,
      { method: "GET", cache: "no-store", background: true },
    );
    const rows = (Array.isArray(result?.entries) ? result.entries : Array.isArray(result?.ledger) ? result.ledger : []).filter(isRecord);
    entries.push(...rows);
    total = Number(result?.total);
    if (rows.length < DIRECT_IMPORT_LIMIT || (Number.isFinite(total) && entries.length >= total)) break;
  }
  const distinct = uniqueById(entries);
  return { entries: distinct, complete: Number.isFinite(total) && distinct.length >= total };
}

async function importUdharLedger() {
  const scope = getOfflineScope();
  const { entries, complete } = await fetchUdharLedger();
  assertCurrentOfflineScope(scope);
  // A complete read stands for the ledger: synced rows it lacks are gone from the
  // server, and keeping them would make balances device-dependent. Pending local
  // work always survives. An incomplete read only adds what it fetched.
  if (complete) {
    const staleKeys = await dexieDB.customer_ledger
      .filter((row) => {
        if (row.tenant_id !== scope.tenant_id || row.store_id !== scope.store_id) return false;
        const status = String(row.sync_status ?? "synced").toLowerCase();
        return !["pending_sync", "syncing", "failed", "conflict", "local_only"].includes(status);
      })
      .primaryKeys();
    assertCurrentOfflineScope(scope);
    if (staleKeys.length > 0) await dexieDB.customer_ledger.bulkDelete(staleKeys as string[]);
  }
  if (entries.length > 0) {
    assertCurrentOfflineScope(scope);
    await offlineDB.putMany("customer_ledger", entries);
  }
  return entries.length;
}

export async function hydratePurchaseHistoryFromSyncPull(): Promise<number> {
  const scope = getOfflineScope();
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
      assertCurrentOfflineScope(scope);
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
    assertCurrentOfflineScope(scope);
    await refreshBusinessCaches().catch(() => undefined);
    emitLocalDataChanged(snapshotImport({ action: "purchase-history-import", count: imported }));
  }

  return imported;
}

async function importSubscription() {
  const scope = getOfflineScope();
  const data = await apiRequest<AnyRecord>(`/subscription/current`, { method: "GET", cache: "no-store", background: true });
  if (isRecord(data)) {
    assertCurrentOfflineScope(scope);
    await writeSubscriptionSnapshot(data, snapshotImport({ action: "subscription-import" }));
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

/**
 * Cursors that claim data this device does not have.
 *
 * A cursor means "I have everything up to here". Two things could leave one
 * ahead of the truth. Until fe1981de the server advanced the suppliers, expenses
 * and purchase-history cursors on a CASHIER pull while sending [] for them, and
 * cursors are keyed per device rather than per user — so an owner signing in on a
 * counter machine a cashier had synced resumed after rows they never received.
 * Nothing re-requested them. The supplier list and the expense history were empty
 * offline, for good, while sync reported it was up to date.
 *
 * The server no longer does that. This is for the devices where it already
 * happened, and for whatever else leaves the same mark, because the mark is what
 * this checks rather than the cause: a cursor is set, and the table it speaks for
 * is empty. Clearing it makes the next pull start from the beginning and fill the
 * table, after which the condition is false and this does nothing again.
 *
 * It cannot misfire on a shop that genuinely has no suppliers: with no rows to
 * return, the server hands back the prior cursor, which is null, so there is
 * nothing set to clear.
 *
 * Only the two entities whose absence is visible are checked. Both are read all
 * over the app offline — the supplier picker, the expense screens — and both have
 * a Dexie table of their own to look at.
 */
const CURSOR_BACKED_TABLES = [
  { entity: "suppliers", table: "suppliers" },
  { entity: "expenses", table: "expenses" },
] as const;

async function repairCursorsAheadOfLocalData(): Promise<string[]> {
  const repaired: string[] = [];
  try {
    await dexieDB.open();
    const scope = getOfflineScope();
    // Reached through table(name) rather than the typed dexieDB.sync_cursor
    // accessor, and deliberately. This is a best-effort repair inside the
    // recovery path: the imports above are what the user asked for, and a
    // hydration that never settles is worse than one that does not repair. The
    // typed accessor on a partially-stubbed database waits on an IndexedDB open
    // that never completes, which no catch can rescue; table(name) raises
    // instead, and raising is something this can handle.
    const cursors = dexieDB.table("sync_cursor") as unknown as {
      get(id: string): Promise<{ cursor?: unknown; tenant_id?: unknown; store_id?: unknown } | undefined>;
      delete(id: string): Promise<void>;
    };
    for (const { entity, table } of CURSOR_BACKED_TABLES) {
      const row = await cursors.get(`entity:${entity}`);
      if (!row || row.tenant_id !== scope.tenant_id || row.store_id !== scope.store_id) continue;
      if (!row.cursor) continue;
      const held = await dexieDB.table(table).count();
      if (held > 0) continue;
      await cursors.delete(`entity:${entity}`);
      repaired.push(entity);
    }
  } catch {
    // A repair that cannot run must not take the recovery sync down with it.
    return repaired;
  }
  return repaired;
}

/**
 * `routine` is the periodic catch-up (useMultiDeviceSync's load, reconnect and
 * ten-minute runs): it reads each table in full only when this device's daily read
 * of it is due — otherwise bills come from the recent window and the other tables
 * are left to the incremental pull. Every other caller is an explicit repair and
 * reads it all.
 */
export async function hydrateFromBackendSnapshot(options: { routine?: boolean } = {}): Promise<CloudHydrationResult> {
  const scope = getOfflineScope();
  await offlineDB.init();
  // Decided once, up front: the record is checked again only after this run writes it.
  const inFull = Object.fromEntries(await Promise.all(
    (["bills", "products", "customers", "udharLedger", "purchaseHistory"] as const).map(async (table) => [
      table,
      !options.routine || fullReadDue(scope, table) || !(await holdsRows(scope, table)),
    ]),
  )) as Record<FullReadTable, boolean>;
  const skipped = (label: string) => Promise.resolve({ label } as { label: string; data?: undefined; error?: string });

  const [subscription, products, customers, bills, udharLedger, purchaseHistory] = await Promise.all([
    safeFetch("subscription", importSubscription),
    inFull.products ? safeFetch("products", importProducts) : skipped("products"),
    inFull.customers ? safeFetch("customers", importCustomers) : skipped("customers"),
    safeFetch("bills", () => importBills(inFull.bills ? FULL_BILL_WINDOW : RECENT_BILL_WINDOW)),
    inFull.udharLedger ? safeFetch("udharLedger", importUdharLedger) : skipped("udharLedger"),
    inFull.purchaseHistory ? safeFetch("purchaseHistory", hydratePurchaseHistoryFromSyncPull) : skipped("purchaseHistory"),
  ]);
  // Inventory merges stock onto products, so run it AFTER products to avoid a race where it reads
  // a not-yet-written product and drops product-only fields (barcode/sku). It is part of the
  // products read, and skipped with it.
  const inventory = inFull.products ? await safeFetch("inventory", importInventory) : await skipped("inventory");

  // Recorded once each full read has landed. Bills count even when the paging cap cut
  // the window short: a shop past the cap never gets a complete one, and must not be
  // sent back to it every time. A read that failed records nothing and runs again.
  const outcomes: Record<FullReadTable, { error?: string }> = { bills, products, customers, udharLedger, purchaseHistory };
  for (const table of Object.keys(outcomes) as FullReadTable[]) {
    if (inFull[table] && outcomes[table].error === undefined) recordFullRead(scope, table);
  }

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

  assertCurrentOfflineScope(scope);
  // The imports above re-fetch products, customers, bills, the udhar ledger and
  // purchase history over REST, so those repair themselves. Suppliers and expenses
  // arrive only through the sync pull, which means a cursor sitting ahead of an
  // empty table is the one thing this recovery could not otherwise fix — and
  // repairing that is exactly what runManualSyncCycle promises in its own words:
  // "incremental sync alone cannot repair a device whose cursor is current but
  // whose local IndexedDB snapshot is incomplete".
  const repairedCursors = await repairCursorsAheadOfLocalData();
  if (repairedCursors.length > 0) {
    console.warn(`[Artha] Reset sync cursors that were ahead of local data: ${repairedCursors.join(", ")}`);
  }
  await refreshBusinessCaches().catch(() => undefined);
  assertCurrentOfflineScope(scope);
  emitLocalDataChanged(snapshotImport({ action: "direct-import", result }));
  return result;
}
