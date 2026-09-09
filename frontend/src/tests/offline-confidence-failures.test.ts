import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), open: vi.fn(), readiness: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({
  dexieDB: { open: mocks.open },
  offlineDB: { getAll: mocks.getAll },
  filterRowsForCurrentScope: (rows: unknown[]) => rows,
}));
vi.mock("@/features/core/subscription/access", () => ({ getCurrentSubscriptionSnapshot: async () => ({ cloudSyncAllowed: true }) }));
vi.mock("@/features/core/sync/offline-readiness", () => ({ readOfflineReadiness: mocks.readiness }));
import { readOfflineConfidenceSnapshot } from "@/features/core/sync/offline-confidence";

beforeEach(() => {
  mocks.open.mockResolvedValue(undefined);
  mocks.getAll.mockResolvedValue([]);
  mocks.readiness.mockResolvedValue({ databaseAvailable: true, state: "ready", warnings: [], appShellCached: true, persistentStorageGranted: true, storageUsageRatio: 0.1 });
});
describe("offline confidence distinguishes unreadable from empty", () => {
  it.each(["sync_outbox", "sync_conflicts", "sync_cursor", "products", "customers", "bills", "payments", "customer_ledger", "inventory_movements"])("marks %s failure unverified and recovers", async (table) => {
    mocks.getAll.mockImplementation(async (name) => { if (name === table) throw Error("unreadable"); return []; });
    expect(await readOfflineConfidenceSnapshot()).toMatchObject({ dbHealthy: false, pendingSyncCount: null, failedSyncCount: null, conflictCount: null, localBusinessRows: null, lastCloudBackupAt: null, readinessState: "not_ready" });
    mocks.getAll.mockResolvedValue([]);
    expect(await readOfflineConfidenceSnapshot()).toMatchObject({ dbHealthy: true, pendingSyncCount: 0, failedSyncCount: 0, conflictCount: 0 });
  });
  it("fails closed when opening the DB fails", async () => {
    mocks.open.mockRejectedValue(Error("closed"));
    expect(await readOfflineConfidenceSnapshot()).toMatchObject({ dbHealthy: false, pendingSyncCount: null });
  });
  it("does not override a failed readiness database check", async () => {
    mocks.readiness.mockResolvedValue({ databaseAvailable: false, state: "not_ready", warnings: ["Local database is unavailable"] });
    expect(await readOfflineConfidenceSnapshot()).toMatchObject({ dbHealthy: false, pendingSyncCount: null });
  });
});
