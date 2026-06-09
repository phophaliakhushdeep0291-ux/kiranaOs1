import { beforeEach, describe, expect, it, vi } from "vitest";

const supplierRow = {
  id: "supplier_1",
  local_id: "supplier_1",
  server_id: "server_supplier_1",
  name: "Wholesale Mart",
  mobile: "9876543210",
  createdAt: "2026-06-05T09:00:00.000Z",
  updatedAt: "2026-06-05T09:00:00.000Z",
  sync_status: "synced",
};

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_test_1`),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
}));

vi.mock("@/features/audit-logs/local-actions", () => ({
  writeAuditLog: vi.fn(async () => ({ id: "audit_1" })),
}));

vi.mock("@/features/sync/outbox", () => ({
  enqueueOutboxOperation: vi.fn(async () => undefined),
}));

import { offlineDB } from "@/lib/offline/db";
import { removeCachedListItem } from "@/lib/offline/instant-cache";
import { enqueueOutboxOperation } from "@/features/sync/outbox";
import { writeAuditLog } from "@/features/audit-logs/local-actions";
import { deleteSupplierLocalFirst } from "@/features/suppliers/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedRemoveCachedListItem = vi.mocked(removeCachedListItem);
const mockedEnqueueOutboxOperation = vi.mocked(enqueueOutboxOperation);
const mockedWriteAuditLog = vi.mocked(writeAuditLog);

describe("supplier delete safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedOfflineDB.getAll.mockResolvedValue([{ ...supplierRow }]);
    mockedOfflineDB.put.mockResolvedValue(undefined);
  });

  it("blocks supplier delete before local writes when owner PIN is missing", async () => {
    await expect(deleteSupplierLocalFirst({ id: "supplier_1", ownerPin: "", reason: "Duplicate supplier" })).rejects.toThrow(/Owner PIN/i);

    expect(mockedOfflineDB.getAll).not.toHaveBeenCalled();
    expect(mockedOfflineDB.put).not.toHaveBeenCalled();
    expect(mockedWriteAuditLog).not.toHaveBeenCalled();
    expect(mockedEnqueueOutboxOperation).not.toHaveBeenCalled();
  });

  it("soft deletes supplier with owner PIN, audit, cache removal, and outbox", async () => {
    const result = await deleteSupplierLocalFirst({ id: "supplier_1", ownerPin: "1234", reason: "Duplicate supplier" });

    expect(result).toEqual({ success: true, pendingSync: true });
    expect(mockedOfflineDB.put).toHaveBeenCalledWith("suppliers", expect.objectContaining({
      id: "supplier_1",
      deletedAt: expect.any(String),
      deleted_at: expect.any(String),
      sync_status: "pending_sync",
    }));
    expect(mockedRemoveCachedListItem).toHaveBeenCalledWith("suppliers", "supplier_1");
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "supplier_deleted",
      entityType: "supplier",
      entityId: "supplier_1",
      reason: "Duplicate supplier",
      ownerPinProvided: true,
    }));
    expect(mockedEnqueueOutboxOperation).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: "supplier",
      entity_id: "supplier_1",
      operation_type: "DELETE_SUPPLIER_PENDING",
      payload: expect.objectContaining({
        supplierId: "supplier_1",
        ownerPin: "1234",
        reason: "Duplicate supplier",
        ownerPinProvided: true,
      }),
    }));
  });
});
