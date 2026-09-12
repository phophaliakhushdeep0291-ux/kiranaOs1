import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ counts: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { init: async () => undefined }, dexieDB: {}, rowMatchesCurrentScope: () => true }));
vi.mock("@/features/core/sync/api", () => ({ getSyncStatus: async () => ({ allowed: true }), requestSyncRetry: vi.fn() }));
vi.mock("@/features/core/sync/sync-pull", () => ({ pullServerChanges: async () => ({ pulled: 1, conflicts: 0, cursor: "next" }) }));
vi.mock("@/features/core/sync/sync-push", () => ({ drainPendingOutboxOperations: async () => ({ pushed: 1, failed: 0, conflicts: 0, skipped: 0 }), applyRecoveredSyncEventResult: vi.fn(), pushPendingOutboxOperations: vi.fn() }));
vi.mock("@/features/core/subscription/access", () => ({ getCurrentSubscriptionSnapshot: async () => ({ cloudSyncAllowed: true }) }));
vi.mock("@/features/core/sync/sync-status-repair", () => ({ readSyncQueueCounts: mocks.counts, repairResolvedSyncStatusNoise: async () => 0, repairRetryableBillValidationConflicts: async () => 0 }));
vi.mock("@/features/core/sync/backend-health", () => ({ probeBackendConnection: async () => ({ browserOnline: true, backendReachable: true }) }));
vi.mock("@/lib/api/http", () => ({ ApiClientError: class extends Error {}, getStoredAccessToken: () => "test", getStoredRefreshToken: () => "test" }));
vi.mock("@/lib/activity", () => ({ ACTIVITY_EVENTS: { SYNC_COMPLETED: "completed", SYNC_FAILED: "failed" }, trackEvent: mocks.track }));
vi.mock("@/features/core/remote-support/command-runner", () => ({ drainDeviceCommands: vi.fn() }));
vi.mock("@/features/core/sync/sync-conflict-cache", () => ({ refreshServerConflictCache: vi.fn() }));
vi.mock("@/lib/storage/auth-storage", () => ({ loadAuthSession: () => ({ user: { role: "staff" } }) }));
import { runSyncCycle } from "@/features/core/sync/sync-engine";

beforeEach(() => { vi.clearAllMocks(); mocks.counts.mockResolvedValue({ totalBlocking: 0 }); });
describe("sync activity requires readable durable queue evidence", () => {
  it("cannot report completion after network success if the queue read fails", async () => {
    mocks.counts.mockRejectedValue(Error("unreadable queue"));
    await expect(runSyncCycle()).rejects.toThrow("unreadable queue");
    expect(mocks.track).toHaveBeenCalledWith("failed", expect.objectContaining({ reason: "local_queue_unavailable" }), expect.any(Object));
    expect(mocks.track.mock.calls.some(([event]) => event === "completed")).toBe(false);
  });
  it("reports completion after a recovered queue read", async () => {
    await expect(runSyncCycle()).resolves.toMatchObject({ pushed: 1, pulled: 1, pending: 0 });
    expect(mocks.track).toHaveBeenCalledWith("completed", expect.any(Object), expect.any(Object));
  });
});
