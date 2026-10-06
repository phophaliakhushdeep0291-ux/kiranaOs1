import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  invalidate: vi.fn(async (_filters?: { refetchType?: string; predicate?: (query: unknown) => boolean }) => undefined),
  cacheListeners: [] as Array<(event: unknown) => void>,
  throttle: vi.fn(() => false),
}));

vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => (() => void)) => { state.cleanup = effect(); },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: state.invalidate,
    getQueryCache: () => ({
      subscribe: (listener: (event: unknown) => void) => {
        state.cacheListeners.push(listener);
        return () => { state.cacheListeners = state.cacheListeners.filter((l) => l !== listener); };
      },
    }),
  }),
}));
vi.mock("@/lib/browser/multiTabCoordinator", () => ({
  shouldPassSharedThrottle: state.throttle,
  shouldRunInteractiveNetworkWork: () => true,
}));
vi.mock("@/lib/offline/instant-cache", () => ({
  LOCAL_DATA_CHANGE_CHANNEL: "test-local-data",
  isFromThisTab: (message: { sender?: string }) => message.sender === "this-tab",
}));

import { useRealtimeRefreshBridge } from "@/lib/realtime/useRealtimeRefreshBridge";
import { refreshesOnLocalData } from "@/lib/api/query-meta";

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
      [{ refetchType: "active", predicate: expect.any(Function) }],
      [{ refetchType: "active", predicate: expect.any(Function) }],
    ]);
  });

  it("refreshes this tab when another tab has consumed the shared throttle", async () => {
    change("broadcast");
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledWith({ refetchType: "active", predicate: expect.any(Function) });
  });

  it("coalesces a burst without downgrading a write to passive invalidation", async () => {
    change();
    change();
    window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "active", predicate: expect.any(Function) });
  });

  it("does not let continuous queue events indefinitely postpone a committed write", async () => {
    change();
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(40);
      window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    }
    expect(state.invalidate).toHaveBeenCalledWith({ refetchType: "active", predicate: expect.any(Function) });
  });

  it("keeps queue-only churn passive and cleans up pending callbacks", async () => {
    window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "none", predicate: expect.any(Function) });
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

  // A sale's push result, the pull and the multi-device refresh are announced
  // separately over about a second. One by one, each re-fetched every list on
  // screen; the online list queries go to the server, so one sale downloaded
  // bills, customers and products three or four times.
  function syncAnnouncement(action: string) {
    window.dispatchEvent(Object.assign(new Event("kirana:local-data-changed"), { detail: { type: "sync", action } }));
  }

  it("refreshes once for a burst of the sync engine's own announcements", async () => {
    syncAnnouncement("push");
    await vi.advanceTimersByTimeAsync(400);
    syncAnnouncement("pull");
    await vi.advanceTimersByTimeAsync(400);
    syncAnnouncement("multi-device-refresh");
    expect(state.invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "active", predicate: expect.any(Function) });
  });

  it("keeps a committed edit fast, and lets it stand in for a pending sync refresh", async () => {
    syncAnnouncement("pull"); // sync refresh pending for a second
    await vi.advanceTimersByTimeAsync(100);
    change(); // the cashier's own edit must not wait for that window
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "active", predicate: expect.any(Function) });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.invalidate).toHaveBeenCalledTimes(1); // it already refetched everything
  });

  it("folds a sync announcement that lands inside a pending edit refresh into it", async () => {
    change();
    syncAnnouncement("push");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "active", predicate: expect.any(Function) });
  });

  // Every push rewrites outbox rows, and each rewrite announces queue churn: a
  // passive refresh is pending whenever the push's own announcement arrives.
  it("does not turn the outbox's passive refresh into a fetch for a sync announcement", async () => {
    window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    syncAnnouncement("push");
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({ refetchType: "none", predicate: expect.any(Function) });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.invalidate).toHaveBeenLastCalledWith({ refetchType: "active", predicate: expect.any(Function) });
    expect(state.invalidate).toHaveBeenCalledTimes(2);
  });

  function fetchStarted(query: object) {
    for (const listener of state.cacheListeners) listener({ type: "updated", action: { type: "fetch" }, query });
  }
  function lastPredicate() {
    return state.invalidate.mock.calls.at(-1)![0]!.predicate!;
  }

  it("leaves out a list its page already refetched after the change", async () => {
    const bills = {};
    const products = {};
    change(); // a sale, announced
    fetchStarted(bills); // BillingPage's own refetch of the bills it just wrote
    await vi.advanceTimersByTimeAsync(120);
    expect(lastPredicate()(bills)).toBe(false);
    expect(lastPredicate()(products)).toBe(true);
    expect(lastPredicate()({ meta: { refreshOnLocalData: false } })).toBe(false);
  });

  it("does not let the outbox's churn after that refetch undo the skip", async () => {
    const bills = {};
    change();
    fetchStarted(bills);
    window.dispatchEvent(new Event("kirana:sync-queue-updated")); // the sale's outbox row, settling
    await vi.advanceTimersByTimeAsync(120);
    expect(lastPredicate()(bills)).toBe(false);
  });

  it("still marks every list stale for churn alone", async () => {
    const bills = {};
    fetchStarted(bills);
    window.dispatchEvent(new Event("kirana:sync-queue-updated"));
    await vi.advanceTimersByTimeAsync(120);
    expect(lastPredicate()).toBe(refreshesOnLocalData);
  });

  it("still refetches a list whose fetch began before the change", async () => {
    const bills = {};
    fetchStarted(bills); // in flight when the sale landed: it cannot have read it
    change();
    await vi.advanceTimersByTimeAsync(120);
    expect(lastPredicate()(bills)).toBe(true);
  });

  it("measures from the last change in the window, not the first", async () => {
    const bills = {};
    change();
    fetchStarted(bills);
    change(); // a second write, after that fetch began
    await vi.advanceTimersByTimeAsync(120);
    expect(lastPredicate()(bills)).toBe(true);
  });

  it("leaves out of a sync refresh a list refetched after the last announcement", async () => {
    const bills = {};
    const customers = {};
    syncAnnouncement("push");
    fetchStarted(customers);
    syncAnnouncement("pull");
    fetchStarted(bills);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastPredicate()(bills)).toBe(false);
    expect(lastPredicate()(customers)).toBe(true);
  });
});

describe("changes broadcast between tabs", () => {
  let channel: { onmessage: ((event: { data: unknown }) => void) | null } | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("BroadcastChannel", class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      constructor() { channel = this; }
      close() {}
    });
    useRealtimeRefreshBridge();
  });

  afterEach(() => {
    state.cleanup?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function deliver(sender: string) {
    channel!.onmessage!({ data: { source: "kirana-local-data", detail: { type: "bill" }, emittedAt: 0, sender } });
  }

  it("refreshes for another tab's change", async () => {
    deliver("other-tab");
    await vi.advanceTimersByTimeAsync(120);
    expect(state.invalidate).toHaveBeenCalledOnce();
  });

  it("ignores its own change coming back over the channel", async () => {
    const heard: unknown[] = [];
    window.addEventListener("kirana:local-data-changed", (event) => heard.push((event as CustomEvent).detail));
    deliver("this-tab");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(heard).toEqual([]);
    expect(state.invalidate).not.toHaveBeenCalled();
  });
});

describe("queries a local write cannot change", () => {
  it("are left out of the local-data refresh; everything else stays in", () => {
    expect(refreshesOnLocalData({ meta: { refreshOnLocalData: false } })).toBe(false);
    expect(refreshesOnLocalData({})).toBe(true);
    expect(refreshesOnLocalData({ meta: { somethingElse: true } })).toBe(true);
  });
});
