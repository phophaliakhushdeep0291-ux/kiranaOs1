import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row extends Record<string, unknown> {
  id?: string;
  key?: string;
  clientEventId?: string;
  local_id?: string;
  server_id?: string;
  tenant_id?: string;
  store_id?: string;
  status?: string;
  sync_status?: string;
}

type Predicate = (row: Row) => boolean;

const dbState = vi.hoisted(() => {
  const scope = {
    tenant_id: "tenant_sync_contract",
    store_id: "store_sync_contract",
    device_id: "device_sync_contract",
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
const acknowledgeSyncSequenceMock = vi.hoisted(() => vi.fn());
const requestSyncRetryMock = vi.hoisted(() => vi.fn());
const reportSyncConflictMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => dbState.scope,
  nowIso: () => "2026-06-06T12:00:00.000Z",
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
          event.last_attempt_at = "2026-06-06T12:00:00.000Z";
          event.next_retry_at =
            status === "FAILED" ? "2026-06-06T11:59:00.000Z" : null;
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
  acknowledgeSyncSequence: acknowledgeSyncSequenceMock,
  getSyncStatus: vi.fn(async () => ({ allowed: true })),
  requestSyncRetry: requestSyncRetryMock,
  reportSyncConflict: reportSyncConflictMock,
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
import {
  pullServerChanges,
  pushPendingOutboxOperations,
  retryFailedSyncOperations,
} from "@/features/sync/engine";
import {
  applyIdMappingsFromResponse,
  collectUnmappedLocalIds,
  replaceLocalEntityId,
} from "@/features/sync/sync-id-mapping";

const mockedSyncPush = vi.mocked(syncPushMock);

function scopedRows(table: string) {
  return dbState.rows(table).filter(dbState.matchesScope);
}

function seedBillRows() {
  dbState.putInto("bills", {
    id: "bill_local_1",
    local_id: "bill_local_1",
    billNo: "B-LOCAL-1",
    total: 590,
    status: "pending_sync",
    sync_status: "pending_sync",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
  });
  dbState.putInto("bill_items", {
    id: "bill_item_local_1",
    bill_id: "bill_local_1",
    billId: "bill_local_1",
    product_id: "server_product_chini",
    name: "Chini",
    quantity: 2,
    price: 45,
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    sync_status: "pending_sync",
  });
  dbState.putInto("payments", {
    id: "payment_local_1",
    bill_id: "bill_local_1",
    billId: "bill_local_1",
    amount: 500,
    mode: "cash",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    sync_status: "pending_sync",
  });
  dbState.putInto("customer_ledger", {
    id: "ledger_local_1",
    bill_id: "bill_local_1",
    billId: "bill_local_1",
    reference_id: "bill_local_1",
    amount: 90,
    type: "BILL",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    sync_status: "pending_sync",
  });
}

function seedCreateBillOutbox(overrides: Partial<Row> = {}) {
  const event: Row = {
    op_id: "op_create_bill_1",
    clientEventId: "op_create_bill_1",
    idempotency_key: "idem-create-bill-1",
    type: "CREATE_BILL",
    operation_type: "CREATE_BILL",
    entity_type: "bill",
    entity_id: "bill_local_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    payload: {
      local_bill_id: "bill_local_1",
      total: 590,
      items: [{ local_item_id: "bill_item_local_1", product_id: "server_product_chini" }],
      payments: [{ local_payment_id: "payment_local_1", amount: 500 }],
    },
    client_created_at: "2026-06-06T11:55:00.000Z",
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

function createBillSuccessResponse(event: Row, status = "SYNCED") {
  return {
    results: [
      {
        op_id: event.op_id,
        status,
        entity_type: "bill",
        local_id: "bill_local_1",
        server_id: "server_bill_id",
        server_record: {
          id: "server_bill_id",
          billNo: "B-SERVER-1",
          total: 590,
          tenant_id: dbState.scope.tenant_id,
          store_id: dbState.scope.store_id,
        },
        id_mappings: [
          { entity_type: "bill", local_id: "bill_local_1", server_id: "server_bill_id" },
          {
            entity_type: "payment",
            local_id: "payment_local_1",
            server_id: "server_payment_id",
          },
        ],
      },
    ],
    cursor: "cursor_after_push",
  };
}

function seedProductOutbox(overrides: Partial<Row> = {}) {
  const event: Row = {
    op_id: "op_update_product_1",
    clientEventId: "op_update_product_1",
    idempotency_key: "idem-product-failure-1",
    type: "UPDATE_PRODUCT",
    operation_type: "UPDATE_PRODUCT",
    entity_type: "product",
    entity_id: "product_local_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    payload: { id: "product_local_1", name: "Sugar" },
    client_created_at: "2026-06-06T11:56:00.000Z",
    status: "PENDING",
    sync_status: "pending_sync",
    retry_count: 0,
    attempts: 0,
    createdAt: 2,
    next_retry_at: null,
    ...overrides,
  };
  dbState.putInto("products", {
    id: "product_local_1",
    name: "Sugar",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    sync_status: "pending_sync",
  });
  dbState.putInto("sync_outbox", event);
  return event;
}

describe("sync backend contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    dbState.reset();
    syncPullMock.mockResolvedValue({ changes: [], cursor: "cursor_empty" });
    acknowledgeSyncSequenceMock.mockResolvedValue({ acknowledgement: { accepted: true } });
    requestSyncRetryMock.mockResolvedValue({ queued: true });
    reportSyncConflictMock.mockResolvedValue({
      conflict: {
        id: "server_conflict_reported_1",
        entity_type: "product",
        entity_id: "server_product_delete_pending",
        reason_code: "CLIENT_SYNC_CONFLICT",
        message: "reported",
        status: "open",
        version: 1,
        detected_at: "2026-06-06T12:00:00.000Z",
        created_at: "2026-06-06T12:00:00.000Z",
        updated_at: "2026-06-06T12:00:00.000Z",
        server_version: "52",
      },
    });
  });

  it("POST /sync/push successful CREATE_BILL maps local IDs to server IDs", async () => {
    seedBillRows();
    const event = seedCreateBillOutbox();
    mockedSyncPush.mockResolvedValueOnce(createBillSuccessResponse(event));

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ pushed: 1, failed: 0 }));
    expect(syncPush).toHaveBeenCalledTimes(1);
    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        op_id: "op_create_bill_1",
        idempotency_key: "idem-create-bill-1",
        entity_type: "bill",
      }),
    );
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "SYNCED", sync_status: "synced" }),
    );
    expect(scopedRows("bills")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "server_bill_id",
          local_id: "bill_local_1",
          server_id: "server_bill_id",
          sync_status: "synced",
        }),
        expect.objectContaining({
          id: "bill_local_1",
          merged_into_id: "server_bill_id",
          deleted_at: "2026-06-06T12:00:00.000Z",
        }),
      ]),
    );
    expect(scopedRows("bill_items")[0]).toEqual(
      expect.objectContaining({ bill_id: "server_bill_id", billId: "server_bill_id" }),
    );
    expect(scopedRows("payments")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "payment_local_1",
          local_id: "payment_local_1",
          bill_id: "server_bill_id",
          billId: "server_bill_id",
          sync_status: "synced",
        }),
      ]),
    );
    expect(scopedRows("customer_ledger")[0]).toEqual(
      expect.objectContaining({ bill_id: "server_bill_id", billId: "server_bill_id" }),
    );
    expect(scopedRows("id_mappings")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: "bill",
          local_id: "bill_local_1",
          server_id: "server_bill_id",
        }),
      ]),
    );
  });

  it("POST /sync/push treats mapped operations without per-op results as synced", async () => {
    seedBillRows();
    const event = seedCreateBillOutbox();
    mockedSyncPush.mockResolvedValueOnce({
      idMappings: {
        bills: { bill_local_1: "server_bill_id" },
        payments: { payment_local_1: "server_payment_id" },
      },
      results: [],
      cursor: "cursor_after_mapping_only_push",
    });

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ pushed: 1, failed: 0 }));
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({
        clientEventId: event.clientEventId,
        status: "SYNCED",
        sync_status: "synced",
        error_message: null,
      }),
    );
    expect(scopedRows("bills")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "server_bill_id",
          local_id: "bill_local_1",
          server_id: "server_bill_id",
          sync_status: "synced",
        }),
        expect.objectContaining({
          id: "bill_local_1",
          merged_into_id: "server_bill_id",
          deleted_at: "2026-06-06T12:00:00.000Z",
        }),
      ]),
    );
    expect(scopedRows("payments")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "server_payment_id",
          local_id: "payment_local_1",
          server_id: "server_payment_id",
          bill_id: "server_bill_id",
          sync_status: "synced",
        }),
      ]),
    );
  });

  it("POST /sync/push duplicate idempotency returns the same server bill without duplicating history", async () => {
    seedBillRows();
    const event = seedCreateBillOutbox();
    mockedSyncPush.mockResolvedValueOnce(createBillSuccessResponse(event, "duplicate"));

    await pushPendingOutboxOperations();

    const activeServerBills = scopedRows("bills").filter(
      (bill) => bill.id === "server_bill_id" && bill.deleted_at == null,
    );
    expect(activeServerBills).toHaveLength(1);
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "SYNCED", idempotency_key: "idem-create-bill-1" }),
    );
  });

  it("ledger id replacement keeps local tombstone and id mapping primary keys stable", async () => {
    dbState.putInto("customer_ledger", {
      id: "ledger_local_adjust_1",
      customerId: "customer_1",
      customer_id: "customer_1",
      type: "ADJUSTMENT",
      source_type: "manual_adjustment",
      amount: 1,
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "pending_sync",
      deleted_at: null,
      created_at: "2026-06-06T12:00:00.000Z",
      updated_at: "2026-06-06T12:00:00.000Z",
      version: 1,
    });
    dbState.putInto("id_mappings", {
      local_id: "ledger_local_adjust_1",
      server_id: "server_ledger_adjust_1",
      entity_type: "ledger_entry",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      updated_at: "2026-06-06T12:00:00.000Z",
    });

    await replaceLocalEntityId("ledger_entry", "ledger_local_adjust_1", "server_ledger_adjust_1", {
      ledgerEntryId: "server_ledger_adjust_1",
      customerId: "customer_1",
      amount: 1,
    });

    expect(scopedRows("customer_ledger")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "server_ledger_adjust_1",
          local_id: "ledger_local_adjust_1",
          server_id: "server_ledger_adjust_1",
          sync_status: "synced",
          deleted_at: null,
        }),
        expect.objectContaining({
          id: "ledger_local_adjust_1",
          merged_into_id: "server_ledger_adjust_1",
          server_id: "server_ledger_adjust_1",
          deleted_at: "2026-06-06T12:00:00.000Z",
        }),
      ]),
    );
    expect(scopedRows("id_mappings")).toContainEqual(
      expect.objectContaining({
        entity_type: "ledger_entry",
        local_id: "ledger_local_adjust_1",
        server_id: "server_ledger_adjust_1",
      }),
    );
  });

  it("ledgerEntries id mapping aliases do not create blank ledger rows", async () => {
    await applyIdMappingsFromResponse({
      ledgerEntries: {
        payment_local_1: "server_ledger_1",
      },
    });

    expect(scopedRows("customer_ledger")).toHaveLength(0);
    expect(scopedRows("id_mappings")).toContainEqual(
      expect.objectContaining({
        entity_type: "ledger_entry",
        local_id: "payment_local_1",
        server_id: "server_ledger_1",
      }),
    );
  });

  it("payment and ledger identity ids do not block RECORD_PAYMENT upload", () => {
    const unresolved = collectUnmappedLocalIds(
      {
        paymentId: "payment_local_1",
        localPaymentId: "payment_local_1",
        clientPaymentId: "payment_local_1",
        ledgerEntryId: "ledger_local_1",
        localLedgerEntryId: "ledger_local_1",
        clientLedgerId: "ledger_local_1",
        payment: {
          paymentId: "payment_local_1",
          payment_id: "payment_local_1",
          clientPaymentId: "payment_local_1",
          client_payment_id: "payment_local_1",
          ledgerEntryId: "ledger_local_1",
          ledger_entry_id: "ledger_local_1",
          clientLedgerId: "ledger_local_1",
          client_ledger_id: "ledger_local_1",
        },
        customerId: "server_customer_1",
        amount: 200,
      },
      {},
      new Set(["payment_local_1"]),
    );

    expect(unresolved).toEqual([]);
  });

  it("movement and purchase identity ids do not block stock or purchase sync", () => {
    const unresolved = collectUnmappedLocalIds(
      {
        movementId: "stock_purchase_local_1",
        movement_id: "stock_purchase_local_1",
        clientMovementId: "stock_purchase_local_1",
        client_movement_id: "stock_purchase_local_1",
        localMovementId: "stock_purchase_local_1",
        local_movement_id: "stock_purchase_local_1",
        inventoryMovementId: "stock_purchase_local_1",
        localInventoryMovementId: "stock_purchase_local_1",
        purchaseHistoryId: "local_purchase_history_1",
        purchaseBillId: "local_purchase_history_1",
        localPurchaseHistoryId: "local_purchase_history_1",
        localPurchaseBillId: "local_purchase_history_1",
        productId: "server_product_1",
        supplierId: "server_supplier_1",
        quantity: 10,
      },
      {},
      new Set(["stock_purchase_local_1"]),
    );

    expect(unresolved).toEqual([]);
  });

  it("settles STOCK_PURCHASE when backend replies with stock/purchase ids", async () => {
    dbState.putInto("inventory_movements", {
      id: "stock_purchase_local_1",
      local_id: "stock_purchase_local_1",
      productId: "server_product_1",
      quantity: 10,
      movementType: "purchase",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "pending_sync",
    });
    dbState.putInto("sync_outbox", {
      op_id: "op_stock_purchase_1",
      clientEventId: "op_stock_purchase_1",
      idempotency_key: "idem-stock-purchase-1",
      type: "STOCK_PURCHASE",
      operation_type: "STOCK_PURCHASE",
      entity_type: "inventory_movement",
      entity_id: "stock_purchase_local_1",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      payload: {
        movementId: "stock_purchase_local_1",
        localMovementId: "stock_purchase_local_1",
        clientMovementId: "stock_purchase_local_1",
        productId: "server_product_1",
        quantity: 10,
      },
      client_created_at: "2026-06-06T11:58:00.000Z",
      status: "PENDING",
      sync_status: "pending_sync",
      retry_count: 0,
      attempts: 0,
      createdAt: 4,
      next_retry_at: null,
    });
    mockedSyncPush.mockResolvedValueOnce({
      results: [
        {
          status: "SYNCED",
          stockLedgerId: "server_stock_1",
          localMovementId: "stock_purchase_local_1",
          purchaseHistoryId: "server_purchase_1",
        },
      ],
    });

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(
      expect.objectContaining({ pushed: 1, failed: 0, skipped: 0 }),
    );
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "SYNCED", sync_status: "synced" }),
    );
    expect(scopedRows("id_mappings")).toContainEqual(
      expect.objectContaining({
        entity_type: "inventory_movement",
        local_id: "stock_purchase_local_1",
        server_id: "server_stock_1",
      }),
    );
  });

  it("settles every local movement returned by a STOCK_PURCHASE_BATCH", async () => {
    for (const id of ["batch_movement_1", "batch_movement_2"]) {
      dbState.putInto("inventory_movements", {
        id, local_id: id, productId: `server_product_${id}`, tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id, device_id: dbState.scope.device_id, sync_status: "pending_sync",
      });
    }
    dbState.putInto("sync_outbox", {
      op_id: "op_purchase_batch_1", clientEventId: "op_purchase_batch_1", idempotency_key: "purchase-batch-1",
      type: "STOCK_PURCHASE_BATCH", operation_type: "STOCK_PURCHASE_BATCH", entity_type: "inventory_movement",
      entity_id: "purchase_batch_1", tenant_id: dbState.scope.tenant_id, store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id, client_created_at: "2026-06-06T11:58:00.000Z",
      status: "PENDING", sync_status: "pending_sync", retry_count: 0, attempts: 0, createdAt: 5, next_retry_at: null,
      payload: { batchId: "purchase_batch_1", lines: [
        { movementId: "batch_movement_1", clientMovementId: "batch_movement_1", productId: "server_product_batch_movement_1", quantity: 1 },
        { movementId: "batch_movement_2", clientMovementId: "batch_movement_2", productId: "server_product_batch_movement_2", quantity: 1 },
      ] },
    });
    mockedSyncPush.mockResolvedValueOnce({ results: [{
      status: "SYNCED", batchId: "purchase_batch_1", movements: [
        { localMovementId: "batch_movement_1", stockLedgerId: "server_batch_stock_1" },
        { localMovementId: "batch_movement_2", stockLedgerId: "server_batch_stock_2" },
      ],
    }] });

    expect(await pushPendingOutboxOperations()).toEqual(expect.objectContaining({ pushed: 1, failed: 0 }));
    expect(new Set(scopedRows("inventory_movements").map((row) => row.sync_status))).toEqual(new Set(["synced"]));
    expect(scopedRows("id_mappings")).toEqual(expect.arrayContaining([
      expect.objectContaining({ local_id: "batch_movement_1", server_id: "server_batch_stock_1" }),
      expect.objectContaining({ local_id: "batch_movement_2", server_id: "server_batch_stock_2" }),
    ]));
  });

  it("pushes RECORD_PAYMENT operations that carry local payment and ledger identities", async () => {
    dbState.putInto("sync_outbox", {
      op_id: "op_record_payment_1",
      clientEventId: "op_record_payment_1",
      idempotency_key: "idem-record-payment-1",
      type: "RECORD_PAYMENT",
      operation_type: "RECORD_PAYMENT",
      entity_type: "payment",
      entity_id: "payment_local_1",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      payload: {
        customerId: "server_customer_1",
        amount: 200,
        mode: "cash",
        paymentId: "payment_local_1",
        clientPaymentId: "payment_local_1",
        ledgerEntryId: "ledger_local_1",
        clientLedgerId: "ledger_local_1",
        payment: {
          paymentId: "payment_local_1",
          clientPaymentId: "payment_local_1",
          ledgerEntryId: "ledger_local_1",
          clientLedgerId: "ledger_local_1",
          amount: 200,
          mode: "cash",
        },
      },
      client_created_at: "2026-06-06T11:57:00.000Z",
      status: "PENDING",
      sync_status: "pending_sync",
      retry_count: 0,
      attempts: 0,
      createdAt: 3,
      next_retry_at: null,
    });
    mockedSyncPush.mockResolvedValueOnce({
      results: [{ op_id: "op_record_payment_1", status: "SYNCED" }],
    });

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(
      expect.objectContaining({ pushed: 1, failed: 0, skipped: 0 }),
    );
    expect(syncPush).toHaveBeenCalledTimes(1);
    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        op_id: "op_record_payment_1",
        operation_type: "UDHAR_PAYMENT",
        entity_type: "payment",
      }),
    );
    expect(request.operations[0].payload).toEqual(
      expect.objectContaining({
        paymentId: "payment_local_1",
        clientPaymentId: "payment_local_1",
        ledgerEntryId: "ledger_local_1",
        clientLedgerId: "ledger_local_1",
      }),
    );
  });

  it("POST /sync/push partial failure keeps failed local data and marks only that operation FAILED", async () => {
    seedBillRows();
    const billEvent = seedCreateBillOutbox();
    const productEvent = seedProductOutbox();
    mockedSyncPush.mockResolvedValueOnce({
      results: [
        createBillSuccessResponse(billEvent).results[0],
        {
          op_id: productEvent.op_id,
          status: "FAILED",
          entity_type: "product",
          local_id: "product_local_1",
          error_message: "validation failed",
        },
      ],
    });

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ pushed: 1, failed: 1 }));
    expect(scopedRows("products")).toEqual([
      expect.objectContaining({ id: "product_local_1", name: "Sugar" }),
    ]);
    expect(scopedRows("sync_outbox")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientEventId: billEvent.clientEventId, status: "SYNCED" }),
        expect.objectContaining({
          clientEventId: productEvent.clientEventId,
          status: "FAILED",
          error_message: "validation failed",
        }),
      ]),
    );
  });

  it("GET /sync/pull returns server changes and merges them locally", async () => {
    syncPullMock.mockResolvedValueOnce({
      changes: [
        {
          entity_type: "product",
          entity: {
            id: "server_product_pull_1",
            name: "Pulled Rice",
            category: "Grocery",
            tenant_id: dbState.scope.tenant_id,
            store_id: dbState.scope.store_id,
            version: 3,
          },
        },
      ],
      cursor: "cursor_pull_1",
    });

    const result = await pullServerChanges();

    expect(result).toEqual(expect.objectContaining({ pulled: 1, conflicts: 0 }));
    expect(syncPullMock).toHaveBeenCalledWith(expect.objectContaining({ since: "1970-01-01T00:00:00.000Z", limit: 500, cursor: null, afterSeq: "0" }));
    expect(scopedRows("products")).toEqual([
      expect.objectContaining({
        id: "server_product_pull_1",
        server_id: "server_product_pull_1",
        name: "Pulled Rice",
        sync_status: "synced",
      }),
    ]);
  });

  it("persists the monotonic server sequence and resumes the next pull from it", async () => {
    syncPullMock
      .mockResolvedValueOnce({
        changes: [],
        sync: {
          protocol: "server_sequence_v2",
          nextServerSeq: "42",
          serverVersion: "42",
          hasMore: false,
        },
      })
      .mockResolvedValueOnce({
        changes: [],
        sync: {
          protocol: "server_sequence_v2",
          nextServerSeq: "45",
          serverVersion: "45",
          hasMore: false,
        },
      });

    await pullServerChanges();

    expect(scopedRows("sync_cursor")).toContainEqual(
      expect.objectContaining({
        id: "server-sequence-v2",
        entity_type: "server_sequence",
        cursor: "42",
      }),
    );
    expect(acknowledgeSyncSequenceMock).toHaveBeenLastCalledWith("42", { background: true });

    await pullServerChanges();

    expect(syncPullMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterSeq: "42", cursor: null }),
    );
    expect(scopedRows("sync_cursor")).toContainEqual(
      expect.objectContaining({ id: "server-sequence-v2", cursor: "45" }),
    );
    expect(acknowledgeSyncSequenceMock).toHaveBeenLastCalledWith("45", { background: true });
  });

  it("applies server tombstones while preserving unsynced local work as a conflict", async () => {
    dbState.putInto("products", {
      id: "server_product_delete_synced",
      server_id: "server_product_delete_synced",
      name: "Synced product",
      sync_status: "synced",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
    });
    dbState.putInto("products", {
      id: "server_product_delete_pending",
      server_id: "server_product_delete_pending",
      name: "Locally edited product",
      sync_status: "pending_sync",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
    });
    syncPullMock.mockResolvedValueOnce({
      changes: [
        {
          change_id: "51",
          entity_type: "product",
          entity_id: "server_product_delete_synced",
          operation_type: "delete",
          entity: null,
          server_version: "51",
          deleted_at: "2026-07-14T00:00:00.000Z",
        },
        {
          change_id: "52",
          entity_type: "product",
          entity_id: "server_product_delete_pending",
          operation_type: "delete",
          entity: null,
          server_version: "52",
          deleted_at: "2026-07-14T00:00:01.000Z",
        },
      ],
      sync: {
        protocol: "server_sequence_v2",
        nextServerSeq: "52",
        serverVersion: "52",
        hasMore: false,
      },
    });

    const result = await pullServerChanges();

    expect(result).toEqual(expect.objectContaining({ pulled: 1, conflicts: 1 }));
    expect(scopedRows("products")).toEqual([
      expect.objectContaining({
        id: "server_product_delete_pending",
        name: "Locally edited product",
        sync_status: "conflict",
      }),
    ]);
    expect(scopedRows("sync_conflicts")).toEqual([
      expect.objectContaining({
        entity_type: "product",
        entity_id: "server_product_delete_pending",
        server_snapshot: null,
      }),
    ]);
    expect(reportSyncConflictMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "product",
        entity_id: "server_product_delete_pending",
        server_version: "52",
      }),
      { background: true },
    );
    await vi.waitFor(() => {
      expect(scopedRows("sync_conflicts")[0]).toEqual(
        expect.objectContaining({
          server_conflict_id: "server_conflict_reported_1",
          server_version: "52",
        }),
      );
    });
  });

  it("backend conflict response stores conflict and marks outbox CONFLICT", async () => {
    const event = seedProductOutbox();
    mockedSyncPush.mockResolvedValueOnce({
      results: [
        {
          op_id: event.op_id,
          status: "CONFLICT",
          entity_type: "product",
          local_id: "product_local_1",
          conflict: { server_record: { id: "product_local_1", name: "Server Sugar" } },
          error_message: "version conflict",
        },
      ],
    });

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ conflicts: 1, failed: 0 }));
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "CONFLICT", sync_status: "conflict" }),
    );
    expect(scopedRows("sync_conflicts")).toEqual([
      expect.objectContaining({
        entity_type: "product",
        entity_id: "product_local_1",
        error_message: "version conflict",
      }),
    ]);
  });

  it("retry failed operation works and reuses the same idempotency_key", async () => {
    seedBillRows();
    const failedEvent = seedCreateBillOutbox({
      status: "FAILED",
      sync_status: "failed",
      retry_count: 1,
      attempts: 1,
      last_error: "network down",
      next_retry_at: "2026-06-06T11:59:00.000Z",
    });
    mockedSyncPush.mockResolvedValueOnce(createBillSuccessResponse(failedEvent));

    const result = await retryFailedSyncOperations([String(failedEvent.clientEventId)]);

    expect(result).toEqual(expect.objectContaining({ pushed: 1, failed: 0 }));
    expect(requestSyncRetryMock).toHaveBeenCalledWith({ op_ids: [failedEvent.clientEventId] });
    const request = mockedSyncPush.mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(request.operations[0]).toEqual(
      expect.objectContaining({
        clientEventId: failedEvent.clientEventId,
        idempotency_key: "idem-create-bill-1",
        retry_count: 1,
      }),
    );
    expect(scopedRows("sync_outbox")[0]).toEqual(
      expect.objectContaining({ status: "SYNCED", idempotency_key: "idem-create-bill-1" }),
    );
  });
});
