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
    getAll: vi.fn(), put: vi.fn(), delete: vi.fn(),
    transaction: vi.fn(async (_tables: string[], callback: (tx: { put: ReturnType<typeof vi.fn>; enqueueOutboxOperation: ReturnType<typeof vi.fn> }) => Promise<void>) => callback({ put: vi.fn(async () => undefined), enqueueOutboxOperation: vi.fn(async () => undefined) })),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_test_1`),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
}));

vi.mock("@/features/audit-logs/local-actions", () => ({
  buildAuditLogRow: vi.fn((input: Record<string, unknown>) => ({ id: "audit_1", ...input })),
  buildAuditLogOutboxInput: vi.fn((row: Record<string, unknown>) => ({ entity_type: "audit_log", entity_id: row.id, operation_type: "AUDIT_LOG_APPEND", payload: { row } })),
}));

vi.mock("@/features/sync/outbox", () => ({
  buildOutboxOperation: vi.fn((input: Record<string, unknown>) => ({ clientEventId: `op_${String(input.entity_id)}`, ...input })),
}));

import { offlineDB } from "@/lib/offline/db";
import { removeCachedListItem } from "@/lib/offline/instant-cache";
import { deleteSupplierLocalFirst } from "@/features/suppliers/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedRemoveCachedListItem = vi.mocked(removeCachedListItem);

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
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
  });

  it("soft deletes supplier, audit, and outbox in one transaction", async () => {
    const result = await deleteSupplierLocalFirst({ id: "supplier_1", ownerPin: "1234", reason: "Duplicate supplier" });
    expect(result).toEqual({ success: true, pendingSync: true });
    expect(mockedOfflineDB.transaction).toHaveBeenCalledWith(["suppliers", "local_audit_logs", "sync_outbox"], expect.any(Function));
    expect(mockedRemoveCachedListItem).toHaveBeenCalledWith("suppliers", "supplier_1");
  });
});
