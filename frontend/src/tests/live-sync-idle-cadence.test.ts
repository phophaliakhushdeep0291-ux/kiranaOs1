import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateSyncQueueCounts } from "@/features/core/sync/sync-health";

/**
 * With the server's live stream open, another counter's change arrives as a nudge
 * within a second, so an idle till's scheduled sync is only the backstop. At 45s
 * that backstop was most of what an idle till still sent — four requests a cycle —
 * so it relaxes to three minutes while the stream is open, and must snap back the
 * moment the stream is gone.
 *
 * What runs for real: useOfflineStatus's engine, its scheduler and the cadence
 * ladder, and the live-stream state it reads. Substituted: the sync cycle itself
 * (counted), the outbox counts (empty), the health probe and the tab coordinator.
 */

const mocks = vi.hoisted(() => ({
  subscribe: null as null | ((listener: () => void) => () => void),
  cycles: [] as number[],
}));

vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: NonNullable<typeof mocks.subscribe>, snapshot: () => unknown) => {
    mocks.subscribe = subscribe;
    return snapshot();
  },
}));
const cycle = async () => {
  mocks.cycles.push(Date.now());
  return { pushed: 0, pulled: 0, conflicts: 0, failed: 0 };
};
vi.mock("@/features/core/sync/deferred-runtime", () => ({ runSyncCycle: cycle, runManualSyncCycle: cycle }));
vi.mock("@/features/core/sync/sync-status-repair", () => ({
  readSyncQueueCounts: async () => calculateSyncQueueCounts([], []),
  clearRetryBackoffAfterReconnect: async () => 0,
}));
vi.mock("@/features/core/sync/backend-health", () => ({
  readBackendConnectionSnapshot: () => ({ browserOnline: true, backendReachable: true, checkedAt: null, apiBaseUrl: "" }),
  probeBackendConnection: async () => ({ browserOnline: true, backendReachable: true, checkedAt: new Date().toISOString(), apiBaseUrl: "" }),
}));
vi.mock("@/lib/browser/multiTabCoordinator", () => ({
  shouldRunScheduledNetworkWork: () => true,
  shouldPassSharedThrottle: () => true,
}));

const T0 = 1_759_700_000_000;
const MINUTE = 60_000;
let unsubscribe: (() => void) | undefined;
let live: typeof import("@/features/core/sync/live-stream-state");

async function mountEngine() {
  live = await import("@/features/core/sync/live-stream-state");
  const { useOfflineStatus } = await import("@/features/core/sync/useOfflineStatus");
  useOfflineStatus();
  unsubscribe = mocks.subscribe!(() => undefined);
}
const cyclesBetween = (from: number, to: number) => mocks.cycles.filter((at) => at >= T0 + from && at < T0 + to).length;

describe("the idle sync cadence with a live stream", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("navigator", { onLine: true });
    mocks.cycles = [];
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("cycles every 45s when idle without a stream, as before", async () => {
    await mountEngine();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    // Past the ladder's first minute, idle is one cycle per 45s.
    expect(cyclesBetween(MINUTE, 10 * MINUTE)).toBeGreaterThanOrEqual(11);
  });

  it("cycles every three minutes when idle with the stream open", async () => {
    await mountEngine();
    live.markLiveStream(true);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    const idle = cyclesBetween(MINUTE, 10 * MINUTE);
    expect(idle).toBeGreaterThanOrEqual(2); // still a backstop: the ack keeps the device "online"
    expect(idle).toBeLessThanOrEqual(3);
    live.markLiveStream(false);
  });

  it("hands the cadence straight back when the stream goes, without waiting out the long rung", async () => {
    await mountEngine();
    live.markLiveStream(true);
    await vi.advanceTimersByTimeAsync(4 * MINUTE); // settled on the three-minute rung
    const droppedAt = Date.now() - T0;
    live.markLiveStream(false);
    await vi.advanceTimersByTimeAsync(46_000);
    expect(cyclesBetween(droppedAt, droppedAt + 46_000)).toBeGreaterThanOrEqual(1);
  });
});
