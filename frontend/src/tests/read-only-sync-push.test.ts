import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A view-only login must not push the outbox. On a shared counter the queue can
 * still hold the cashier's unsent sales from before the logout; pushed under the
 * viewer's token each one is refused (PERMISSION_DENIED, not retryable) and parked
 * for good. Left in the queue, they go out with the next login allowed to send them.
 */
const mocks = vi.hoisted(() => ({
  role: "viewer" as string,
  drain: vi.fn(),
  pull: vi.fn(),
  settleLocalOnly: vi.fn(),
}));
vi.mock("@/features/core/sync/sync-operation-normalizer", () => ({ settleLocalOnlyOutboxOperations: mocks.settleLocalOnly }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { init: async () => undefined }, dexieDB: {}, rowMatchesCurrentScope: () => true }));
vi.mock("@/features/core/sync/api", () => ({ getSyncStatus: async () => ({ allowed: true }), requestSyncRetry: vi.fn() }));
vi.mock("@/features/core/sync/sync-pull", () => ({ pullServerChanges: mocks.pull }));
vi.mock("@/features/core/sync/sync-push", () => ({ drainPendingOutboxOperations: mocks.drain, applyRecoveredSyncEventResult: vi.fn(), pushPendingOutboxOperations: vi.fn() }));
vi.mock("@/features/core/subscription/access", () => ({ getCurrentSubscriptionSnapshot: async () => ({ cloudSyncAllowed: true }) }));
vi.mock("@/features/core/sync/sync-status-repair", () => ({ readSyncQueueCounts: async () => ({ totalBlocking: 3 }), repairResolvedSyncStatusNoise: async () => 0, repairRetryableBillValidationConflicts: async () => 0 }));
vi.mock("@/features/core/sync/backend-health", () => ({ probeBackendConnection: async () => ({ browserOnline: true, backendReachable: true }) }));
vi.mock("@/lib/api/http", () => ({ ApiClientError: class extends Error {}, getStoredAccessToken: () => "test", getStoredRefreshToken: () => "test" }));
vi.mock("@/lib/activity", () => ({ ACTIVITY_EVENTS: { SYNC_COMPLETED: "completed", SYNC_FAILED: "failed" }, trackEvent: vi.fn() }));
vi.mock("@/features/core/remote-support/command-runner", () => ({ drainDeviceCommands: vi.fn() }));
vi.mock("@/features/core/sync/sync-conflict-cache", () => ({ refreshServerConflictCache: vi.fn() }));
vi.mock("@/lib/storage/auth-storage", () => ({ loadAuthSession: () => ({ user: { role: mocks.role } }) }));
import { runSyncCycle } from "@/features/core/sync/sync-engine";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.drain.mockResolvedValue({ pushed: 3, failed: 0, conflicts: 0, skipped: 0 });
  mocks.pull.mockResolvedValue({ pulled: 2, conflicts: 0, cursor: "next" });
  mocks.settleLocalOnly.mockResolvedValue(1);
});

describe("a view-only login's sync", () => {
  it("pulls the shop's changes but leaves the queue for someone allowed to send it", async () => {
    mocks.role = "viewer";
    const result = await runSyncCycle();
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(mocks.pull).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pushed: 0, pulled: 2, failed: 0, pending: 3 });
  });

  it("still settles the rows that never leave this device, such as its own login audit", async () => {
    // The push is where those are normally marked done. Skipping it without this
    // left a viewer's sign-in reading "1 pending — backup needs attention" for good.
    mocks.role = "viewer";
    await runSyncCycle();
    expect(mocks.settleLocalOnly).toHaveBeenCalledTimes(1);
  });

  it("still pushes for a cashier", async () => {
    mocks.role = "staff";
    const result = await runSyncCycle();
    expect(mocks.drain).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pushed: 3, pulled: 2 });
  });
});
