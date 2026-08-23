import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenantId: "tenant_A",
  storeId: "store_A",
  deviceId: "device_A",
  getAllRows: {} as Record<string, unknown[]>,
  pendingEvents: [] as Array<Record<string, unknown>>,
}));

function scoped<T>(rows: T[]): T[] {
  return rows.filter((row) => {
    const record = row as Record<string, unknown>;
    return (
      record.tenant_id === state.tenantId && record.store_id === state.storeId
    );
  });
}

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: vi.fn(() => ({
    tenant_id: state.tenantId,
    store_id: state.storeId,
    device_id: state.deviceId,
  })),
  nowIso: vi.fn(() => "2026-06-06T09:00:00.000Z"),
}));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    open: vi.fn(async () => undefined),
    sync_cursor: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    },
  },
  offlineDB: {
    init: vi.fn(async () => undefined),
    getAll: vi.fn(async (table: string) => state.getAllRows[table] ?? []),
    getPendingEvents: vi.fn(async () => state.pendingEvents),
    updatePendingEventStatus: vi.fn(async () => undefined),
    getPendingCount: vi.fn(async () => scoped(state.pendingEvents).length),
  },
  filterRowsForCurrentScope: vi.fn(scoped),
  rowMatchesCurrentScope: vi.fn((row: unknown) => scoped([row]).length === 1),
}));

const syncPushMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, results: [] })),
);

vi.mock("@/features/core/sync/api", () => ({
  syncPush: syncPushMock,
  syncPull: vi.fn(async () => ({ changes: [] })),
  acknowledgeSyncSequence: vi.fn(async () => ({ acknowledgement: { accepted: true } })),
  getSyncStatus: vi.fn(async () => ({ allowed: true })),
  requestSyncRetry: vi.fn(async () => undefined),
}));

vi.mock("@/features/core/subscription/access", () => ({
  getCurrentSubscriptionSnapshot: vi.fn(async () => ({
    cloudSyncAllowed: true,
  })),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  emitLocalDataChanged: vi.fn(),
  writeInstantCache: vi.fn(),
  pruneRecentRows: vi.fn((rows: unknown[]) => rows),
}));

import { buildLocalReportSnapshot } from "@/features/core/reports/local-reporting";
import { pushPendingOutboxOperations } from "@/features/core/sync/engine";
import { offlineDB, filterRowsForCurrentScope } from "@/lib/offline/db";
import { syncPush } from "@/features/core/sync/api";

describe("tenant/store isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tenantId = "tenant_A";
    state.storeId = "store_A";
    state.deviceId = "device_A";
    state.getAllRows = {};
    state.pendingEvents = [];
  });

  it("filters tenant A data out of tenant B reads", () => {
    const rows = filterRowsForCurrentScope([
      { id: "current", tenant_id: "tenant_A", store_id: "store_A" },
      { id: "other_tenant", tenant_id: "tenant_B", store_id: "store_A" },
    ]);

    expect(rows).toEqual([
      { id: "current", tenant_id: "tenant_A", store_id: "store_A" },
    ]);
  });

  it("filters store A data out of store B reads", () => {
    const rows = filterRowsForCurrentScope([
      { id: "current", tenant_id: "tenant_A", store_id: "store_A" },
      { id: "other_store", tenant_id: "tenant_A", store_id: "store_B" },
    ]);

    expect(rows).toEqual([
      { id: "current", tenant_id: "tenant_A", store_id: "store_A" },
    ]);
  });

  it("sync push sends only current tenant/store outbox operations", async () => {
    state.pendingEvents = [
      {
        op_id: "op_current",
        clientEventId: "op_current",
        idempotency_key: "op_current",
        type: "UPDATE_PRODUCT",
        operation_type: "UPDATE_PRODUCT",
        entity_type: "product",
        entity_id: "product_1",
        tenant_id: "tenant_A",
        store_id: "store_A",
        device_id: "device_A",
        payload: { productId: "product_1" },
        client_created_at: "2026-06-06T09:00:00.000Z",
        status: "PENDING",
        sync_status: "pending_sync",
        retry_count: 0,
        createdAt: 1,
      },
      {
        op_id: "op_other_tenant",
        clientEventId: "op_other_tenant",
        idempotency_key: "op_other_tenant",
        type: "UPDATE_PRODUCT",
        operation_type: "UPDATE_PRODUCT",
        entity_type: "product",
        entity_id: "product_2",
        tenant_id: "tenant_B",
        store_id: "store_A",
        device_id: "device_B",
        payload: { productId: "product_2" },
        client_created_at: "2026-06-06T09:00:00.000Z",
        status: "PENDING",
        sync_status: "pending_sync",
        retry_count: 0,
        createdAt: 2,
      },
      {
        op_id: "op_other_store",
        clientEventId: "op_other_store",
        idempotency_key: "op_other_store",
        type: "UPDATE_PRODUCT",
        operation_type: "UPDATE_PRODUCT",
        entity_type: "product",
        entity_id: "product_3",
        tenant_id: "tenant_A",
        store_id: "store_B",
        device_id: "device_C",
        payload: { productId: "product_3" },
        client_created_at: "2026-06-06T09:00:00.000Z",
        status: "PENDING",
        sync_status: "pending_sync",
        retry_count: 0,
        createdAt: 3,
      },
    ];

    await pushPendingOutboxOperations();

    expect(syncPush).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(syncPushMock).mock.calls[0][0] as {
      operations: Array<Record<string, unknown>>;
    };
    expect(payload.operations).toHaveLength(1);
    expect(payload.operations[0]).toEqual(
      expect.objectContaining({
        op_id: "op_current",
        tenant_id: "tenant_A",
        store_id: "store_A",
      }),
    );
    expect(
      vi.mocked(offlineDB.updatePendingEventStatus),
    // Trailing arg is the optional `deferMs` bag used to hold a row back after a
    // transient failure without spending one of its twelve retry attempts.
    ).toHaveBeenNthCalledWith(1, ["op_current"], "SYNCING", undefined, undefined);
  });

  it("reports ignore other tenant/store data", async () => {
    state.getAllRows = {
      bills: [
        {
          id: "bill_current",
          tenant_id: "tenant_A",
          store_id: "store_A",
          billType: "normal_sale",
          status: "paid",
          grandTotal: 100,
          paidAmount: 100,
          discount: 5,
          createdAt: "2026-06-06T10:00:00.000Z",
        },
        {
          id: "bill_other_tenant",
          tenant_id: "tenant_B",
          store_id: "store_A",
          billType: "normal_sale",
          status: "paid",
          grandTotal: 900,
          paidAmount: 900,
          createdAt: "2026-06-06T10:00:00.000Z",
        },
        {
          id: "bill_other_store",
          tenant_id: "tenant_A",
          store_id: "store_B",
          billType: "normal_sale",
          status: "paid",
          grandTotal: 700,
          paidAmount: 700,
          createdAt: "2026-06-06T10:00:00.000Z",
        },
      ],
      bill_items: [],
      payments: [
        {
          id: "pay_current",
          tenant_id: "tenant_A",
          store_id: "store_A",
          bill_id: "bill_current",
          mode: "cash",
          amount: 100,
          paid_at: "2026-06-06T10:00:00.000Z",
        },
        {
          id: "pay_other",
          tenant_id: "tenant_B",
          store_id: "store_A",
          bill_id: "bill_other_tenant",
          mode: "cash",
          amount: 900,
          paid_at: "2026-06-06T10:00:00.000Z",
        },
      ],
      customer_ledger: [],
      products: [],
      customers: [],
      sync_outbox: [
        {
          id: "op_current",
          tenant_id: "tenant_A",
          store_id: "store_A",
          status: "PENDING",
          sync_status: "pending_sync",
        },
        {
          id: "op_other",
          tenant_id: "tenant_B",
          store_id: "store_A",
          status: "PENDING",
          sync_status: "pending_sync",
        },
      ],
    };

    const snapshot = await buildLocalReportSnapshot({
      from: "2026-06-06",
      to: "2026-06-06",
    });

    expect(snapshot.selected.sales).toBe(100);
    expect(snapshot.selected.bills).toBe(1);
    expect(snapshot.selected.discount).toBe(5);
    expect(snapshot.paymentBreakdown.cash).toBe(100);
    expect(snapshot.pendingSyncCount).toBe(1);
  });
});
