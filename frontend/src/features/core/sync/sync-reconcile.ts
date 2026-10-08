import { customerReadIdentityKeys, customerIdentityGraph } from "@/lib/offline/read-indexes";
import type { Table } from "dexie";
import { BUSINESS_CACHE_LIMITS, cacheTablesForEntity } from "@/features/core/sync/cache-dependencies";
import {
  dexieDB,
  offlineDB,
  assertCurrentOfflineScope,
  rowMatchesCurrentScope,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { writeInstantCache } from "@/lib/offline/instant-cache";
import {
  billsShareClientIdentity,
  dedupeBillsForDisplay,
  dedupePaymentsForDisplay,
  findDuplicateLocalPaymentForServerPayment,
  hasDurableClientIdentity,
  isBillSynced,
  isLikelySyncedCopyOfPendingBill,
} from "@/features/core/sync/bill-reconciliation";
import { storeConflict } from "@/features/core/sync/sync-conflicts";
import {
  putIdMapping,
  replaceLocalEntityId,
} from "@/features/core/sync/sync-id-mapping";
import {
  isLocalPurchaseOverride,
  loadPurchaseOverrideMatcher,
  rowMatchesPurchaseOverride,
} from "@/features/core/purchases/sync-guards";
import {
  entityTypeFromOperation,
  getStringFrom,
  isRecord,
  tableNameForEntity,
  UNSYNCED_STATUSES,
  type MergeServerChangeStatus,
} from "@/features/core/sync/sync-types";
import type { SyncPullChange } from "@/types/api";
import type { SyncStatus } from "@/types/domain";
import { calculateLedgerBalance, dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";

const PRODUCT_PARENT_ID_KEYS = ["id", "server_id", "serverId", "clientProductId", "client_product_id", "local_id", "localId"];
const BILL_PARENT_ID_KEYS = ["id", "server_id", "serverId", "clientBillId", "client_bill_id", "localBillId", "local_bill_id", "local_id", "localId"];

function collectIdentityValues(rows: Array<Record<string, unknown>>, keys: string[]): Set<string> {
  return new Set(rows.flatMap((row) => keys
    .map((key) => row[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)));
}

/**
 * A sync pull can contain old child rows that were wrongly assigned to this
 * shop by a previous cross-session race. Reconcile them after every pull/push,
 * not only during the earlier authoritative snapshot import, otherwise the
 * incremental pull immediately recreates the leaked rows.
 */
type ReadRows = <T>(table: string) => Promise<T[]>;

async function removeOrphanedDependentRows(readRows: ReadRows, tables: Set<string>): Promise<void> {
  // Some recovery/test adapters can expose only the legacy read/write facade.
  // Missing cleanup capability must never turn a successful bill push into a
  // failed sync; the production facade always provides this method.
  if (typeof offlineDB.removeOrphans !== "function") return;
  const scope = getOfflineScope();
  const cleanupProducts = tables.has("products") || tables.has("inventory_movements");
  const cleanupBills = tables.has("bills") || tables.has("payments");
  if (cleanupProducts) {
    const products = await readRows<Record<string, unknown>>("products");
    await offlineDB.removeOrphans("inventory_movements", collectIdentityValues(products, PRODUCT_PARENT_ID_KEYS), ["product_id", "productId"], scope);
  }
  if (cleanupBills) {
    const bills = await readRows<Record<string, unknown>>("bills");
    const ids = collectIdentityValues(bills, BILL_PARENT_ID_KEYS);
    await offlineDB.removeOrphans("bill_items", ids, ["bill_id", "billId"], scope);
    await offlineDB.removeOrphans("payments", ids, ["bill_id", "billId"], scope, { removeWhenForeignKeyMissing: false });
  }
}

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

function ledgerIdentitySet(row: Record<string, unknown>): Set<string> {
  return new Set(
    [
      row.id,
      row.local_id,
      row.localId,
      row.server_id,
      row.serverId,
      row.source_id,
      row.sourceId,
      row.clientLedgerId,
      row.client_ledger_id,
      row.localLedgerEntryId,
      row.local_ledger_entry_id,
      row.ledgerEntryId,
      row.ledger_entry_id,
      row.paymentId,
      row.payment_id,
      row.localPaymentId,
      row.local_payment_id,
      row.clientPaymentId,
      row.client_payment_id,
      row.idempotencyKey,
      row.idempotency_key,
    ].filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

function isPaymentLedgerRow(row: Record<string, unknown>): boolean {
  const sourceType = normalizeLedgerSourceType(row);
  const rawType = String(row.type ?? "").trim().toLowerCase();
  return rawType === "payment" || sourceType === "payment" || sourceType === "udhar_payment";
}

type LedgerRow = Record<string, unknown>;

/**
 * The local ledger rows a pulled ledger entry could be a twin of, read once per
 * pull page instead of once per entry.
 *
 * Every payment and bill entry the pull delivered used to read the device's whole
 * udhar ledger to look for its twin: 5,200 entries made 5,200 full reads, and a
 * counter catching up on that backlog sat at full CPU for minutes. Only three kinds
 * of row can ever match (see the predicate below): the row whose key is the entry's
 * server id, a row whose server_id names it, and a row with no server_id at all —
 * a local entry not yet mapped. The first is read by key every time. The other two
 * are few and are collected in one pass per page; one that matches is read again
 * before it is used, since an earlier change on the page can have replaced it.
 *
 * Candidates are tried in key order, as the full read returned them, so the same
 * row wins when more than one could match.
 */
export interface LedgerTwinIndex {
  /** Candidates in key order; `stale` ones were read at the start of the page. */
  candidates(serverId: string): Promise<Array<{ row: LedgerRow; stale: boolean }>>;
  reread(row: LedgerRow): Promise<LedgerRow | undefined>;
}

async function currentLedgerRow(id: unknown): Promise<LedgerRow | undefined> {
  if (typeof id !== "string" || !id) return undefined;
  const row = await dexieDB.customer_ledger.get(id).catch(() => undefined) as LedgerRow | undefined;
  return row && rowMatchesCurrentScope(row) ? row : undefined;
}

export function createLedgerTwinIndex(): LedgerTwinIndex {
  let loaded: Promise<{ unmapped: LedgerRow[]; byServerId: Map<string, LedgerRow[]> }> | null = null;
  const load = () => {
    loaded ??= dexieDB.customer_ledger
      .filter(rowMatchesCurrentScope)
      .toArray()
      .catch(() => [] as LedgerRow[])
      .then((rows) => {
        const unmapped: LedgerRow[] = [];
        const byServerId = new Map<string, LedgerRow[]>();
        for (const row of rows) {
          const mapped = getStringFrom(row, ["server_id", "serverId"]);
          if (!mapped) unmapped.push(row);
          else if (mapped !== getStringFrom(row, ["id"])) byServerId.set(mapped, [...(byServerId.get(mapped) ?? []), row]);
        }
        return { unmapped, byServerId };
      });
    return loaded;
  };
  return {
    async candidates(serverId) {
      const { unmapped, byServerId } = await load();
      const byId = new Map<string, { row: LedgerRow; stale: boolean }>();
      for (const row of [...(byServerId.get(serverId) ?? []), ...unmapped]) {
        const id = getStringFrom(row, ["id"]);
        if (id) byId.set(id, { row, stale: true });
      }
      const keyed = await currentLedgerRow(serverId);
      if (keyed) byId.set(serverId, { row: keyed, stale: false });
      return [...byId.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, candidate]) => candidate);
    },
    reread: (row) => currentLedgerRow(row.id),
  };
}

async function findDuplicateLocalLedgerForServerLedger(
  serverLedger: Record<string, unknown>,
  serverId: string,
  twins?: LedgerTwinIndex,
): Promise<Record<string, unknown> | undefined> {
  const sourceType = normalizeLedgerSourceType(serverLedger);
  const isServerPayment = isPaymentLedgerRow(serverLedger);
  const isServerBill = sourceType === "bill" || sourceType === "debit" || String(serverLedger.type ?? "").toUpperCase() === "BILL";
  if (!isServerPayment && !isServerBill) return undefined;

  const serverBillId = ledgerSourceId(serverLedger);
  const mappedLocalBillId = serverBillId ? await findLocalIdForServerId(serverBillId) : undefined;
  const billIds = new Set([serverBillId, mappedLocalBillId].filter((value): value is string => Boolean(value)));
  const serverIdentities = ledgerIdentitySet(serverLedger);
  const amount = Math.abs(readNumberField(serverLedger, ["amount"], 0));
  const customerId = getStringFrom(serverLedger, ["customerId", "customer_id"]);
  const mappedLocalCustomerId = customerId
    ? await findLocalIdForServerId(customerId)
    : undefined;
  const equivalentCustomerIds = new Set(
    [customerId, mappedLocalCustomerId].filter(
      (value): value is string => Boolean(value),
    ),
  );

  const isTwin = (row: Record<string, unknown>) => {
    if (row.deleted_at != null || row.deletedAt != null) return false;
    if (getStringFrom(row, ["id"]) === serverId || getStringFrom(row, ["server_id", "serverId"]) === serverId) return true;
    if (getStringFrom(row, ["server_id", "serverId"])) return false;
    const rowSourceType = normalizeLedgerSourceType(row);
    const rowIsBill = rowSourceType === "bill" || rowSourceType === "debit" || String(row.type ?? "").toUpperCase() === "BILL";
    const rowIsPayment = isPaymentLedgerRow(row);
    if (isServerBill && !rowIsBill) return false;
    if (isServerPayment && !rowIsPayment) return false;
    const rowSourceId = ledgerSourceId(row);
    const rowIdentities = ledgerIdentitySet(row);
    const identityMatch = [...serverIdentities].some((identity) => rowIdentities.has(identity));
    if (isServerBill && (!rowSourceId || !billIds.has(rowSourceId))) return false;
    if (isServerPayment && !identityMatch) return false;
    const rowAmount = Math.abs(readNumberField(row, ["amount"], 0));
    if (Math.abs(rowAmount - amount) > 0.005) return false;
    const rowCustomerId = getStringFrom(row, ["customerId", "customer_id"]);
    return (
      equivalentCustomerIds.size === 0 ||
      !rowCustomerId ||
      equivalentCustomerIds.has(rowCustomerId)
    );
  };

  if (!twins) {
    const rows = await dexieDB.customer_ledger
      .filter(rowMatchesCurrentScope)
      .toArray()
      .catch(() => [] as Record<string, unknown>[]);
    return rows.find(isTwin);
  }
  for (const { row, stale } of await twins.candidates(serverId)) {
    if (!isTwin(row)) continue;
    if (!stale) return row;
    const now = await twins.reread(row);
    if (now && isTwin(now)) return now;
  }
  return undefined;
}

export async function mergeServerChange(
  change: SyncPullChange,
  /**
   * Collects the id pairs this change merged so the caller can re-point every
   * reference in one pass. A pull page carries up to SYNC_PULL_LIMIT changes and
   * the rewrite walks all twelve offline tables, so doing it per change is what
   * made a first hydration of the starter catalog take minutes. The caller must
   * flush the map with `replaceReferencesMany` before the page is acknowledged.
   */
  deferredReferences?: Map<string, string>,
  /** One per pull page, so ledger entries do not each read the whole ledger. */
  ledgerTwins?: LedgerTwinIndex,
): Promise<MergeServerChangeStatus> {
  const entityType = String(change.entity_type ?? change.entityType ?? "");
  const tableName = tableNameForEntity(entityType);
  markDirty(entityType);
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
    getStringFrom(entity, [
      "local_id",
      "localId",
      "localBillId",
      "local_bill_id",
      "clientBillId",
      "client_bill_id",
      "localProductId",
      "local_product_id",
      "clientProductId",
      "client_product_id",
    ]) ?? mappedLocalId;
  const duplicatePayment =
    tableName === "payments"
      ? await findDuplicateLocalPaymentForServerPayment(entity)
      : undefined;
  const duplicateLedger =
    tableName === "customer_ledger"
      ? await findDuplicateLocalLedgerForServerLedger(entity, serverId, ledgerTwins)
      : undefined;
  const duplicateLocalId = getStringFrom(duplicatePayment ?? duplicateLedger ?? {}, ["id", "local_id", "localId"]);
  const effectiveLocalId = localId ?? duplicateLocalId;
  const existing =
    duplicatePayment ??
    duplicateLedger ??
    (await findExistingServerRow(tableName, serverId, effectiveLocalId));

  const isDeletion = String(change.operation_type ?? change.operationType ?? change.type ?? "").toLowerCase() === "delete"
    || change.deleted_at != null;
  if (isDeletion) {
    if (existing && UNSYNCED_STATUSES.has(String(existing.sync_status ?? "synced") as SyncStatus)) {
      await storeConflict({
        entityType: entityTypeFromOperation("", entityType),
        entityId: getStringFrom(existing, ["id"]) ?? serverId,
        sourceId: getStringFrom(change, ["change_id"]) ?? String(change.server_version ?? Date.now()),
        localSnapshot: existing,
        serverSnapshot: null,
        errorMessage: "Server deleted an entity that has unsynced local changes",
      });
      const table = dexieDB.table(tableName) as Table<Record<string, unknown>, string>;
      // Sync metadata is not a business edit. Advancing updated_at here makes
      // the next pulled server sequence look like a fresh local revision and
      // creates duplicate review cards for the same owner decision.
      await table.put({ ...existing, sync_status: "conflict" });
      return "conflict";
    }
    if (existing) {
      const table = dexieDB.table(tableName) as Table<Record<string, unknown>, string>;
      const keys = [getStringFrom(existing, ["id"]), effectiveLocalId, serverId].filter((value): value is string => Boolean(value));
      await table.bulkDelete([...new Set(keys)]);
    }
    return "merged";
  }

  const duplicateBill =
    tableName === "bills" &&
    existing != null &&
    !isBillSynced(existing) &&
    isBillSynced(entity as Record<string, unknown>)
      ? // A pending local bill whose synced server echo shares the client-generated
        // identity (clientBillId/idempotencyKey) is provably the same bill — merge it
        // deterministically and never raise a conflict. The content/time heuristic is
        // ONLY a legacy fallback: it may run when at least one side lacks a durable
        // identity, but two bills that both carry distinct client ids are different
        // sales and must never be collapsed by it.
        billsShareClientIdentity(existing, entity as Record<string, unknown>) ||
        ((!hasDurableClientIdentity(existing) ||
          !hasDurableClientIdentity(entity as Record<string, unknown>)) &&
          isLikelySyncedCopyOfPendingBill(existing, entity as Record<string, unknown>))
        ? existing
        : undefined
      : undefined;
  const effectiveDuplicateLocalId =
    getStringFrom(duplicatePayment ?? duplicateLedger ?? duplicateBill ?? {}, ["id", "local_id", "localId"]);
  const resolvedLocalId = effectiveLocalId ?? effectiveDuplicateLocalId;

  // Create-echo: an unsynced LOCAL create (never synced ⇒ no server_id) whose synced server
  // copy is now arriving via pull, matched back to it by the client-generated id. It's the
  // same record, not a conflict — fall through to the merge below. Offline EDITS of an
  // already-synced row keep a server_id, so they still take the conflict path. This is the
  // entity-agnostic version of the bill create-echo handling (covers products/customers/etc.).
  const isCreateEcho =
    existing != null &&
    UNSYNCED_STATUSES.has(String(existing.sync_status ?? "synced") as SyncStatus) &&
    !getStringFrom(existing, ["server_id", "serverId"]) &&
    Boolean(effectiveLocalId) &&
    getStringFrom(existing, ["id", "local_id", "localId"]) === effectiveLocalId;

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
        resolvedLocalId ?? effectiveLocalId,
        serverId,
      );
      return "ignored";
    }
  }

  if (
    existing &&
    !duplicatePayment &&
    !duplicateLedger &&
    !duplicateBill &&
    !isCreateEcho &&
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
    });
    return "conflict";
  }

  await putIdMapping(
    entityTypeFromOperation("", entityType),
    resolvedLocalId,
    serverId,
  );
  await replaceLocalEntityId(entityType, resolvedLocalId ?? serverId, serverId, entity, deferredReferences);
  return "merged";
}


function rowIdSet(row: Record<string, unknown>): Set<string> {
  return new Set(customerReadIdentityKeys(row));
}

function ledgerCustomerId(row: Partial<CustomerLedgerEntry>): string | null {
  const id = row.customerId ?? row.customer_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function refreshCustomerBalancesFromLocalLedger(readRows: ReadRows, assertScope: () => void): Promise<void> {
  const customers = await readRows<Record<string, unknown>>("customers");
  const ledger = dedupeLedgerEntries(await readRows<CustomerLedgerEntry>("customer_ledger"));
  const mappings = await readRows<Record<string, unknown>>("id_mappings");
  if (customers.length === 0 || ledger.length === 0) return;

  const ledgerByCustomer = new Map<string, CustomerLedgerEntry[]>();
  for (const entry of ledger) {
    const id = ledgerCustomerId(entry);
    if (!id || entry.deleted_at != null || entry.deletedAt != null) continue;
    const rows = ledgerByCustomer.get(id) ?? [];
    rows.push(entry);
    ledgerByCustomer.set(id, rows);
  }
  const expandIds = customerIdentityGraph(mappings, false);
  const table = dexieDB.customers as Table<Record<string, unknown>, string>;
  const now = nowIso();
  for (const customer of customers) {
    const ids = expandIds(rowIdSet(customer));
    const entries = [...ids].flatMap((id) => ledgerByCustomer.get(id) ?? []);
    if (entries.length === 0) continue;
    const balance = Math.max(0, Math.round((calculateLedgerBalance(entries) + Number.EPSILON) * 100) / 100);
    const current = Number(customer.udharAmount ?? customer.totalUdhar ?? 0);
    if (Number.isFinite(current) && Math.abs(current - balance) < 0.005) continue;
    const updated = {
      ...customer,
      type: balance > 0 ? "udhar" : (customer.type ?? "regular"),
      udharAmount: balance,
      totalUdhar: balance,
      udhar_amount: balance,
      total_udhar: balance,
      updatedAt: typeof customer.updatedAt === "string" ? customer.updatedAt : now,
      updated_at: typeof customer.updated_at === "string" ? customer.updated_at : now,
    };
    assertScope();
    await table.put(updated);
    Object.assign(customer, updated);
  }
}

/** Null means a full recovery rebuild. Otherwise only these caches are dirty. */
let dirtyCaches: Set<string> | null = null;
let cacheScope = "";
let refreshTail: Promise<void> = Promise.resolve();

function markDirty(entity?: unknown) {
  if (dirtyCaches === null) return;
  const affected = typeof entity === "string" ? cacheTablesForEntity(entity) : null;
  if (affected === null) dirtyCaches = null;
  else affected.forEach((table) => dirtyCaches!.add(table));
}

if (typeof window !== "undefined") {
  window.addEventListener("kirana:local-data-changed", (event) => {
    const detail = (event as CustomEvent<Record<string, unknown> | undefined>).detail;
    if (detail?.type !== "sync") markDirty(detail?.type ?? detail?.entityType);
  });
}

type RefreshOptions = { onlyIfStale?: boolean; affectedEntities?: Iterable<string | undefined> };

/** Serialize refreshes; changes arriving during a read remain dirty for the next one. */
export function refreshBusinessCaches(options: RefreshOptions = {}): Promise<void> {
  // Materialize iterators now: a caller can mutate its batch after this returns.
  const affectedEntities = options.affectedEntities ? [...options.affectedEntities] : undefined;
  const next = refreshTail.then(() => refreshCachesNow({ ...options, affectedEntities }));
  refreshTail = next.catch(() => undefined);
  return next;
}

async function refreshCachesNow({ onlyIfStale = false, affectedEntities }: RefreshOptions): Promise<void> {
  const scope = getOfflineScope();
  const key = `${scope.tenant_id}::${scope.store_id}`;
  if (cacheScope !== key) { dirtyCaches = null; cacheScope = key; }
  if (affectedEntities) for (const entity of affectedEntities) markDirty(entity);
  else if (!onlyIfStale) dirtyCaches = null;
  if (dirtyCaches !== null && dirtyCaches.size === 0) return;
  const tables = dirtyCaches ?? new Set(Object.keys(BUSINESS_CACHE_LIMITS));
  dirtyCaches = new Set();
  const assertScope = () => assertCurrentOfflineScope(scope);
  try {
    await rebuildBusinessCaches(tables, assertScope);
  } catch (error) {
    // Restore exactly the failed work without discarding changes that arrived meanwhile.
    if (dirtyCaches !== null) for (const table of tables) dirtyCaches.add(table);
    throw error;
  }
}

async function rebuildBusinessCaches(tables: Set<string>, assertScope: () => void): Promise<void> {
  const reads = new Map<string, Promise<unknown[]>>();
  const readRows: ReadRows = <T>(table: string) => {
    if (!reads.has(table)) reads.set(table, offlineDB.getAll(table).then((rows) => { assertScope(); return rows; }));
    return reads.get(table)! as Promise<T[]>;
  };
  await removeOrphanedDependentRows(readRows, tables);
  if (tables.has("customers") || tables.has("customer_ledger")) {
    // Keep the ledger snapshot and derived balance writes in one transaction:
    // a payment made during refresh must not be overwritten by an older sum.
    if (typeof dexieDB.transaction === "function") {
      const scope = getOfflineScope();
      await dexieDB.transaction("rw", [dexieDB.customers, dexieDB.customer_ledger, dexieDB.id_mappings], () => {
        const readFinancialRows: ReadRows = <T>(table: string) => {
          // Issue the Dexie request directly inside this transaction. Awaiting
          // facade initialization here can release the transaction's zone.
          const pending = dexieDB.table(table).where("[tenant_id+store_id]")
            .equals([scope.tenant_id, scope.store_id]).toArray().then((rows) => { assertScope(); return rows; });
          reads.set(table, pending);
          return pending as Promise<T[]>;
        };
        return refreshCustomerBalancesFromLocalLedger(readFinancialRows, assertScope);
      });
    } else {
      await refreshCustomerBalancesFromLocalLedger(readRows, assertScope);
    }
  }
  assertScope();
  await Promise.all([...tables].map(async (table) => {
    const all = await readRows<Record<string, unknown>>(table);
    let rows = all.filter((row) => row.deleted_at == null && row.deletedAt == null)
      .sort((a, b) => String(b.updated_at ?? b.updatedAt ?? b.created_at ?? b.createdAt ?? "")
        .localeCompare(String(a.updated_at ?? a.updatedAt ?? a.created_at ?? a.createdAt ?? "")))
      .slice(0, BUSINESS_CACHE_LIMITS[table]);
    if (table === "bills") rows = dedupeBillsForDisplay(rows);
    if (table === "payments") rows = dedupePaymentsForDisplay(rows);
    if (table === "customer_ledger") rows = dedupeLedgerEntries(rows as CustomerLedgerEntry[]);
    assertScope();
    writeInstantCache(table, rows, 30);
  }));
}
