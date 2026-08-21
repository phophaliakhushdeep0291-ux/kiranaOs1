/**
 * Restoring from the recycle bin has to reach the SERVER, not just this device.
 *
 * The bin builds one outbox payload for all three entity types, so it named the record
 * generically — `entityId` / `localId` / `serverId`. Every restore backend looks for its
 * own spelling instead (`serverProductId ?? productId ?? localProductId ?? id`, and the
 * customer/supplier equivalents), so the id arrived `undefined` and the event 400'd with
 * "productId required for RESTORE_PRODUCT sync event". The op parked at CONFLICT, the bin
 * emptied and the row came back on the device that pressed Restore — while the server kept
 * it deleted, with nothing shown to the shop. Supplier restore also fell out of
 * BACKEND_OPERATION_TYPE_MAP, so it was posted under a name the backend has no case for.
 *
 * These assertions walk the real path — bin -> outbox -> buildBackendSyncOperation -> the
 * exact id chain each backend handler runs. The older recycle-bin test only checked the
 * envelope (operation_type / entity_id), which is why the empty payload went unnoticed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  outbox: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/offline/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    offlineDB: {
      getAll: vi.fn(async (storeName: string) => mockState.rows[storeName] ?? []),
      put: vi.fn(async () => undefined),
      transaction: vi.fn(async (_tables: string[], callback: (tx: {
        put: (storeName: string, value: unknown) => Promise<void>;
        enqueueOutboxOperation: (event: unknown) => Promise<void>;
      }) => Promise<unknown>) => callback({
        put: vi.fn(async () => undefined),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          mockState.outbox.push(event as Record<string, unknown>);
        }),
      })),
    },
  };
});

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_test`),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  readInstantCache: vi.fn(() => []),
}));

import { restoreEntityFromRecycleBinLocalFirst, type RecyclableEntityType } from "@/features/core/recycle-bin/local-actions";
import { buildBackendSyncOperation } from "@/features/core/sync/sync-operation-normalizer";
import type { PendingSyncEvent } from "@/lib/offline/db";

/** The id each backend handler actually resolves, spelled exactly as the handler spells it. */
const BACKEND_ID_CHAIN: Record<RecyclableEntityType, (payload: Record<string, unknown>) => unknown> = {
  product: (p) => p.serverProductId ?? p.productId ?? p.localProductId ?? p.id,
  customer: (p) => p.serverCustomerId ?? p.customerId ?? p.localCustomerId ?? p.id,
  supplier: (p) => p.serverSupplierId ?? p.supplierId ?? p.localSupplierId ?? p.id,
};

const CASES: Array<{
  type: RecyclableEntityType;
  table: string;
  backendType: string;
  pendingType: string;
}> = [
  { type: "product", table: "products", backendType: "RESTORE_PRODUCT", pendingType: "RESTORE_PRODUCT_PENDING" },
  { type: "customer", table: "customers", backendType: "RESTORE_CUSTOMER", pendingType: "RESTORE_CUSTOMER_PENDING" },
  { type: "supplier", table: "suppliers", backendType: "RESTORE_SUPPLIER", pendingType: "RESTORE_SUPPLIER_PENDING" },
];

async function restoreAndBuild(type: RecyclableEntityType, pendingType: string, id: string) {
  await restoreEntityFromRecycleBinLocalFirst(type, id, "2468", "Deleted by mistake");
  const event = mockState.outbox.find((row) => row.operation_type === pendingType);
  expect(event, `${pendingType} was never queued`).toBeTruthy();
  return buildBackendSyncOperation(event as unknown as PendingSyncEvent, event!.payload);
}

describe("recycle bin restore reaches the server", () => {
  beforeEach(() => {
    mockState.outbox = [];
    mockState.rows = {};
  });

  it.each(CASES)("$type restore carries an id the backend resolves", async ({ type, table, backendType, pendingType }) => {
    mockState.rows[table] = [{
      id: `server_${type}_1`,
      server_id: `server_${type}_1`,
      name: "Deleted record",
      deletedAt: "2026-08-21T10:00:00.000Z",
      deleted_at: "2026-08-21T10:00:00.000Z",
    }];

    const built = await restoreAndBuild(type, pendingType, `server_${type}_1`);

    // Posted under the name the backend's switch actually has a case for.
    expect(built?.type).toBe(backendType);
    expect(built?.operation_type).toBe(backendType);
    // ...and naming the record, or the handler throws "<x>Id required for <TYPE> sync event".
    expect(BACKEND_ID_CHAIN[type](built!.payload)).toBe(`server_${type}_1`);
  });

  it.each(CASES)("$type restore still names a record that never synced", async ({ type, table, pendingType }) => {
    // No server_id yet: the local id is all we have, and the backend maps it through
    // id_mappings — but only if we actually send it.
    mockState.rows[table] = [{
      id: `${type}_local_1`,
      local_id: `${type}_local_1`,
      name: "Never synced",
      deletedAt: "2026-08-21T10:00:00.000Z",
      deleted_at: "2026-08-21T10:00:00.000Z",
    }];

    const built = await restoreAndBuild(type, pendingType, `${type}_local_1`);

    expect(BACKEND_ID_CHAIN[type](built!.payload)).toBe(`${type}_local_1`);
  });

  it("keeps the owner PIN approval on the restore event", async () => {
    mockState.rows.products = [{
      id: "server_product_1",
      server_id: "server_product_1",
      name: "Deleted record",
      deletedAt: "2026-08-21T10:00:00.000Z",
      deleted_at: "2026-08-21T10:00:00.000Z",
    }];

    const built = await restoreAndBuild("product", "RESTORE_PRODUCT_PENDING", "server_product_1");

    expect(built?.payload).toEqual(expect.objectContaining({
      ownerPin: "2468",
      ownerPinProvided: true,
      reason: "Deleted by mistake",
    }));
  });
});
