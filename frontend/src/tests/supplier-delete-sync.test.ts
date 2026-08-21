/**
 * Deleting a supplier has to reach the SERVER, not just this device.
 *
 * The till queues the op as `DELETE_SUPPLIER_PENDING`, but the backend switch only knows
 * `DELETE_SUPPLIER` (backend/src/utils/syncRules.js) and answers 400 "Unsupported sync event
 * type" to anything else. Unmapped names fall straight through `backendOperationTypeFor`, so
 * with no entry in BACKEND_OPERATION_TYPE_MAP the delete parked at CONFLICT for good: the shop
 * saw the supplier gone locally while the server still had it, and nothing surfaced.
 *
 * supplier-delete-safety.test.ts covers the local transaction, but it mocks
 * `buildOutboxOperation` away, so nothing there could ever have caught the wrong name. This
 * walks the real path instead — delete -> outbox -> buildBackendSyncOperation -> the exact id
 * chain applyDeleteSupplier runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  suppliers: [] as Array<Record<string, unknown>>,
  outbox: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/offline/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    offlineDB: {
      getAll: vi.fn(async (storeName: string) => (storeName === "suppliers" ? mockState.suppliers : [])),
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
  emitLocalDataChanged: vi.fn(),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  readInstantCache: vi.fn(() => []),
}));

import { deleteSupplierLocalFirst } from "@/features/core/suppliers/local-actions";
import { buildBackendSyncOperation } from "@/features/core/sync/sync-operation-normalizer";
import type { PendingSyncEvent } from "@/lib/offline/db";

/** Exactly how applyDeleteSupplier resolves the supplier it is asked to delete. */
const backendSupplierId = (payload: Record<string, unknown>) =>
  payload.serverSupplierId ?? payload.supplierId ?? payload.localSupplierId ?? payload.id;

async function deleteAndBuild(id: string) {
  await deleteSupplierLocalFirst({ id, ownerPin: "2468", reason: "Duplicate supplier" });
  const event = mockState.outbox.find((row) => row.operation_type === "DELETE_SUPPLIER_PENDING");
  expect(event, "DELETE_SUPPLIER_PENDING was never queued").toBeTruthy();
  return buildBackendSyncOperation(event as unknown as PendingSyncEvent, event!.payload);
}

describe("supplier delete reaches the server", () => {
  beforeEach(() => {
    mockState.outbox = [];
    mockState.suppliers = [{
      id: "supplier_1",
      local_id: "supplier_1",
      server_id: "server_supplier_1",
      name: "Wholesale Mart",
      sync_status: "synced",
    }];
  });

  it("is posted under the name the backend actually handles", async () => {
    const built = await deleteAndBuild("supplier_1");

    // "DELETE_SUPPLIER_PENDING" would 400 as an unsupported event type.
    expect(built?.type).toBe("DELETE_SUPPLIER");
    expect(built?.operation_type).toBe("DELETE_SUPPLIER");
  });

  it("names the supplier in a spelling the backend resolves", async () => {
    const built = await deleteAndBuild("supplier_1");

    expect(backendSupplierId(built!.payload)).toBe("supplier_1");
  });

  it("carries the owner approval the delete was gated on", async () => {
    const built = await deleteAndBuild("supplier_1");

    expect(built?.payload).toEqual(expect.objectContaining({
      ownerPin: "2468",
      ownerPinProvided: true,
      reason: "Duplicate supplier",
    }));
  });

  it("still names a supplier that has never synced", async () => {
    mockState.suppliers = [{ id: "supplier_local_1", local_id: "supplier_local_1", name: "New Mart", sync_status: "pending_sync" }];

    const built = await deleteAndBuild("supplier_local_1");

    expect(backendSupplierId(built!.payload)).toBe("supplier_local_1");
  });
});
