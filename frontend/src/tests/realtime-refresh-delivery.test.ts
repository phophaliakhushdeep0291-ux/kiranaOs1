import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  invalidate: vi.fn(async () => undefined),
  throttle: vi.fn(() => false),
}));

vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => (() => void)) => { state.cleanup = effect(); },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("@/lib/browser/multiTabCoordinator", () => ({
  shouldPassSharedThrottle: state.throttle,
  shouldRunInteractiveNetworkWork: () => true,
}));
vi.mock("@/lib/offline/instant-cache", () => ({ LOCAL_DATA_CHANGE_CHANNEL: "test-local-data" }));

import { useRealtimeRefreshBridge } from "@/lib/realtime/useRealtimeRefreshBridge";

function change(source?: string) {
  window.dispatchEvent(Object.assign(new Event("kirana:local-data-changed"), { detail: { source } }));
}

describe("visible refresh delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.throttle.mockReturnValue(false);
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("BroadcastChannel", undefined);
    useRealtimeRefreshBridge();
  });

  afterEach(() => {
    state.cleanup?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refreshes a second committed edit even inside the shared network throttle window", async () => {
    state.throttle.mockReturnValueOnce(true);
    change();
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(400);
    change();
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate.mock.calls).toEqual([
      [{ refetchType: "active" }],
      [{ refetchType: "active" }],
    ]);
  });

  it("refreshes this tab when another tab has consumed the shared throttle", async () => {
    change("broadcast");
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledWith({ refetchType: "active" });
  });

  it("coalesces a burst without downgrading a write to passive invalidation", async () => {
    change();
    change();
    window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "active" });
  });

  it("does not let continuous queue events indefinitely postpone a committed write", async () => {
    change();
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(40);
      window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    }
    expect(state.invalidate).toHaveBeenCalledWith({ refetchType: "active" });
  });

  it("keeps queue-only churn passive and cleans up pending callbacks", async () => {
    window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "none" });
    change();
    state.cleanup?.();
    await vi.advanceTimersByTimeAsync(200);
    expect(state.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not fetch for a hidden tab", async () => {
    Object.assign(document, { visibilityState: "hidden" });
    change();
    await vi.advanceTimersByTimeAsync(200);
    expect(state.invalidate).not.toHaveBeenCalled();
  });
});
