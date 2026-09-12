import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  subscribe: null as null | ((listener: () => void) => () => void),
  snapshot: null as null | (() => { queueStatus: string; pendingCount: number; failedCount: number; conflictCount: number }),
}));
// Capture React's external-store boundary. The real scheduler, reads, event
// handlers and publication logic run; only React's rendering is substituted.
vi.mock("react", () => ({ useSyncExternalStore: (subscribe: typeof mocks.subscribe, snapshot: NonNullable<typeof mocks.snapshot>) => { mocks.subscribe = subscribe; mocks.snapshot = snapshot; return snapshot(); } }));
vi.mock("@/features/core/sync/sync-status-repair", () => ({ readSyncQueueCounts: mocks.read, clearRetryBackoffAfterReconnect: async () => 0 }));
vi.mock("@/features/core/sync/deferred-runtime", () => ({ runManualSyncCycle: vi.fn(), runSyncCycle: vi.fn() }));
vi.mock("@/features/core/sync/backend-health", () => ({ readBackendConnectionSnapshot: () => ({ browserOnline: true, backendReachable: true }), probeBackendConnection: async () => ({ browserOnline: true, backendReachable: true }) }));
vi.mock("@/lib/browser/multiTabCoordinator", () => ({ shouldRunScheduledNetworkWork: () => false, shouldPassSharedThrottle: () => false }));
const counts = (pending = 0) => ({ pending, failed: 0, conflict: 0, retryable: 0, totalBlocking: pending });
let unsubscribe: (() => void) | undefined;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const refresh = async () => { window.dispatchEvent(new Event("kirana:sync-queue-updated")); await settle(); };

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const surface = Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval });
  vi.stubGlobal("window", surface);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("navigator", { onLine: true });
  mocks.read.mockReset().mockResolvedValue(counts());
  const { useOfflineStatus } = await import("@/features/core/sync/useOfflineStatus");
  expect(useOfflineStatus().queueStatus).toBe("checking");
});
afterEach(() => { unsubscribe?.(); unsubscribe = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("shared queue status read failures", () => {
  it("does not turn an initial failure into a verified empty queue, and recovers", async () => {
    mocks.read.mockRejectedValue(Error("DB unavailable"));
    unsubscribe = mocks.subscribe!(() => undefined);
    await settle();
    expect(mocks.snapshot!().queueStatus).toBe("error");
    mocks.read.mockResolvedValue(counts());
    await refresh();
    expect(mocks.snapshot!()).toMatchObject({ queueStatus: "ready", pendingCount: 0 });
  });
  it("keeps last-known counts but invalidates their health after a failure", async () => {
    mocks.read.mockResolvedValue(counts(3));
    unsubscribe = mocks.subscribe!(() => undefined);
    await settle();
    expect(mocks.snapshot!()).toMatchObject({ queueStatus: "ready", pendingCount: 3 });
    mocks.read.mockRejectedValue(Error("DB unavailable"));
    await refresh();
    expect(mocks.snapshot!()).toMatchObject({ queueStatus: "error", pendingCount: 3 });
  });
  it("ignores an older successful empty read after a newer failure", async () => {
    let resolveOld!: (value: ReturnType<typeof counts>) => void;
    mocks.read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    unsubscribe = mocks.subscribe!(() => undefined);
    mocks.read.mockRejectedValue(Error("newer failure"));
    await refresh();
    resolveOld(counts());
    await settle();
    expect(mocks.snapshot!().queueStatus).toBe("error");
  });
  it("ignores an older failed read after a newer verified count", async () => {
    let rejectOld!: (error: Error) => void;
    mocks.read.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    unsubscribe = mocks.subscribe!(() => undefined);
    mocks.read.mockResolvedValue(counts(2));
    await refresh();
    rejectOld(Error("older failure"));
    await settle();
    expect(mocks.snapshot!()).toMatchObject({ queueStatus: "ready", pendingCount: 2 });
  });
  it("invalidates late reads when the last subscriber leaves", async () => {
    let resolveOld!: (value: ReturnType<typeof counts>) => void;
    mocks.read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    unsubscribe = mocks.subscribe!(() => undefined);
    unsubscribe(); unsubscribe = undefined;
    resolveOld(counts()); await settle();
    expect(mocks.snapshot!().queueStatus).toBe("checking");
  });
});
