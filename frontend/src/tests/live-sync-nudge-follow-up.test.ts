import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveChangesOptions } from "@/features/core/sync/live-changes";

/**
 * useMultiDeviceSync turns the server's live nudge into a sync cycle. The hook
 * runs one cycle at a time and returned early for a caller arriving mid-run, which
 * is right for its timers but wrong for a nudge: the write it announces may have
 * committed after that run's pull, and dropping it left the change to the idle
 * cadence — the 45s wait this stream exists to remove.
 *
 * What runs for real: the hook's effect body (React's hooks reduced to calls).
 * Substituted: the stream itself (its options are captured), the sync cycle (held
 * open until released), the health probe and the tab coordinator.
 */

const mocks = vi.hoisted(() => ({
  cleanups: [] as (() => void)[],
  live: null as LiveChangesOptions | null,
  stop: null as null | (() => void),
  cycles: 0,
  release: null as null | (() => void),
}));

vi.mock("react", () => ({
  useRef: <T,>(current: T) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) mocks.cleanups.push(cleanup);
  },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: async () => undefined }) }));
vi.mock("@/features/core/auth/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, accessToken: "token", user: { id: "user-1", shopId: "shop-1" }, shop: { id: "shop-1" } }),
}));
vi.mock("@/features/core/sync/backend-health", () => ({
  probeBackendConnection: async () => ({ browserOnline: true, backendReachable: true }),
}));
vi.mock("@/lib/browser/multiTabCoordinator", () => ({
  shouldRunScheduledNetworkWork: () => true,
  shouldPassSharedThrottle: () => true,
}));
vi.mock("@/features/core/sync/deferred-runtime", () => ({
  runSyncCycle: () => {
    mocks.cycles += 1;
    return new Promise((resolve) => {
      mocks.release = () => resolve({ pushed: 0, pulled: 1, conflicts: 0, failed: 0 });
    });
  },
  hydrateFromBackendSnapshot: async () => ({}),
}));
vi.mock("@/features/core/sync/live-changes", () => ({
  startLiveChanges: (options: LiveChangesOptions) => {
    mocks.live = options;
    mocks.stop = vi.fn();
    return { stop: mocks.stop, wake: vi.fn() };
  },
}));
vi.mock("@/lib/api/http", () => ({ isBrowserOnline: () => true }));

describe("live nudges in useMultiDeviceSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("BroadcastChannel", undefined);
    Object.assign(mocks, { cleanups: [], live: null, stop: null, cycles: 0, release: null });
  });

  afterEach(() => {
    for (const cleanup of mocks.cleanups) cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount() {
    const { useMultiDeviceSync } = await import("@/lib/realtime/useMultiDeviceSync");
    useMultiDeviceSync();
    return mocks.live!;
  }

  it("pulls on a nudge at once, and nudges arriving mid-pull get exactly one follow-up", async () => {
    const live = await mount();
    live.onChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.cycles).toBe(1); // straight away, not on the cadence

    live.onChange();
    live.onChange();
    live.onReconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.cycles).toBe(1); // one cycle at a time

    mocks.release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.cycles).toBe(2); // the change it may have missed is pulled

    mocks.release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.cycles).toBe(2); // and only once for the three nudges
  });

  it("holds the stream only while the till is visible, and closes it on unmount", async () => {
    const live = await mount();
    expect(live.shouldConnect()).toBe(true);
    (document as unknown as { visibilityState: string }).visibilityState = "hidden";
    expect(live.shouldConnect()).toBe(false);

    for (const cleanup of mocks.cleanups.splice(0)) cleanup();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
});
