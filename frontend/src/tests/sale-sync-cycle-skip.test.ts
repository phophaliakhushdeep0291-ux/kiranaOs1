import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateSyncQueueCounts } from "@/features/core/sync/sync-health";
import type { PendingSyncEvent } from "@/lib/offline/db";

/**
 * A sale used to cost the selling counter four full sync cycles — the push, then
 * three more that found nothing — because each trigger of the same write ran its
 * own: the multi-device hook's 250ms local-write run, this scheduler's 450ms run
 * chained behind it, and the fast rungs of the cadence reset at 2.5s and 10.5s.
 *
 * What runs for real: useOfflineStatus's engine and scheduler, and the cycle state
 * it reads. Substituted: the sync cycle (counted, and marked in-flight the way the
 * engine marks it), the outbox counts, the health probe and the tab coordinator.
 */

const mocks = vi.hoisted(() => ({
  subscribe: null as null | ((listener: () => void) => () => void),
  cycles: [] as number[],
  blocking: 0,
}));

vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: NonNullable<typeof mocks.subscribe>, snapshot: () => unknown) => {
    mocks.subscribe = subscribe;
    return snapshot();
  },
}));
vi.mock("@/features/core/sync/deferred-runtime", async () => {
  const cycleState = await import("@/features/core/sync/sync-cycle-state");
  const cycle = async () => {
    mocks.cycles.push(Date.now());
    cycleState.markSyncCycleStarted();
    await new Promise((resolve) => setTimeout(resolve, 300));
    mocks.blocking = 0; // the push sent everything
    cycleState.markSyncCycleFinished();
    return { pushed: 1, pulled: 0, conflicts: 0, failed: 0 };
  };
  return { runSyncCycle: cycle, runManualSyncCycle: cycle };
});
vi.mock("@/features/core/sync/sync-status-repair", () => ({
  readSyncQueueCounts: async () => calculateSyncQueueCounts(
    Array.from({ length: mocks.blocking }, (_, i) => ({ clientEventId: `sale-${i}`, status: "PENDING", operation_type: "CREATE_BILL" }) as unknown as PendingSyncEvent),
    [],
  ),
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

const T0 = 1_759_800_000_000;
let unsubscribe: (() => void) | undefined;
let cycleState: typeof import("@/features/core/sync/sync-cycle-state");

async function mountEngine() {
  cycleState = await import("@/features/core/sync/sync-cycle-state");
  const { useOfflineStatus } = await import("@/features/core/sync/useOfflineStatus");
  useOfflineStatus();
  unsubscribe = mocks.subscribe!(() => undefined);
  await vi.advanceTimersByTimeAsync(5 * 60_000); // past boot, settled on the idle rung
  mocks.cycles = [];
}

function ringUpSale() {
  mocks.blocking = 1;
  window.dispatchEvent(new Event("kirana:sync-queue-updated")); // untagged: new local work
}

describe("the cycles one sale costs the selling counter", () => {
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
    mocks.blocking = 0;
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs one cycle for a sale, not one per trigger", async () => {
    await mountEngine();
    ringUpSale();
    await vi.advanceTimersByTimeAsync(20_000);
    // The scheduler's own 450ms run sends it; the cadence reset's 2.5s and 10.5s
    // ticks find nothing to send a moment after a full cycle, and stay quiet.
    expect(mocks.cycles).toHaveLength(1);
  });

  it("leaves the sale to a cycle another caller already has running", async () => {
    await mountEngine();
    ringUpSale();
    // The multi-device hook's 250ms local-write run, started outside this scheduler.
    await vi.advanceTimersByTimeAsync(250);
    cycleState.markSyncCycleStarted();
    await vi.advanceTimersByTimeAsync(400);
    mocks.blocking = 0;
    cycleState.markSyncCycleFinished();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.cycles).toHaveLength(0); // no second cycle chained behind it
  });

  it("still sends work that is waiting, however recently a cycle ran", async () => {
    await mountEngine();
    ringUpSale();
    await vi.advanceTimersByTimeAsync(1_000); // the sale's own cycle
    expect(mocks.cycles).toHaveLength(1);
    mocks.blocking = 1; // another sale queued without an announcement reaching us
    await vi.advanceTimersByTimeAsync(3_000); // the reset's 2.5s tick
    expect(mocks.cycles).toHaveLength(2);
  });

  it("keeps the idle backstop once the last cycle is no longer recent", async () => {
    await mountEngine();
    ringUpSale();
    await vi.advanceTimersByTimeAsync(60_000);
    // One for the sale, then the idle ladder resumes: the 30.5s rung is past the
    // fifteen seconds, so the backstop runs again.
    expect(mocks.cycles.length).toBeGreaterThanOrEqual(2);
  });
});
