import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillInputBillType, BillPaymentMode, type BillInput } from "@/types/api";

interface Row extends Record<string, unknown> {
  id?: string;
  key?: string;
  clientEventId?: string;
  local_id?: string;
  tenant_id?: string;
  store_id?: string;
}

type Predicate = (row: Row) => boolean;

const dbState = vi.hoisted(() => {
  const scope = {
    tenant_id: "tenant_sync_test",
    store_id: "store_sync_test",
    device_id: "device_sync_test",
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
  const tables: Record<string, Row[]> = {};
  const primaryKey = (table: string) => {
    if (table === "settings") return "key";
    if (table === "sync_outbox") return "clientEventId";
    if (table === "id_mappings") return "local_id";
    return "id";
  };
  const reset = () => {
    for (const table of tableNames) tables[table] = [];
  };
  const rows = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };
  const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
  const matchesScope = (row: Row) =>
    row.tenant_id === scope.tenant_id && row.store_id === scope.store_id;
  const putInto = (table: string, value: Row) => {
    const row = clone(value);
    const pk = primaryKey(table);
    const key = row[pk];
    if (typeof key !== "string") throw new Error(`Missing primary key ${pk} for ${table}`);
    const list = rows(table);
    const index = list.findIndex((existing) => existing[pk] === key);
    if (index >= 0) list[index] = row;
    else list.push(row);
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
      return clone(rows(this.tableName).filter((row) => this.predicates.every((predicate) => predicate(row))));
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
        if (!this.predicates.every((predicate) => predicate(row))) continue;
        mutator(row);
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
      return new FakeQuery(this.tableName, [((row: Row) => {
        if (this.indexName === "[tenant_id+store_id]") {
          return Array.isArray(value) && row.tenant_id === value[0] && row.store_id === value[1];
        }
        return row[this.indexName] === value;
      })]);
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
      tables[this.name] = rows(this.name).filter((row) => !idSet.has(String(row[pk])));
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
      return clone(rows(this.name)).sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")));
    }
  }

  const tableInstances = Object.fromEntries(tableNames.map((name) => [name, new FakeTable(name)])) as Record<string, FakeTable>;
  reset();
  return { scope, tableNames, tables, rows, reset, clone, matchesScope, putInto, tableInstances };
});

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => dbState.scope,
  nowIso: () => "2026-06-06T09:30:00.000Z",
}));

vi.mock("@/lib/offline/db", () => {
  const scopedRows = (table: string) => dbState.rows(table).filter(dbState.matchesScope);
  const isPendingNow = (event: Row) =>
    ["PENDING", "FAILED"].includes(String(event.status)) &&
    (!event.next_retry_at || new Date(String(event.next_retry_at)).getTime() <= Date.now());

  const dexieDB = {
    open: vi.fn(async () => undefined),
    table: vi.fn((name: string) => dbState.tableInstances[name]),
    transaction: vi.fn(async (_mode: string, _tables: unknown, callback: () => Promise<void>) => callback()),
    ...dbState.tableInstances,
  };

  const offlineDB = {
    init: vi.fn(async () => undefined),
    getAll: vi.fn(async (table: string) => dbState.clone(scopedRows(table))),
    putRecentCache: vi.fn(async (key: string, value: unknown, days = 30) => {
      dbState.putInto("settings", {
        key: `cache:${key}`,
        value,
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
        updated_at: "2026-06-06T09:30:00.000Z",
        expires_at: Date.now() + days * 24 * 60 * 60 * 1000,
      });
    }),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: Row) => Promise<void>;
      putMany: (table: string, values: Row[]) => Promise<void>;
      enqueueOutboxOperation: (event: Row) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
    }) => Promise<void>) => {
      const snapshot = dbState.clone(dbState.tables);
      const tx = {
        put: vi.fn(async (table: string, value: Row) => dbState.putInto(table, value)),
        putMany: vi.fn(async (table: string, values: Row[]) => {
          for (const value of values) dbState.putInto(table, value);
        }),
        enqueueOutboxOperation: vi.fn(async (event: Row) => dbState.putInto("sync_outbox", event)),
        setSetting: vi.fn(async (key: string, value: unknown, expiresAt?: number | null) => dbState.putInto("settings", {
          key,
          value,
          tenant_id: dbState.scope.tenant_id,
          store_id: dbState.scope.store_id,
          updated_at: "2026-06-06T09:30:00.000Z",
          expires_at: expiresAt ?? null,
        })),
      };
      try {
        await callback(tx);
      } catch (error) {
        dbState.tables = snapshot;
        throw error;
      }
    }),
    getPendingEvents: vi.fn(async () => dbState.clone(scopedRows("sync_outbox").filter(isPendingNow).sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)))),
    getPendingCount: vi.fn(async () => scopedRows("sync_outbox").filter((event) => ["PENDING", "FAILED"].includes(String(event.status))).length),
    updatePendingEventStatus: vi.fn(async (clientEventIds: string[], status: string, errorMessage?: string) => {
      const idSet = new Set(clientEventIds);
      for (const event of dbState.rows("sync_outbox")) {
        if (!idSet.has(String(event.clientEventId)) || !dbState.matchesScope(event)) continue;
        const retryCount = status === "FAILED" ? Number(event.retry_count ?? 0) + 1 : Number(event.retry_count ?? 0);
        event.status = status;
        event.sync_status = status === "SYNCING" ? "syncing" : status === "SYNCED" ? "synced" : status === "FAILED" ? "failed" : status === "CONFLICT" ? "conflict" : event.sync_status;
        event.retry_count = retryCount;
        event.attempts = retryCount;
        event.error_message = status === "SYNCED" ? null : errorMessage ?? null;
        event.last_error = status === "SYNCED" ? null : errorMessage ?? null;
        event.last_attempt_at = "2026-06-06T09:30:00.000Z";
        event.next_retry_at = status === "FAILED" ? "2026-06-06T09:29:00.000Z" : null;
      }
    }),
  };

  return {
    dexieDB,
    offlineDB,
    rowMatchesCurrentScope: (row: Row) => dbState.matchesScope(row),
    filterRowsForCurrentScope: <T extends Row>(rows: T[]) => rows.filter((row) => dbState.matchesScope(row)),
  };
});

vi.mock("@/features/sync/api", () => ({
  syncPush: vi.fn(),
  syncPull: vi.fn(async () => ({ changes: [], cursor: "cursor_after_pull" })),
  acknowledgeSyncSequence: vi.fn(async () => ({ acknowledgement: { accepted: true } })),
  getSyncStatus: vi.fn(async () => ({ allowed: true })),
  requestSyncRetry: vi.fn(),
}));

vi.mock("@/features/subscription/access", () => ({
  getCurrentSubscriptionSnapshot: vi.fn(async () => ({ cloudSyncAllowed: true })),
}));

import { offlineDB } from "@/lib/offline/db";
import { createBillLocalFirst } from "@/features/billing/local-actions";
import { syncPush } from "@/features/sync/api";
import { pushPendingOutboxOperations } from "@/features/sync/engine";
import {
  dedupeBillsForDisplay,
  dedupePaymentsForDisplay,
  reconcileSyncedBillFromPush,
} from "@/features/sync/bill-reconciliation";
import { hardenLocalFinancialData } from "@/features/sync/local-data-hardening";
import { mergeServerChange } from "@/features/sync/sync-reconcile";

const mockedSyncPush = vi.mocked(syncPush);

function tableRows(table: string) {
  return dbState.rows(table);
}

function scopedRows(table: string) {
  return tableRows(table).filter(dbState.matchesScope);
}

function activeRows(table: string) {
  return scopedRows(table).filter((row) => row.deleted_at == null && row.deletedAt == null);
}

function markNonBillCreateOutboxAsSynced() {
  for (const row of scopedRows("sync_outbox")) {
    if (row.operation_type === "CREATE_BILL") continue;
    row.status = "SYNCED";
    row.sync_status = "synced";
  }
}

function seedCustomer() {
  dbState.putInto("customers", {
    id: "server_customer_1",
    local_id: "server_customer_1",
    tenant_id: dbState.scope.tenant_id,
    store_id: dbState.scope.store_id,
    device_id: dbState.scope.device_id,
    name: "Ramesh",
    type: "regular",
    udharAmount: 25,
    totalUdhar: 25,
    created_at: "2026-06-06T09:00:00.000Z",
    updated_at: "2026-06-06T09:00:00.000Z",
    deleted_at: null,
    version: 1,
    sync_status: "synced",
  });
}

function billInput(overrides: Partial<BillInput> = {}): BillInput {
  return {
    billType: BillInputBillType.normal_sale,
    customerId: "server_customer_1",
    customerName: "Ramesh",
    items: [
      {
        productId: "server_product_1",
        name: "Sugar",
        quantity: 2,
        enteredUnit: "kg",
        ratePerRateUnit: 50,
        gstRate: 0,
      },
    ],
    discount: 0,
    actualAmount: 100,
    buyerPaidAmount: 100,
    payments: [{ mode: BillPaymentMode.cash, amount: 100 }],
    ...overrides,
  };
}

async function createCreditBillForSync() {
  return createBillLocalFirst(billInput({
    buyerPaidAmount: 40,
    payments: [
      { mode: BillPaymentMode.cash, amount: 40 },
      { mode: BillPaymentMode.credit, amount: 60 },
    ],
  }));
}


function createServerAutoPaidBadResult(event: Row, localBillId: string) {
  return {
    clientEventId: String(event.clientEventId),
    eventId: String(event.clientEventId),
    idempotency_key: String(event.idempotency_key),
    success: true,
    status: "SYNCED",
    entity_type: "bill",
    serverBillId: "server_bill_auto_paid_bad",
    localBillId,
    bill: {
      id: "server_bill_auto_paid_bad",
      local_id: localBillId,
      billNo: "BILL-BAD-PAID",
      billNumber: "BILL-BAD-PAID",
      status: "completed",
      totalAmount: 100,
      grandTotal: 100,
      paidAmount: 100,
      creditAmount: 0,
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      payments: [
        {
          id: "server_payment_bad_full",
          mode: BillPaymentMode.cash,
          amount: 100,
          bill_id: "server_bill_auto_paid_bad",
          tenant_id: dbState.scope.tenant_id,
          store_id: dbState.scope.store_id,
        },
      ],
    },
  };
}

function createServerSuccessResult(event: Row, localBillId: string) {
  return {
    clientEventId: String(event.clientEventId),
    eventId: String(event.clientEventId),
    idempotency_key: String(event.idempotency_key),
    success: true,
    status: "SYNCED",
    entity_type: "bill",
    serverBillId: "server_bill_1",
    localBillId,
    bill: {
      id: "server_bill_1",
      local_id: localBillId,
      billNo: "BILL-0001",
      billNumber: "BILL-0001",
      status: "completed",
      totalAmount: 100,
      grandTotal: 100,
      paidAmount: 40,
      creditAmount: 60,
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      items: [
        {
          id: "server_bill_item_1",
          name: "Sugar",
          quantity: 2,
          bill_id: "server_bill_1",
          tenant_id: dbState.scope.tenant_id,
          store_id: dbState.scope.store_id,
        },
      ],
      payments: [
        {
          id: "server_payment_1",
          mode: BillPaymentMode.cash,
          amount: 40,
          bill_id: "server_bill_1",
          tenant_id: dbState.scope.tenant_id,
          store_id: dbState.scope.store_id,
        },
      ],
      customer_ledger: [
        {
          id: "server_ledger_1",
          type: "BILL",
          amount: 60,
          bill_id: "server_bill_1",
          source_id: "server_bill_1",
          tenant_id: dbState.scope.tenant_id,
          store_id: dbState.scope.store_id,
        },
      ],
    },
  };
}

describe("bill sync behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.reset();
    seedCustomer();
  });

  it("offline bill creates a stable local_id and CREATE_BILL operation has idempotency_key", async () => {
    const bill = await createBillLocalFirst(billInput());
    const storedBill = scopedRows("bills")[0];
    const storedPayment = scopedRows("payments")[0];
    const createBillOutbox = scopedRows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL");
    const outboxPayload = createBillOutbox?.payload as Record<string, unknown> | undefined;
    const localPayments = outboxPayload?.local_payments as Array<Record<string, unknown>> | undefined;

    expect(storedBill).toEqual(expect.objectContaining({ id: bill.id, local_id: bill.id, sync_status: "pending_sync" }));
    expect((bill as Record<string, unknown>).local_id).toBe(bill.id);
    expect(storedPayment).toEqual(expect.objectContaining({
      localPaymentId: storedPayment.id,
      local_payment_id: storedPayment.id,
      clientPaymentId: storedPayment.id,
      client_payment_id: storedPayment.id,
      idempotency_key: `bill-payment:${bill.id}:${storedPayment.id}`,
      bill_id: bill.id,
      local_bill_id: bill.id,
      client_bill_id: bill.id,
    }));
    expect(createBillOutbox).toBeDefined();
    expect(createBillOutbox).toEqual(expect.objectContaining({ entity_id: bill.id, operation_type: "CREATE_BILL" }));
    expect(createBillOutbox?.idempotency_key).toBe(`create-bill:${dbState.scope.tenant_id}:${dbState.scope.store_id}:${dbState.scope.device_id}:${bill.id}`);
    expect((createBillOutbox?.payload as Record<string, unknown>).localBillId).toBe(bill.id);
    expect(localPayments).toEqual([
      expect.objectContaining({
        local_payment_id: storedPayment.id,
        localPaymentId: storedPayment.id,
        client_payment_id: storedPayment.id,
        clientPaymentId: storedPayment.id,
        idempotency_key: `bill-payment:${bill.id}:${storedPayment.id}`,
        bill_id: bill.id,
        local_bill_id: bill.id,
        customer_id: "server_customer_1",
        mode: BillPaymentMode.cash,
        amount: 100,
      }),
    ]);
  });


  it("CREATE_BILL push payload sends credit as udhar, not as a paid payment", async () => {
    const bill = await createCreditBillForSync();
    const createBillOutbox = scopedRows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL");
    expect(createBillOutbox).toBeDefined();
    markNonBillCreateOutboxAsSynced();
    mockedSyncPush.mockResolvedValueOnce({ results: [createServerSuccessResult(createBillOutbox!, bill.id)] });

    await pushPendingOutboxOperations();

    const request = mockedSyncPush.mock.calls[0][0] as { operations: Array<{ payload: Record<string, unknown> }> };
    const payload = request.operations[0].payload;
    // Payments now carry the durable clientPaymentId so the server can store + echo it,
    // enabling identity-based echo reconciliation (no fuzzy same-amount collapse).
    expect(payload.payments).toEqual([expect.objectContaining({ mode: BillPaymentMode.cash, amount: 40 })]);
    expect((payload.payments as Array<Record<string, unknown>>)[0].clientPaymentId).toEqual(expect.any(String));
    expect(payload.paymentBreakdown).toEqual([expect.objectContaining({ mode: BillPaymentMode.cash, amount: 40 })]);
    expect(payload.paidAmount).toBe(40);
    expect(payload.buyerPaidAmount).toBe(40);
    expect(payload.creditAmount).toBe(60);
    expect(payload.dueAmount).toBe(60);
    expect(payload.ledgerEntries).toEqual([expect.objectContaining({
      amount: 60,
      type: "BILL",
      source_type: "bill",
      local_bill_id: bill.id,
    })]);
    expect(payload.customerLedgerEntries).toHaveLength(1);
    expect(payload.udharLedgerEntries).toHaveLength(1);
  });

  it("does not let a bad backend echo auto-pay offline udhar during reconciliation", async () => {
    const bill = await createCreditBillForSync();
    const createBillOutbox = scopedRows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL");
    expect(createBillOutbox).toBeDefined();

    const reconciled = await reconcileSyncedBillFromPush(createBillOutbox as never, createServerAutoPaidBadResult(createBillOutbox!, bill.id) as never);

    expect(reconciled).toBe(true);
    const syncedBill = activeRows("bills").find((row) => row.id === "server_bill_auto_paid_bad");
    expect(syncedBill).toEqual(expect.objectContaining({ paidAmount: 40, buyerPaidAmount: 40, creditAmount: 60 }));
    expect(activeRows("payments")).toEqual([expect.objectContaining({ amount: 40, mode: BillPaymentMode.cash, bill_id: "server_bill_auto_paid_bad" })]);
    expect(activeRows("customer_ledger")).toEqual([expect.objectContaining({ amount: 60, bill_id: "server_bill_auto_paid_bad" })]);
  });

  it("server success maps local_id to server_id and updates bill children to server bill id", async () => {
    const bill = await createCreditBillForSync();
    const createBillOutbox = scopedRows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL");
    expect(createBillOutbox).toBeDefined();

    const reconciled = await reconcileSyncedBillFromPush(createBillOutbox as never, createServerSuccessResult(createBillOutbox!, bill.id) as never);

    expect(reconciled).toBe(true);
    expect(scopedRows("id_mappings")).toContainEqual(expect.objectContaining({ entity_type: "bill", local_id: bill.id, server_id: "server_bill_1" }));
    expect(scopedRows("bills")).toContainEqual(expect.objectContaining({ id: "server_bill_1", local_id: bill.id, server_id: "server_bill_1", sync_status: "synced", status: "completed" }));
    expect(scopedRows("bills")).toContainEqual(expect.objectContaining({ id: bill.id, merged_into_id: "server_bill_1", deleted_at: expect.any(String) }));
    expect(activeRows("bill_items")).toEqual([expect.objectContaining({ id: "server_bill_item_1", local_id: expect.stringMatching(/^bill_item_/), server_id: "server_bill_item_1", bill_id: "server_bill_1", billId: "server_bill_1", sync_status: "synced" })]);
    expect(activeRows("payments")).toEqual([expect.objectContaining({ id: "server_payment_1", local_id: expect.stringMatching(/^payment_/), server_id: "server_payment_1", bill_id: "server_bill_1", billId: "server_bill_1", sync_status: "synced" })]);
    expect(activeRows("customer_ledger")).toEqual([expect.objectContaining({ id: "server_ledger_1", local_id: expect.stringMatching(/^ledger_/), server_id: "server_ledger_1", bill_id: "server_bill_1", billId: "server_bill_1", sync_status: "synced" })]);
    expect(activeRows("inventory_movements")).toEqual([expect.objectContaining({ bill_id: "server_bill_1", billId: "server_bill_1", reference_id: "server_bill_1", sync_status: "synced" })]);
  });

  it("push success turns local pending bill into synced server bill without duplicate bill history or duplicate payment", async () => {
    const bill = await createCreditBillForSync();
    const createBillOutbox = scopedRows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL");
    expect(createBillOutbox).toBeDefined();
    markNonBillCreateOutboxAsSynced();
    mockedSyncPush.mockResolvedValueOnce({ results: [createServerSuccessResult(createBillOutbox!, bill.id)] });

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ pushed: 1, failed: 0, skipped: 0 }));
    expect(mockedSyncPush).toHaveBeenCalledTimes(1);
    expect(scopedRows("sync_outbox").find((row) => row.clientEventId === createBillOutbox?.clientEventId)).toEqual(expect.objectContaining({ status: "SYNCED", sync_status: "synced" }));

    const billHistory = dedupeBillsForDisplay(scopedRows("bills"));
    const paymentHistory = dedupePaymentsForDisplay(scopedRows("payments"));
    expect(billHistory).toHaveLength(1);
    expect(billHistory[0]).toEqual(expect.objectContaining({ id: "server_bill_1", local_id: bill.id, sync_status: "synced" }));
    expect(paymentHistory).toHaveLength(1);
    expect(paymentHistory[0]).toEqual(expect.objectContaining({ id: "server_payment_1", bill_id: "server_bill_1", sync_status: "synced" }));
  });

  it("failed sync preserves the local bill, related records, and retryable outbox operation", async () => {
    const bill = await createBillLocalFirst(billInput());
    const createBillOutbox = scopedRows("sync_outbox").find((row) => row.operation_type === "CREATE_BILL");
    expect(createBillOutbox).toBeDefined();
    markNonBillCreateOutboxAsSynced();
    mockedSyncPush.mockRejectedValueOnce(new Error("backend offline"));

    const result = await pushPendingOutboxOperations();

    expect(result).toEqual(expect.objectContaining({ pushed: 0, failed: 1, skipped: 0 }));
    expect(scopedRows("bills")).toContainEqual(expect.objectContaining({ id: bill.id, local_id: bill.id, sync_status: "failed", deleted_at: null, isSynced: false }));
    expect(activeRows("bill_items")).toEqual([expect.objectContaining({ bill_id: bill.id })]);
    expect(activeRows("payments")).toEqual([expect.objectContaining({ bill_id: bill.id })]);
    expect(activeRows("inventory_movements")).toEqual([expect.objectContaining({ billId: bill.id, reference_id: bill.id })]);
    expect(scopedRows("sync_outbox")).toContainEqual(expect.objectContaining({ clientEventId: createBillOutbox?.clientEventId, operation_type: "CREATE_BILL", status: "FAILED", sync_status: "failed", retry_count: 1, entity_id: bill.id }));
    expect(scopedRows("sync_outbox").find((row) => row.clientEventId === createBillOutbox?.clientEventId)?.payload).toEqual(expect.objectContaining({ localBillId: bill.id }));
  });

  it("hardens older failed local bill rows after their server echo arrives from pull", async () => {
    dbState.putInto("bills", {
      id: "bill_local_first",
      local_id: "bill_local_first",
      billNo: "PENDING-FIRST",
      customerName: "Ramesh",
      grandTotal: 450,
      paidAmount: 450,
      creditAmount: 0,
      createdAt: "2026-06-07T09:00:00.000Z",
      updatedAt: "2026-06-07T09:00:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "failed",
      status: "pending_sync",
      deleted_at: null,
    });
    dbState.putInto("bills", {
      id: "server_bill_first",
      billNo: "KOS-2026-000101",
      customerName: "Ramesh",
      grandTotal: 450,
      paidAmount: 450,
      creditAmount: 0,
      createdAt: "2026-06-07T09:44:00.000Z",
      updatedAt: "2026-06-07T09:44:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "synced",
      status: "completed",
      deleted_at: null,
    });
    dbState.putInto("sync_outbox", {
      op_id: "op_bill_local_first",
      clientEventId: "op_bill_local_first",
      idempotency_key: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_local_first",
      entity_id: "bill_local_first",
      entity_type: "bill",
      operation_type: "CREATE_BILL",
      type: "CREATE_BILL",
      payload: { localBillId: "bill_local_first", customerName: "Ramesh", grandTotal: 450 },
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      client_created_at: "2026-06-07T09:00:00.000Z",
      createdAt: 1,
      retry_count: 1,
      attempts: 1,
      status: "FAILED",
      sync_status: "failed",
      next_retry_at: null,
    });

    const result = await hardenLocalFinancialData();

    expect(result.billsMerged).toBe(1);
    expect(activeRows("bills")).toEqual([
      expect.objectContaining({
        id: "server_bill_first",
        local_id: "bill_local_first",
        localBillId: "bill_local_first",
        sync_status: "synced",
      }),
    ]);
    expect(scopedRows("bills")).toContainEqual(
      expect.objectContaining({
        id: "bill_local_first",
        merged_into_id: "server_bill_first",
        deleted_at: expect.any(String),
        sync_status: "synced",
      }),
    );
    expect(scopedRows("id_mappings")).toContainEqual(
      expect.objectContaining({
        entity_type: "bill",
        local_id: "bill_local_first",
        server_id: "server_bill_first",
      }),
    );
  });

  it("pulled server bill merges (never conflicts) when client identity matches even if money and timestamp differ", async () => {
    // Local pending bill: offline udhar split (paid 40 / credit 60), created earlier.
    dbState.putInto("bills", {
      id: "bill_local_echo",
      local_id: "bill_local_echo",
      clientBillId: "bill_local_echo",
      client_bill_id: "bill_local_echo",
      localBillId: "bill_local_echo",
      idempotencyKey: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_local_echo",
      idempotency_key: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_local_echo",
      billNo: "PENDING-ECHO",
      customerName: "Ramesh",
      grandTotal: 100,
      paidAmount: 40,
      creditAmount: 60,
      createdAt: "2026-06-07T09:00:00.000Z",
      updatedAt: "2026-06-07T09:00:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "pending_sync",
      status: "pending_sync",
      isSynced: false,
      is_synced: false,
      deleted_at: null,
    });

    // Server echo of the SAME bill (same client identity) but the server-authoritative
    // money differs (paid 100 / credit 0) and the timestamp is in a different bucket,
    // so the fuzzy content heuristic would NOT recognise it — only the durable client
    // identity proves they are one bill.
    const change = {
      entity_type: "bill",
      entity_id: "server_bill_echo",
      entity: {
        id: "server_bill_echo",
        server_id: "server_bill_echo",
        clientBillId: "bill_local_echo",
        client_bill_id: "bill_local_echo",
        localBillId: "bill_local_echo",
        idempotencyKey: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_local_echo",
        idempotency_key: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_local_echo",
        billNo: "KOS-2026-000202",
        customerName: "Ramesh",
        grandTotal: 100,
        paidAmount: 100,
        creditAmount: 0,
        createdAt: "2026-06-07T09:42:00.000Z",
        updatedAt: "2026-06-07T09:42:00.000Z",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
        device_id: dbState.scope.device_id,
        sync_status: "synced",
        status: "completed",
        isSynced: true,
        is_synced: true,
        deleted_at: null,
      },
    };

    const status = await mergeServerChange(change as never);

    expect(status).toBe("merged");
    expect(scopedRows("sync_conflicts")).toHaveLength(0);
    expect(scopedRows("id_mappings")).toContainEqual(
      expect.objectContaining({ entity_type: "bill", local_id: "bill_local_echo", server_id: "server_bill_echo" }),
    );
    // Exactly one bill survives for display, and it is the synced server copy.
    const billHistory = dedupeBillsForDisplay(scopedRows("bills"));
    expect(billHistory).toHaveLength(1);
    expect(billHistory[0]).toEqual(expect.objectContaining({ id: "server_bill_echo", sync_status: "synced" }));
  });

  it("pulling a synced udhar ledger replaces the optimistic row when customer and bill IDs were remapped", async () => {
    dbState.putInto("id_mappings", {
      local_id: "local_customer_echo",
      server_id: "server_customer_echo",
      entity_type: "customer",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
    });
    dbState.putInto("id_mappings", {
      local_id: "local_bill_echo",
      server_id: "server_bill_echo",
      entity_type: "bill",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
    });
    dbState.putInto("customer_ledger", {
      id: "ledger_local_bill_echo_credit",
      customer_id: "local_customer_echo",
      customerId: "local_customer_echo",
      type: "BILL",
      source_type: "bill",
      source_id: "local_bill_echo",
      bill_id: "local_bill_echo",
      amount: 200,
      entry_at: "2026-06-20T10:00:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "synced",
      deleted_at: null,
    });

    const status = await mergeServerChange({
      entity_type: "udhar_ledger",
      entity_id: "server_ledger_echo",
      entity: {
        id: "server_ledger_echo",
        server_id: "server_ledger_echo",
        customer_id: "server_customer_echo",
        customerId: "server_customer_echo",
        type: "debit",
        source_type: "bill",
        source_id: "server_bill_echo",
        bill_id: "server_bill_echo",
        amount: 200,
        entry_at: "2026-06-20T10:04:00.000Z",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
        sync_status: "synced",
        deleted_at: null,
      },
    } as never);

    expect(status).toBe("merged");
    expect(activeRows("customer_ledger")).toEqual([
      expect.objectContaining({
        id: "server_ledger_echo",
        local_id: "ledger_local_bill_echo_credit",
        server_id: "server_ledger_echo",
        amount: 200,
      }),
    ]);
    expect(scopedRows("customer_ledger")).toContainEqual(
      expect.objectContaining({
        id: "ledger_local_bill_echo_credit",
        merged_into_id: "server_ledger_echo",
        deleted_at: expect.any(String),
      }),
    );
  });

  it("repairs an already-stored mapped local/server udhar bill echo to one balance effect", async () => {
    dbState.putInto("id_mappings", {
      local_id: "local_customer_old",
      server_id: "server_customer_old",
      entity_type: "customer",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
    });
    dbState.putInto("id_mappings", {
      local_id: "local_bill_old",
      server_id: "server_bill_old",
      entity_type: "bill",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
    });
    dbState.putInto("customer_ledger", {
      id: "ledger_local_bill_old_credit",
      customer_id: "local_customer_old",
      type: "BILL",
      source_type: "bill",
      source_id: "local_bill_old",
      bill_id: "local_bill_old",
      amount: 200,
      entry_at: "2026-06-20T10:00:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "synced",
      deleted_at: null,
    });
    dbState.putInto("customer_ledger", {
      id: "server_ledger_old",
      server_id: "server_ledger_old",
      customer_id: "server_customer_old",
      type: "debit",
      source_type: "bill",
      source_id: "server_bill_old",
      bill_id: "server_bill_old",
      amount: 200,
      entry_at: "2026-06-20T10:04:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "synced",
      deleted_at: null,
    });

    const result = await hardenLocalFinancialData();

    expect(result.ledgerMerged).toBeGreaterThanOrEqual(1);
    expect(activeRows("customer_ledger")).toEqual([
      expect.objectContaining({ id: "server_ledger_old", amount: 200 }),
    ]);
  });

  it("does not merge two distinct payments that share amount/mode/time but differ by clientPaymentId", async () => {
    // Two separate ₹50 cash sales seconds apart. They look identical to the fuzzy echo key,
    // but each carries its own durable clientPaymentId, so the merge guard must keep BOTH.
    dbState.putInto("payments", {
      id: "server_pay_A",
      server_id: "server_pay_A",
      bill_id: "server_bill_A",
      customer_id: null,
      mode: "cash",
      amount: 50,
      clientPaymentId: "payment_A",
      paid_at: "2026-06-21T10:00:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "synced",
      deleted_at: null,
    });
    dbState.putInto("payments", {
      id: "payment_B",
      local_payment_id: "payment_B",
      bill_id: "PENDING-BBB",
      customer_id: null,
      mode: "cash",
      amount: 50,
      clientPaymentId: "payment_B",
      paid_at: "2026-06-21T10:02:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      sync_status: "pending_sync",
      deleted_at: null,
    });

    await hardenLocalFinancialData();

    const active = activeRows("payments");
    expect(active).toHaveLength(2);
    expect(active.map((row) => row.clientPaymentId).sort()).toEqual(["payment_A", "payment_B"]);
  });

  it("product created offline merges with its synced server echo instead of conflicting", async () => {
    // Unsynced LOCAL create (no server_id). Its synced server copy arrives via pull, matched
    // back by clientProductId. Must merge, not raise a false conflict.
    dbState.putInto("products", {
      id: "local_prod_echo",
      local_id: "local_prod_echo",
      clientProductId: "local_prod_echo",
      name: "Sugar 1kg",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "pending_sync",
      deleted_at: null,
    });

    const status = await mergeServerChange({
      entity_type: "product",
      entity_id: "server_prod_echo",
      entity: {
        id: "server_prod_echo",
        clientProductId: "local_prod_echo",
        name: "Sugar 1kg",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
        sync_status: "synced",
        deleted_at: null,
      },
    } as never);

    expect(status).toBe("merged");
    expect(scopedRows("sync_conflicts")).toHaveLength(0);
  });

  it("offline edit of an already-synced row still raises a conflict (safety)", async () => {
    // This row was synced before (it has a server_id) and then edited offline. A divergent
    // server change must still conflict — the create-echo rule must NOT swallow real edits.
    dbState.putInto("products", {
      id: "server_prod_edit",
      server_id: "server_prod_edit",
      local_id: "local_prod_orig",
      clientProductId: "local_prod_orig",
      name: "Locally edited name",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "pending_sync",
      deleted_at: null,
    });

    const status = await mergeServerChange({
      entity_type: "product",
      entity_id: "server_prod_edit",
      entity: {
        id: "server_prod_edit",
        clientProductId: "local_prod_orig",
        name: "Server-side name",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
        sync_status: "synced",
        deleted_at: null,
      },
    } as never);

    expect(status).toBe("conflict");
    expect(scopedRows("sync_conflicts").length).toBeGreaterThan(0);
  });

  it("a locally FAILED offline bill merges with its pulled server twin by clientBillId — counted once, even hours apart", async () => {
    // Lost-ack case: the backend saved the bill but the local row is stuck "failed".
    // On the next pull the server twin carries the REAL durable identity columns
    // (clientBillId/idempotencyKey) that pullSince now returns on every bill, so the
    // match is by identity alone. The sale time (09:00) and the server sync time
    // (14:30 — a *different* content/time bucket) differ by hours and must not matter.
    // The server twin intentionally has NO localBillId: the backend no longer sends
    // that reconstructed field, so the collapse must work off clientBillId alone.
    dbState.putInto("bills", {
      id: "bill_failed_echo",
      local_id: "bill_failed_echo",
      clientBillId: "bill_failed_echo",
      client_bill_id: "bill_failed_echo",
      idempotencyKey: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_failed_echo",
      idempotency_key: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_failed_echo",
      billNo: "PENDING-FAILED",
      customerName: "Ramesh",
      grandTotal: 100,
      paidAmount: 100,
      creditAmount: 0,
      createdAt: "2026-06-07T09:00:00.000Z",
      updatedAt: "2026-06-07T09:00:00.000Z",
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      sync_status: "failed",
      status: "pending_sync",
      isSynced: false,
      is_synced: false,
      deleted_at: null,
    });

    const change = {
      entity_type: "bill",
      entity_id: "server_bill_failed",
      entity: {
        id: "server_bill_failed",
        server_id: "server_bill_failed",
        clientBillId: "bill_failed_echo",
        idempotencyKey: "create-bill:tenant_sync_test:store_sync_test:device_sync_test:bill_failed_echo",
        billNo: "KOS-2026-000303",
        customerName: "Ramesh",
        grandTotal: 100,
        paidAmount: 100,
        creditAmount: 0,
        createdAt: "2026-06-07T14:30:00.000Z",
        updatedAt: "2026-06-07T14:30:00.000Z",
        tenant_id: dbState.scope.tenant_id,
        store_id: dbState.scope.store_id,
        device_id: dbState.scope.device_id,
        sync_status: "synced",
        status: "completed",
        isSynced: true,
        is_synced: true,
        deleted_at: null,
      },
    };

    const status = await mergeServerChange(change as never);

    expect(status).toBe("merged");
    expect(scopedRows("sync_conflicts")).toHaveLength(0);
    const billHistory = dedupeBillsForDisplay(scopedRows("bills"));
    expect(billHistory).toHaveLength(1);
    expect(billHistory[0]).toEqual(expect.objectContaining({ id: "server_bill_failed", sync_status: "synced" }));
  });

  it("two distinct sales with identical content but different clientBillIds are both kept (heuristic is legacy-only)", async () => {
    // The same customer buys the same item twice inside one five-minute content
    // bucket: two REAL sales with two distinct client ids. Now that each carries a
    // durable identity, the content/time heuristic must NOT fold the pending one
    // into the synced one — that would silently drop a sale from the dashboard.
    const base = {
      customerId: "server_customer_1",
      customerName: "Ramesh",
      grandTotal: 100,
      items: [{ name: "Sugar", quantity: 2, ratePerRateUnit: 50 }],
      tenant_id: dbState.scope.tenant_id,
      store_id: dbState.scope.store_id,
      device_id: dbState.scope.device_id,
      deleted_at: null,
    };
    dbState.putInto("bills", {
      ...base,
      id: "server_sale_one",
      server_id: "server_sale_one",
      clientBillId: "cb_sale_one",
      billNo: "KOS-SALE-1",
      createdAt: "2026-06-07T09:00:00.000Z",
      updatedAt: "2026-06-07T09:00:30.000Z",
      sync_status: "synced",
      status: "completed",
      isSynced: true,
      is_synced: true,
    });
    dbState.putInto("bills", {
      ...base,
      id: "cb_sale_two",
      local_id: "cb_sale_two",
      clientBillId: "cb_sale_two",
      billNo: "PENDING-SALE-2",
      createdAt: "2026-06-07T09:02:00.000Z",
      updatedAt: "2026-06-07T09:02:00.000Z",
      sync_status: "pending_sync",
      status: "pending_sync",
      isSynced: false,
      is_synced: false,
    });

    const billHistory = dedupeBillsForDisplay(scopedRows("bills"));
    // Both survive: identity is the only collapse key for bills that carry one.
    expect(billHistory).toHaveLength(2);
    expect(billHistory.map((b) => (b as Record<string, unknown>).clientBillId).sort()).toEqual(["cb_sale_one", "cb_sale_two"]);
  });
});
