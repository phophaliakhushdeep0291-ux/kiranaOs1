import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row extends Record<string, unknown> {
  id?: string;
  key?: string;
  clientEventId?: string;
  op_id?: string;
  entity_id?: string;
  tenant_id?: string;
  store_id?: string;
  status?: string;
  sync_status?: string;
}

type Predicate = (row: Row) => boolean;

const dbState = vi.hoisted(() => {
  const scope = {
    tenant_id: "tenant_sync_failure",
    store_id: "store_sync_failure",
    device_id: "device_sync_failure",
  };
  const tableNames = [
    "products",
    "customers",
    "bills",
    "bill_items",
    "payments",
    "customer_ledger",
    "inventory_movements",
    "suppliers",
    "settings",
    "sync_outbox",
    "sync_cursor",
    "sync_conflicts",
    "id_mappings",
    "local_audit_logs",
    "subscription_cache",
    "device_license_cache",
    "staff_users",
  ];
  let tables: Record<string, Row[]> = {};
  const primaryKey = (table: string) => {
    if (table === "settings") return "key";
    if (table === "sync_outbox") return "clientEventId";
    if (table === "id_mappings") return "local_id";
    if (table === "sync_cursor") return "id";
    return "id";
  };
  const reset = () => {
    tables = {};
    for (const table of tableNames) tables[table] = [];
  };
  const rows = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };
  const clone = <T,>(value: T): T =>
    value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
  const matchesScope = (row: Row) =>
    row.tenant_id === scope.tenant_id && row.store_id === scope.store_id;
  const putInto = (table: string, value: Row) => {
    const row = clone(value);
    const pk = primaryKey(table);
    const key = row[pk];
    if (typeof key !== "string" || key.length === 0) {
      throw new Error(`Missing primary key ${pk} for ${table}`);
    }
    const list = rows(table);
    const index = list.findIndex((existing) => existing[pk] === key);
    if (index >= 0) list[index] = row;
    else list.push(row);
  };
  const setTables = (next: Record<string, Row[]>) => {
    tables = next;
  };

  class FakeQuery {
    private readonly tableName: string;
    private readonly predicates: Predicate[];

    constructor(tableName: string, predicates: Predicate[]) {
      this.tableName = tableName;
      this.predicates = predicates;
    }

    filter(predicate: Predicate) {
      return new FakeQuery(this.tableName, [...this.predicates, predicate]);
    }

    private resultRows() {
      return clone(
        rows(this.tableName).filter((row) =>
          this.predicates.every((predicate) => predicate(row)),
        ),
      );
    }

    async toArray() {
      return this.resultRows();
    }

    async first() {
      return this.resultRows()[0];
    }

    async count() {
      return this.resultRows().length;
    }
  }

  class FakeWhereClause {
    private readonly tableName: string;
    private readonly indexName: string;

    constructor(tableName: string, indexName: string) {
      this.tableName = tableName;
      this.indexName = indexName;
    }

    equals(value: unknown) {
      return new FakeQuery(this.tableName, [
        (row: Row) => {
          if (this.indexName === "[tenant_id+store_id]") {
            return (
              Array.isArray(value) &&
              row.tenant_id === value[0] &&
              row.store_id === value[1]
            );
          }
          return row[this.indexName] === value;
        },
      ]);
    }
  }

  class FakeTable {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
    }

    async get(id: string) {
      const pk = primaryKey(this.name);
      return clone(rows(this.name).find((row) => row[pk] === id));
    }

    async put(value: Row) {
      putInto(this.name, value);
    }

    async delete(id: string) {
      const pk = primaryKey(this.name);
      tables[this.name] = rows(this.name).filter((row) => row[pk] !== id);
    }

    async bulkDelete(ids: string[]) {
      const pk = primaryKey(this.name);
      const idSet = new Set(ids);
      tables[this.name] = rows(this.name).filter(
        (row) => !idSet.has(String(row[pk])),
      );
    }

    where(indexName: string) {
      return new FakeWhereClause(this.name, indexName);
    }

    filter(predicate: Predicate) {
      return new FakeQuery(this.name, [predicate]);
    }

    async toArray() {
      return clone(rows(this.name));
    }

    async sortBy(key: string) {
      return clone(rows(this.name)).sort((a, b) =>
        String(a[key] ?? "").localeCompare(String(b[key] ?? "")),
      );
    }
  }

  const tableInstances = Object.fromEntries(
    tableNames.map((name) => [name, new FakeTable(name)]),
  ) as Record<string, FakeTable>;

  reset();
  return {
    scope,
    get tables() {
      return tables;
    },
    rows,
    reset,
    clone,
    matchesScope,
    putInto,
    setTables,
    tableInstances,
  };
});

const syncPushMock = vi.hoisted(() => vi.fn());
const syncPullMock = vi.hoisted(() => vi.fn());
const requestSyncRetryMock = vi.hoisted(() => vi.fn());
const emitLocalDataChangedMock = vi.hoisted(() => vi.fn());
const listSyncConflictsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => dbState.scope,
  nowIso: () => "2026-06-06T13:00:00.000Z",
}));

vi.mock("@/lib/offline/db", () => {
  const scopedRows = (table: string) =>
    dbState.rows(table).filter(dbState.matchesScope);
  const isRetryable = (event: Row) =>
    ["PENDING", "FAILED", "CONFLICT", "SYNCING"].includes(
      String(event.status ?? ""),
    ) ||
    ["pending_sync", "failed", "conflict", "syncing"].includes(
      String(event.sync_status ?? ""),
    );
  const isPendingNow = (event: Row) => {
    const status = String(event.status ?? "");
    const syncStatus = String(event.sync_status ?? "");
    const pending = status === "PENDING" || syncStatus === "pending_sync";
    const failed = status === "FAILED" || syncStatus === "failed";
    if (pending) return true;
    if (!failed) return false;
    if (!event.next_retry_at) return true;
    return new Date(String(event.next_retry_at)).getTime() <= Date.now();
  };

  const dexieDB = {
    open: vi.fn(async () => undefined),
    table: vi.fn((name: string) => dbState.tableInstances[name]),
    transaction: vi.fn(
      async (_mode: string, _tables: unknown, callback: () => Promise<void>) => {
        const snapshot = dbState.clone(dbState.tables);
        try {
          await callback();
        } catch (error) {
          dbState.setTables(snapshot);
          throw error;
        }
      },
    ),
    ...dbState.tableInstances,
  };

  const offlineDB = {
    init: vi.fn(async () => undefined),
    getAll: vi.fn(async (table: string) => dbState.clone(scopedRows(table))),
    getPendingEvents: vi.fn(async () =>
      dbState.clone(
        scopedRows("sync_outbox")
          .filter(isPendingNow)
          .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)),
      ),
    ),
    getPendingCount: vi.fn(async () =>
      scopedRows("sync_outbox").filter(isRetryable).length,
    ),
    updatePendingEventStatus: vi.fn(
      async (clientEventIds: string[], status: string, errorMessage?: string, options?: { deferMs?: number }) => {
        const idSet = new Set(clientEventIds);
        for (const event of dbState.rows("sync_outbox")) {
          if (!idSet.has(String(event.clientEventId)) || !dbState.matchesScope(event)) {
            continue;
          }
          const retryCount =
            status === "FAILED"
              ? Number(event.retry_count ?? 0) + 1
              : Number(event.retry_count ?? 0);
          event.status = status;
          event.sync_status =
            status === "SYNCING"
              ? "syncing"
              : status === "SYNCED"
                ? "synced"
                : status === "FAILED"
                  ? "failed"
                  : status === "CONFLICT"
                    ? "conflict"
                    : status === "PENDING"
                      ? "pending_sync"
                      : event.sync_status;
          event.retry_count = retryCount;
          event.attempts = retryCount;
          event.error_message = status === "SYNCED" ? null : (errorMessage ?? null);
          event.last_error = status === "SYNCED" ? null : (errorMessage ?? null);
          event.last_attempt_at = "2026-06-06T13:00:00.000Z";
          event.next_retry_at = status === "FAILED" ? null : null;
        }
      },
    ),
  };

  return {
    dexieDB,
    offlineDB,
    rowMatchesCurrentScope: (row: Row) => dbState.matchesScope(row),
    filterRowsForCurrentScope: <T extends Row>(rows: T[]) =>
      rows.filter((row) => dbState.matchesScope(row)),
  };
});

vi.mock("@/features/core/sync/api", () => ({
  syncPush: syncPushMock,
  syncPull: syncPullMock,
  acknowledgeSyncSequence: vi.fn(async () => ({ acknowledgement: { accepted: true } })),
  getSyncStatus: vi.fn(async () => ({ allowed: true })),
  requestSyncRetry: requestSyncRetryMock,
  listSyncConflicts: listSyncConflictsMock,
}));

vi.mock("@/features/core/subscription/access", () => ({
  getCurrentSubscriptionSnapshot: vi.fn(async () => ({ cloudSyncAllowed: true })),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  emitLocalDataChanged: emitLocalDataChangedMock,
  writeInstantCache: vi.fn(),
  pruneRecentRows: vi.fn((rows: unknown[]) => rows),
}));

import { syncPush } from "@/features/core/sync/api";
import {
  pushPendingOutboxOperations,
  retryFailedSyncOperations,
} from "@/features/core/sync/engine";
import { readSyncSnapshot } from "@/features/core/sync/pages/SyncStatusPage";

const mockedSyncPush = vi.mocked(syncPushMock);

function scopedRows(table: string) {
  return dbState.rows(table).filter(dbState.matchesScope);
}

function seedEntity(table: string, id: string, extra: Row = {}) {
  dbState.putInto(table, {
    id,
    local_id: id,
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    sync_status: "pending_sync",
    ...extra,
  });
}

function seedOutbox(operationType: string, entityType: string, entityId: string, extra: Row = {}) {
  const event: Row = {
    op_id: `op_${operationType.toLowerCase()}_${entityId}`,
    clientEventId: `op_${operationType.toLowerCase()}_${entityId}`,
    idempotency_key: `idem_${operationType.toLowerCase()}_${entityId}`,
    type: operationType,
    operation_type: operationType,
    entity_type: entityType,
    entity_id: entityId,
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    payload: { id: entityId, local_id: entityId },
    client_created_at: "2026-06-06T12:55:00.000Z",
    status: "PENDING",
    sync_status: "pending_sync",
    retry_count: 0,
    attempts: 0,
    createdAt: Date.now(),
    next_retry_at: null,
    ...extra,
  };
  dbState.putInto("sync_outbox", event);
  return event;
}

describe("sync failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    dbState.reset();
    syncPullMock.mockResolvedValue({ changes: [], cursor: "cursor-empty" });
    requestSyncRetryMock.mockResolvedValue({ queued: true });
    listSyncConflictsMock.mockResolvedValue({ conflicts: [], summary: { open: 0, resolved: 0, dismissed: 0 }, pagination: { hasMore: false, nextCursor: null, limit: 100 } });
  });

  it("keeps the bill and leaves the operation queued when the backend is unreachable", async () => {
    seedEntity("bills", "bill_local_fail", { total: 320, billNo: "B-FAIL" });
    const event = seedOutbox("CREATE_BILL", "bill", "bill_local_fail");
    mockedSyncPush.mockRejectedValueOnce(new Error("backend down"));

    const result = await pushPendingOutboxOperations();

    // The bill was never judged — the backend simply was not there. Marking it
    // FAILED would spend one of the twelve attempts that retire an operation
    // from automatic sync, so an unreachable backend could permanently strand a
    // day of takings. It stays queued, with the error recorded for diagnosis.
    expect(result).toEqual(expect.objectContaining({ pushed: 0, failed: 0, skipped: 1 }));
    expect(scopedRows("bills")).toEqual([
      expect.objectContaining({ id: "bill_local_fail", total: 320 }),
    ]);
    expect(scopedRows("sync_outbox")).toEqual([
      expect.objectContaining({
        clientEventId: event.clientEventId,
        status: "PENDING",
        sync_status: "pending_sync",
        retry_count: 0,
        error_message: "backend down",
      }),
    ]);
    expect(scopedRows("bills")[0].server_id).toBeUndefined();
  });

  it("failed payment sync keeps payment and does not mark backend success", async () => {
    seedEntity("payments", "payment_local_fail", { amount: 500, mode: "cash" });
    const event = seedOutbox("RECORD_PAYMENT", "payment", "payment_local_fail");
    mockedSyncPush.mockResolvedValueOnce({
      results: [
        {
          op_id: event.op_id,
          status: "FAILED",
          entity_type: "payment",
          local_id: "payment_local_fail",
          error_message: "payment rejected",
        },
      ],
    });

    await pushPendingOutboxOperations();

    expect(scopedRows("payments")).toEqual([
      expect.objectContaining({ id: "payment_local_fail", amount: 500 }),
    ]);
    expect(scopedRows("payments")[0].server_id).toBeUndefined();
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({
        status: "FAILED",
        sync_status: "failed",
        error_message: "payment rejected",
      }),
    );
  });

  it("failed customer sync keeps customer", async () => {
    seedEntity("customers", "customer_local_fail", {
      name: "Ramesh",
      mobile: "9876543210",
    });
    const event = seedOutbox("CREATE_CUSTOMER", "customer", "customer_local_fail");
    mockedSyncPush.mockResolvedValueOnce({
      results: [
        {
          op_id: event.op_id,
          status: "FAILED",
          entity_type: "customer",
          local_id: "customer_local_fail",
          error_message: "duplicate mobile on server",
        },
      ],
    });

    await pushPendingOutboxOperations();

    expect(scopedRows("customers")).toEqual([
      expect.objectContaining({ id: "customer_local_fail", name: "Ramesh" }),
    ]);
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "FAILED", sync_status: "failed" }),
    );
  });

  it("removes an optimistic adjustment rejected for a negative udhar balance", async () => {
    seedEntity("customer_ledger", "ledger_adjustment_rejected", {
      customerId: "cmq000000000000000000000",
      type: "ADJUSTMENT",
      amount: -500,
    });
    const event = seedOutbox(
      "CREATE_LEDGER_ADJUSTMENT",
      "ledger_entry",
      "ledger_adjustment_rejected",
      {
        payload: {
          ledgerEntryId: "ledger_adjustment_rejected",
          customerId: "cmq000000000000000000000",
          amount: -500,
        },
      },
    );
    mockedSyncPush.mockResolvedValueOnce({
      results: [
        {
          op_id: event.op_id,
          status: "CONFLICT",
          entity_type: "ledger_entry",
          local_id: "ledger_adjustment_rejected",
          error_code: "UDHAR_ADJUSTMENT_NEGATIVE_BALANCE",
          error_message: "Adjustment would make udhar negative",
        },
      ],
    });

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ conflicts: 1 }));
    expect(scopedRows("customer_ledger")).toHaveLength(0);
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({
        status: "CONFLICT",
        sync_status: "conflict",
        error_message: "Adjustment would make udhar negative",
      }),
    );
  });

  it("retry uses the same idempotency_key", async () => {
    seedEntity("customers", "customer_retry", { name: "Sita" });
    const failedEvent = seedOutbox("CREATE_CUSTOMER", "customer", "customer_retry", {
      status: "FAILED",
      sync_status: "failed",
      retry_count: 1,
      attempts: 1,
      idempotency_key: "idem-original-customer-retry",
      last_error: "temporary failure",
    });
    mockedSyncPush.mockResolvedValueOnce({
      results: [
        {
          op_id: failedEvent.op_id,
          status: "FAILED",
          entity_type: "customer",
          local_id: "customer_retry",
          error_message: "still failing",
        },
      ],
    });

    const result = await retryFailedSyncOperations([String(failedEvent.clientEventId)]);

    expect(result).toEqual(expect.objectContaining({ failed: 1 }));
    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        clientEventId: failedEvent.clientEventId,
        idempotency_key: "idem-original-customer-retry",
      }),
    );
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ idempotency_key: "idem-original-customer-retry" }),
    );
  });

  it("failed operation is visible in sync status page snapshot", async () => {
    seedEntity("products", "product_failed_visible", { name: "Chini" });
    seedOutbox("UPDATE_PRODUCT", "product", "product_failed_visible", {
      status: "FAILED",
      sync_status: "failed",
      retry_count: 2,
      attempts: 2,
      error_message: "backend validation failed",
    });

    const snapshot = await readSyncSnapshot();

    expect(snapshot.failedOperations).toEqual([
      expect.objectContaining({
        entity_id: "product_failed_visible",
        status: "FAILED",
        error_message: "backend validation failed",
      }),
    ]);
    expect(snapshot.pendingOperations).toHaveLength(0);
    expect(snapshot.localBusinessRowsCount).toBeGreaterThan(0);
  });
  it("collapses legacy client-reported and push-created rows into one authoritative review item", async () => {
    const sourceEventId = "op_customer_device_b";
    const localConflictId = `conflict_customer_customer_shared_${sourceEventId}`;
    dbState.putInto("sync_conflicts", {
      id: localConflictId,
      entity_type: "customer",
      entity_id: "customer_shared",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "conflict",
      resolution: "unresolved",
      server_conflict_id: "server_client_reported",
      server_version: sourceEventId,
      local_snapshot: { customer: { name: "Device B name" } },
      server_snapshot: { conflict: { id: "server_push_conflict" } },
      created_at: "2026-08-01T09:52:14.000Z",
      updated_at: "2026-08-01T09:52:14.000Z",
    });
    listSyncConflictsMock.mockResolvedValueOnce({
      conflicts: [
        {
          id: "server_client_reported",
          client_conflict_id: localConflictId,
          source_event_id: null,
          device_id: dbState.scope.device_id,
          entity_type: "customer",
          entity_id: "customer_shared",
          reason_code: "CLIENT_SYNC_CONFLICT",
          message: "duplicate client report",
          status: "open",
          local_snapshot: { customer: { name: "Device B name" } },
          server_snapshot: { conflict: { id: "server_push_conflict" } },
          server_version: sourceEventId,
          version: 1,
          detected_at: "2026-08-01T09:52:15.000Z",
          created_at: "2026-08-01T09:52:15.000Z",
          updated_at: "2026-08-01T09:52:15.000Z",
        },
        {
          id: "server_push_conflict",
          client_conflict_id: null,
          source_event_id: sourceEventId,
          device_id: dbState.scope.device_id,
          entity_type: "customer",
          entity_id: "customer_shared",
          reason_code: "SYNC_CUSTOMER_VERSION_CONFLICT",
          message: "Customer changed on another device",
          status: "open",
          local_snapshot: { customer: { name: "Device B name" } },
          server_snapshot: { id: "customer_shared", name: "Device A name", updatedAt: "2026-08-01T09:50:34.538Z" },
          server_version: "44",
          version: 1,
          detected_at: "2026-08-01T09:52:14.000Z",
          created_at: "2026-08-01T09:52:14.000Z",
          updated_at: "2026-08-01T09:52:14.000Z",
        },
      ],
      summary: { open: 2, resolved: 0, dismissed: 0 },
      pagination: { hasMore: false, nextCursor: null, limit: 100 },
    });

    const snapshot = await readSyncSnapshot();

    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0]).toEqual(expect.objectContaining({
      server_conflict_id: "server_push_conflict",
      source_event_id: sourceEventId,
      local_snapshot: { customer: { name: "Device B name" } },
      server_snapshot: { id: "customer_shared", name: "Device A name", updatedAt: "2026-08-01T09:50:34.538Z" },
    }));
  });
});
