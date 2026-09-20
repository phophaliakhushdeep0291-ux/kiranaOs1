import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 560-product starter catalog, pushed while the server was slow enough that
 * the batch's verdict never got back to the device.
 *
 * The server had already created those products, so their rows arrived later
 * through the pull feed under server ids. The client-side echoes stayed behind:
 * `product_<uuid>`, still "pending_sync", with no outbox row left to resolve
 * them. 200 of 560 products were left with two local rows each — and the next
 * server edit to any of them raised a conflict card for a decision the owner
 * never made.
 */

const state = vi.hoisted(() => ({
  tenantId: "tenant_A",
  storeId: "store_A",
  rows: {} as Record<string, Record<string, unknown>[]>,
}));

function scoped<T>(rows: T[]): T[] {
  return rows.filter((row) => {
    const record = row as Record<string, unknown>;
    return record.tenant_id === state.tenantId && record.store_id === state.storeId;
  });
}

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: vi.fn(() => ({
    tenant_id: state.tenantId,
    store_id: state.storeId,
    device_id: "device_A",
  })),
  nowIso: vi.fn(() => "2026-09-18T09:00:00.000Z"),
}));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: { open: vi.fn(async () => undefined) },
  offlineDB: {
    init: vi.fn(async () => undefined),
    getAll: vi.fn(async (table: string) => state.rows[table] ?? []),
  },
  filterRowsForCurrentScope: vi.fn(scoped),
  rowMatchesCurrentScope: vi.fn((row: unknown) => scoped([row]).length === 1),
  MAX_AUTOMATIC_RETRY_ATTEMPTS: 12,
}));

const replaceLocalEntityId = vi.hoisted(() => vi.fn(async () => undefined));
const replaceReferencesMany = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/features/core/sync/sync-id-mapping", () => ({
  replaceLocalEntityId,
  replaceReferencesMany,
}));

const { collapseSupersededLocalEchoes } = await import(
  "@/features/core/sync/sync-status-repair"
);

const scope = { tenant_id: "tenant_A", store_id: "store_A" };

function mapping(localId: string, serverId: string, entityType = "product") {
  return { local_id: localId, server_id: serverId, entity_type: entityType, ...scope };
}

beforeEach(() => {
  replaceLocalEntityId.mockClear();
  replaceReferencesMany.mockClear();
  state.rows = {};
});

describe("a local echo the server has already accepted", () => {
  it("is collapsed into the server row once nothing is queued for it", async () => {
    state.rows.id_mappings = [mapping("product_local", "srv_1")];
    state.rows.sync_outbox = [];
    state.rows.products = [
      { id: "product_local", name: "Parle-G 100g", sync_status: "pending_sync", ...scope },
      { id: "srv_1", name: "Parle-G 100g", sync_status: "synced", server_id: "srv_1", ...scope },
    ];

    expect(await collapseSupersededLocalEchoes()).toBe(1);
    expect(replaceLocalEntityId).toHaveBeenCalledWith(
      "product",
      "product_local",
      "srv_1",
      undefined,
      expect.any(Map),
    );
  });

  it("is left alone while its operation is still in the queue", async () => {
    // The push verdict owns the merge. Racing it here could delete the row a
    // pending operation is about to be answered for.
    state.rows.id_mappings = [mapping("product_local", "srv_1")];
    state.rows.sync_outbox = [
      { entity_id: "product_local", status: "PENDING", sync_status: "pending_sync", ...scope },
    ];
    state.rows.products = [
      { id: "product_local", name: "Parle-G 100g", sync_status: "pending_sync", ...scope },
      { id: "srv_1", name: "Parle-G 100g", sync_status: "synced", server_id: "srv_1", ...scope },
    ];

    expect(await collapseSupersededLocalEchoes()).toBe(0);
    expect(replaceLocalEntityId).not.toHaveBeenCalled();
  });

  it("is left alone while the server copy has not reached this device", async () => {
    // Without the server row the echo is still the only record of that product
    // here, and collapsing it would delete the shop's data.
    state.rows.id_mappings = [mapping("product_local", "srv_1")];
    state.rows.sync_outbox = [];
    state.rows.products = [
      { id: "product_local", name: "Parle-G 100g", sync_status: "pending_sync", ...scope },
    ];

    expect(await collapseSupersededLocalEchoes()).toBe(0);
    expect(replaceLocalEntityId).not.toHaveBeenCalled();
  });

  it("leaves a genuine offline edit of an already-synced row to the conflict path", async () => {
    // An edit made offline keeps its server_id. That row is not an echo: the
    // server has not seen the change, and it must still be pushed.
    state.rows.id_mappings = [mapping("product_local", "srv_1")];
    state.rows.sync_outbox = [];
    state.rows.products = [
      {
        id: "product_local",
        name: "Parle-G 100g",
        sync_status: "pending_sync",
        server_id: "srv_1",
        ...scope,
      },
      { id: "srv_1", name: "Parle-G 100g", sync_status: "synced", server_id: "srv_1", ...scope },
    ];

    expect(await collapseSupersededLocalEchoes()).toBe(0);
    expect(replaceLocalEntityId).not.toHaveBeenCalled();
  });

  it("never touches another tenant's rows", async () => {
    state.rows.id_mappings = [
      { local_id: "product_other", server_id: "srv_9", entity_type: "product", tenant_id: "tenant_B", store_id: "store_B" },
    ];
    state.rows.sync_outbox = [];
    state.rows.products = [
      { id: "product_other", sync_status: "pending_sync", tenant_id: "tenant_B", store_id: "store_B" },
      { id: "srv_9", sync_status: "synced", server_id: "srv_9", tenant_id: "tenant_B", store_id: "store_B" },
    ];

    expect(await collapseSupersededLocalEchoes()).toBe(0);
    expect(replaceLocalEntityId).not.toHaveBeenCalled();
  });

  it("reads each table once, not once per mapping", async () => {
    // This runs on every sync cycle. A get() per mapping was 2n IndexedDB
    // transactions, which took over 45s for one catalog-sized shop.
    const { offlineDB } = await import("@/lib/offline/db");
    const reads = offlineDB.getAll as unknown as ReturnType<typeof vi.fn>;
    state.rows.id_mappings = Array.from({ length: 300 }, (_unused, index) =>
      mapping(`product_local_${index}`, `srv_${index}`),
    );
    state.rows.sync_outbox = [];
    state.rows.products = state.rows.id_mappings.flatMap((_row, index) => [
      { id: `product_local_${index}`, sync_status: "pending_sync", ...scope },
      { id: `srv_${index}`, sync_status: "synced", server_id: `srv_${index}`, ...scope },
    ]);

    reads.mockClear();
    expect(await collapseSupersededLocalEchoes()).toBe(300);
    expect(reads.mock.calls.filter((call) => call[0] === "products")).toHaveLength(1);
    // And one reference pass for the sweep, not one per echo: that walk covers
    // every offline table and took 4.3s for a single id on a catalog-sized shop.
    expect(replaceReferencesMany).toHaveBeenCalledTimes(1);
    expect(replaceLocalEntityId.mock.calls.every((call) => call[4] instanceof Map)).toBe(true);
  });
});
