import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row extends Record<string, unknown> {
  id?: string;
  key?: string;
  clientEventId?: string;
  local_id?: string;
  server_id?: string;
  tenant_id?: string;
  store_id?: string;
}

type Predicate = (row: Row) => boolean;

const dbState = vi.hoisted(() => {
  const scope = {
    tenant_id: "tenant_sync_reliable",
    store_id: "store_sync_reliable",
    device_id: "device_sync_reliable",
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
    "purchase_bills",
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

    async modify(mutator: (row: Row) => void) {
      for (const row of rows(this.tableName)) {
        if (this.predicates.every((predicate) => predicate(row))) mutator(row);
      }
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
    tableNames,
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
const getSyncStatusMock = vi.hoisted(() => vi.fn(async () => ({ allowed: true })));
const requestSyncRetryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => dbState.scope,
  nowIso: () => "2026-06-06T11:00:00.000Z",
}));

vi.mock("@/lib/offline/db", () => {
  const scopedRows = (table: string) =>
    dbState.rows(table).filter(dbState.matchesScope);
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
      scopedRows("sync_outbox").filter((event) =>
        ["PENDING", "FAILED", "CONFLICT"].includes(String(event.status)),
      ).length,
    ),
    updatePendingEventStatus: vi.fn(
      async (clientEventIds: string[], status: string, errorMessage?: string) => {
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
                    : event.sync_status;
          event.retry_count = retryCount;
          event.attempts = retryCount;
          event.error_message = status === "SYNCED" ? null : (errorMessage ?? null);
          event.last_error = status === "SYNCED" ? null : (errorMessage ?? null);
          event.last_attempt_at = "2026-06-06T11:00:00.000Z";
          event.next_retry_at =
            status === "FAILED" ? "2026-06-06T10:59:00.000Z" : null;
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

vi.mock("@/features/sync/api", () => ({
  syncPush: syncPushMock,
  syncPull: syncPullMock,
  getSyncStatus: getSyncStatusMock,
  requestSyncRetry: requestSyncRetryMock,
}));

vi.mock("@/features/subscription/access", () => ({
  getCurrentSubscriptionSnapshot: vi.fn(async () => ({ cloudSyncAllowed: true })),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  emitLocalDataChanged: vi.fn(),
  writeInstantCache: vi.fn(),
  pruneRecentRows: vi.fn((rows: unknown[]) => rows),
}));

import { syncPush } from "@/features/sync/api";
import { ApiClientError } from "@/lib/api/http";
import {
  pullServerChanges,
  pushPendingOutboxOperations,
  retryFailedSyncOperations,
  runSyncCycle,
} from "@/features/sync/engine";

const mockedSyncPush = vi.mocked(syncPushMock);

function scopedRows(table: string) {
  return dbState.rows(table).filter(dbState.matchesScope);
}

function seedOutbox(overrides: Partial<Row> = {}) {
  const event: Row = {
    op_id: "op_product_1",
    clientEventId: "op_product_1",
    idempotency_key: "idem-product-1",
    type: "UPDATE_PRODUCT",
    operation_type: "UPDATE_PRODUCT",
    entity_type: "product",
    entity_id: "product_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    payload: { id: "product_1", name: "Sugar" },
    client_created_at: "2026-06-06T10:55:00.000Z",
    status: "PENDING",
    sync_status: "pending_sync",
    retry_count: 0,
    attempts: 0,
    createdAt: 1,
    next_retry_at: null,
    ...overrides,
  };
  dbState.putInto("sync_outbox", event);
  return event;
}

function successResult(event: Row, serverId = "server_product_1") {
  return {
    clientEventId: event.clientEventId,
    eventId: event.clientEventId,
    op_id: event.op_id,
    idempotency_key: event.idempotency_key,
    success: true,
    status: "synced",
    entity_type: "product",
    localProductId: event.entity_id,
    productId: serverId,
    entity: {
      id: serverId,
      local_id: event.entity_id,
      name: "Sugar synced",
      defaultPricePerRateUnit: 50,
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "synced",
    },
  };
}

function billSuccessResult(event: Row, serverId = "server_bill_1") {
  return {
    clientEventId: event.clientEventId,
    eventId: event.clientEventId,
    op_id: event.op_id,
    idempotency_key: event.idempotency_key,
    success: true,
    status: "synced",
    entity_type: "bill",
    localBillId: event.entity_id,
    serverBillId: serverId,
    billId: serverId,
    bill: {
      id: serverId,
      local_id: event.entity_id,
      server_id: serverId,
      billNo: "B-UDHAR-1",
      grandTotal: 450,
      creditAmount: 450,
      paidAmount: 0,
      payments: [],
      billItems: [],
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "synced",
    },
  };
}

describe("sync engine reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    dbState.reset();
    getSyncStatusMock.mockResolvedValue({ allowed: true });
    syncPullMock.mockResolvedValue({ changes: [], cursor: "cursor_empty" });
    requestSyncRetryMock.mockResolvedValue({ queued: true });
  });

  it("push sends idempotency_key", async () => {
    const event = seedOutbox();
    mockedSyncPush.mockResolvedValueOnce({ results: [successResult(event)] });

    await pushPendingOutboxOperations();

    expect(syncPush).toHaveBeenCalledTimes(1);
    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
    };
    expect(request.operations).toEqual([
      expect.objectContaining({
        op_id: "op_product_1",
        idempotency_key: "idem-product-1",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
      }),
    ]);
    expect(request.events[0]?.idempotency_key).toBe("idem-product-1");
  });

  it("failed operations become FAILED, not deleted", async () => {
    seedOutbox();
    mockedSyncPush.mockRejectedValueOnce(new Error("network down"));

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ pushed: 0, failed: 1 }));
    expect(scopedRows("sync_outbox")).toHaveLength(1);
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({
        clientEventId: "op_product_1",
        status: "FAILED",
        sync_status: "failed",
        retry_count: 1,
        idempotency_key: "idem-product-1",
      }),
    );
  });

  it("retry reuses the same idempotency_key", async () => {
    const failed = seedOutbox({
      status: "FAILED",
      sync_status: "failed",
      retry_count: 1,
      attempts: 1,
      last_error: "network down",
      next_retry_at: "2026-06-06T10:59:00.000Z",
    });
    mockedSyncPush.mockResolvedValueOnce({ results: [successResult(failed)] });

    await retryFailedSyncOperations([String(failed.clientEventId)]);

    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        clientEventId: failed.clientEventId,
        idempotency_key: "idem-product-1",
        retry_count: 1,
      }),
    );
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "SYNCED", idempotency_key: "idem-product-1" }),
    );
  });

  it("retry requeues conflict operations after a backend validation fix", async () => {
    const conflict = seedOutbox({
      status: "CONFLICT",
      sync_status: "conflict",
      retry_count: 1,
      attempts: 1,
      error_message: "At least one payment required",
      next_retry_at: null,
    });
    mockedSyncPush.mockResolvedValueOnce({ results: [successResult(conflict)] });

    await retryFailedSyncOperations();

    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        clientEventId: conflict.clientEventId,
        idempotency_key: "idem-product-1",
      }),
    );
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({
        status: "SYNCED",
        sync_status: "synced",
        idempotency_key: "idem-product-1",
      }),
    );
  });

  it("force sync auto-recovers old udhar payment validation conflicts", async () => {
    dbState.putInto("bills", {
      id: "bill_udhar_conflict",
      local_id: "bill_udhar_conflict",
      billNo: "PENDING-UDHAR",
      grandTotal: 450,
      creditAmount: 450,
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "conflict",
    });
    dbState.putInto("id_mappings", {
      local_id: "customer_udhar_1",
      server_id: "server_customer_udhar_1",
      entity_type: "customer",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
    });
    const conflict = seedOutbox({
      op_id: "op_bill_udhar_conflict",
      clientEventId: "op_bill_udhar_conflict",
      idempotency_key: "idem-bill-udhar-conflict",
      type: "CREATE_BILL",
      operation_type: "CREATE_BILL",
      entity_type: "bill",
      entity_id: "bill_udhar_conflict",
      payload: {
        id: "bill_udhar_conflict",
        localBillId: "bill_udhar_conflict",
        billType: "sale",
        customerId: "customer_udhar_1",
        customerName: "Khushdeep",
        items: [{ name: "Sugar", quantity: 1, enteredUnit: "kg", ratePerRateUnit: 450, gstRate: 0 }],
        payments: [],
        creditAmount: 450,
        grandTotal: 450,
      },
      status: "CONFLICT",
      sync_status: "conflict",
      retry_count: 1,
      attempts: 1,
      error_message: "At least one payment required",
      next_retry_at: null,
    });
    dbState.putInto("sync_conflicts", {
      id: "conflict_bill_udhar_conflict_op_bill_udhar_conflict",
      entity_type: "bill",
      entity_id: "bill_udhar_conflict",
      sourceId: "op_bill_udhar_conflict",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "conflict",
      resolution: "unresolved",
      local_snapshot: conflict.payload,
      server_snapshot: { error: "At least one payment required" },
    });
    mockedSyncPush.mockResolvedValueOnce({ results: [billSuccessResult(conflict)] });

    const result = await runSyncCycle();

    expect(result).toEqual(expect.objectContaining({ pushed: 1, failed: 0, conflicts: 0, pending: 0 }));
    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        clientEventId: "op_bill_udhar_conflict",
        idempotency_key: "idem-bill-udhar-conflict",
        payload: expect.objectContaining({
          creditAmount: 450,
          payments: [],
        }),
      }),
    );
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "SYNCED", sync_status: "synced" }),
    );
    expect(scopedRows("sync_conflicts")[0]).toEqual(
      expect.objectContaining({ resolution: "auto_resolved", sync_status: "synced" }),
    );
  });

  it("pull merges server changes", async () => {
    syncPullMock.mockResolvedValueOnce({
      changes: [
        {
          entity_type: "product",
          entity: {
            id: "server_product_pull_1",
            name: "Pulled Tea",
            category: "Grocery",
            defaultPricePerRateUnit: 80,
            tenant_id: dbState.scope.tenant_id,
            store_id: dbState.scope.store_id,
            version: 5,
          },
        },
      ],
      cursor: "cursor_5",
    });

    const result = await pullServerChanges();

    expect(result).toEqual(expect.objectContaining({ pulled: 1, conflicts: 0, cursor: "cursor_5" }));
    expect(scopedRows("products")).toEqual([
      expect.objectContaining({
        id: "server_product_pull_1",
        server_id: "server_product_pull_1",
        name: "Pulled Tea",
        sync_status: "synced",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
      }),
    ]);
    expect(scopedRows("sync_cursor")).toContainEqual(
      expect.objectContaining({ id: "global", cursor: "cursor_5" }),
    );
  });

  it("local unsynced changes are preserved and conflicts are stored in sync_conflicts", async () => {
    dbState.putInto("products", {
      id: "server_product_conflict_1",
      server_id: "server_product_conflict_1",
      name: "Local unsynced Sugar",
      defaultPricePerRateUnit: 52,
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "pending_sync",
      updated_at: "2026-06-06T10:50:00.000Z",
    });
    syncPullMock.mockResolvedValueOnce({
      changes: [
        {
          entity_type: "product",
          change_id: "change_server_product_conflict_1",
          entity: {
            id: "server_product_conflict_1",
            name: "Server Sugar",
            defaultPricePerRateUnit: 60,
            tenant_id: dbState.scope.tenant_id,
            store_id: dbState.scope.store_id,
            version: 6,
          },
        },
      ],
      cursor: "cursor_conflict",
    });

    const result = await pullServerChanges();

    expect(result).toEqual(expect.objectContaining({ pulled: 0, conflicts: 1 }));
    expect(scopedRows("products")[0]).toEqual(
      expect.objectContaining({
        id: "server_product_conflict_1",
        name: "Local unsynced Sugar",
        defaultPricePerRateUnit: 52,
        sync_status: "conflict",
      }),
    );
    expect(scopedRows("sync_conflicts")).toEqual([
      expect.objectContaining({
        entity_type: "product",
        entity_id: "server_product_conflict_1",
        resolution: "unresolved",
        local_snapshot: expect.objectContaining({ name: "Local unsynced Sugar" }),
        server_snapshot: expect.objectContaining({ name: "Server Sugar" }),
      }),
    ]);
  });

  it("sync resumes after reload from persisted pending outbox", async () => {
    const persisted = seedOutbox({
      op_id: "op_after_reload",
      clientEventId: "op_after_reload",
      idempotency_key: "idem-after-reload",
      entity_id: "product_after_reload",
      payload: { id: "product_after_reload", name: "Reloaded" },
      createdAt: 99,
    });
    mockedSyncPush.mockResolvedValueOnce({
      results: [successResult(persisted, "server_product_after_reload")],
    });

    const result = await runSyncCycle();

    expect(result).toEqual(expect.objectContaining({ pushed: 1, failed: 0 }));
    expect(mockedSyncPush).toHaveBeenCalledTimes(1);
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({
        clientEventId: "op_after_reload",
        status: "SYNCED",
        idempotency_key: "idem-after-reload",
      }),
    );
  });

  it("stops scheduled sync quietly when the backend reports an auth failure", async () => {
    seedOutbox();
    getSyncStatusMock.mockRejectedValueOnce(
      new ApiClientError("Authentication required", 401, { code: "AUTH_REQUIRED" }),
    );

    const result = await runSyncCycle();

    expect(result).toEqual(expect.objectContaining({ pushed: 0, pulled: 0, failed: 0, pending: 1 }));
    expect(mockedSyncPush).not.toHaveBeenCalled();
    expect(syncPullMock).not.toHaveBeenCalled();
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "PENDING", sync_status: "pending_sync" }),
    );
  });

  it("sync is tenant/store scoped", async () => {
    const current = seedOutbox({ op_id: "op_current", clientEventId: "op_current" });
    seedOutbox({
      op_id: "op_other_tenant",
      clientEventId: "op_other_tenant",
      tenant_id: "tenant_other",
      store_id: dbState.scope.store_id,
      device_id: "device_other",
      entity_id: "product_other_tenant",
      idempotency_key: "idem-other-tenant",
      createdAt: 2,
    });
    seedOutbox({
      op_id: "op_other_store",
      clientEventId: "op_other_store",
      tenant_id: dbState.scope.tenant_id,
      store_id: "store_other",
      device_id: "device_other",
      entity_id: "product_other_store",
      idempotency_key: "idem-other-store",
      createdAt: 3,
    });
    mockedSyncPush.mockResolvedValueOnce({ results: [successResult(current)] });

    await pushPendingOutboxOperations();

    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations).toHaveLength(1);
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        op_id: "op_current",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
      }),
    );
    expect(dbState.rows("sync_outbox").find((row) => row.clientEventId === "op_other_tenant")).toEqual(
      expect.objectContaining({ status: "PENDING" }),
    );
    expect(dbState.rows("sync_outbox").find((row) => row.clientEventId === "op_other_store")).toEqual(
      expect.objectContaining({ status: "PENDING" }),
    );
  });
});
