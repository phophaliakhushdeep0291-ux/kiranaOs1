import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSyncEvent } from "@/lib/offline/db";
import { calculateSyncQueueCounts } from "@/features/core/sync/sync-health";
import { transientFailureCount, transientRetryDelayMs } from "@/features/core/sync/sync-failure-classification";

/**
 * The push's own outbox bookkeeping is not new work.
 *
 * Every push attempt writes the outbox twice — SYNCING before the request, then
 * the server's answer after it (SYNCED, FAILED, CONFLICT, or PENDING deferred by
 * a transient failure) — and updatePendingEventStatus announces each write on
 * kirana:sync-queue-updated. Both listeners that schedule sync used to read that
 * as a fresh sale: useOfflineStatus reset its cadence and ran another cycle 450ms
 * later, useMultiDeviceSync another 250ms later. Neither had anything to send, and
 * each still cost the server a /sync/status and a /sync/pull — during an outage,
 * the very server that was failing.
 *
 * What runs for real: the scheduler in useOfflineStatus, the listeners in
 * useMultiDeviceSync (its effect body, with React's hooks reduced to calls), and
 * updatePendingEventStatus / getPendingEvents / enqueueOutboxOperation from
 * lib/offline/db.ts over an in-memory outbox. Substituted: the network (a cycle
 * sends whatever the real getPendingEvents says is due and records the server's
 * answer through the real status writes, as pushPendingOutboxOperations does),
 * the health probe, and the tab coordinator.
 */

type Db = typeof import("@/lib/offline/db");

const mocks = vi.hoisted(() => ({
  subscribe: null as null | ((listener: () => void) => () => void),
  snapshot: null as null | (() => { pendingCount: number; failedCount: number; conflictCount: number }),
  cleanups: [] as (() => void)[],
  outbox: new Map<string, unknown>(),
  // Each cycle, with the timer that started it — see `labelled` below.
  cycles: [] as { at: number; sent: number; cause: string }[],
  cause: "direct",
  throttle: new Map<string, number>(),
  server: "down" as "down" | "up" | "retryable-events",
}));

vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: NonNullable<typeof mocks.subscribe>, snapshot: NonNullable<typeof mocks.snapshot>) => {
    mocks.subscribe = subscribe;
    mocks.snapshot = snapshot;
    return snapshot();
  },
  useRef: <T>(current: T) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) mocks.cleanups.push(cleanup);
  },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: async () => undefined }) }));
vi.mock("@/features/core/auth/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, accessToken: "token", user: { id: "user-1", shopId: "shop-1" }, shop: { id: "shop-1" } }),
}));
vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "shop-1", store_id: "shop-1", device_id: "device-1" }),
  nowIso: () => new Date().toISOString(),
}));
vi.mock("@/features/core/sync/backend-health", () => ({
  readBackendConnectionSnapshot: () => ({ browserOnline: true, backendReachable: true, checkedAt: null, apiBaseUrl: "" }),
  // Reachable throughout: in this outage /health answers and the push 500s.
  probeBackendConnection: async () => ({ browserOnline: true, backendReachable: true, checkedAt: new Date().toISOString(), apiBaseUrl: "" }),
}));
vi.mock("@/lib/browser/multiTabCoordinator", () => ({
  shouldRunScheduledNetworkWork: () => true,
  // Like the real one: the first caller in the interval wins, and winning consumes it.
  shouldPassSharedThrottle: (key: string, intervalMs: number) => {
    const now = Date.now();
    if (now - (mocks.throttle.get(key) ?? Number.NEGATIVE_INFINITY) < intervalMs) return false;
    mocks.throttle.set(key, now);
    return true;
  },
}));
vi.mock("@/features/core/sync/sync-status-repair", () => ({
  readSyncQueueCounts: async () => {
    const rows = [...mocks.outbox.values()] as PendingSyncEvent[];
    return { ...calculateSyncQueueCounts(rows, []), ...(await retryTiming(rows)) };
  },
  clearRetryBackoffAfterReconnect: async () => 0,
}));
vi.mock("@/features/core/sync/deferred-runtime", () => ({
  runSyncCycle: () => cycle(),
  runManualSyncCycle: () => cycle(),
  // The snapshot's own announcement is a separate path from the one tested here.
  hydrateFromBackendSnapshot: async () => ({}),
}));

let db: Db;
let unsubscribe: (() => void) | undefined;

/** The outbox table updatePendingEventStatus and getPendingEvents read and write. */
function memoryOutbox() {
  const rows = () => [...mocks.outbox.values()] as PendingSyncEvent[];
  const selection = (keep: (row: PendingSyncEvent) => boolean) => ({
    sortBy: async () => rows().filter(keep).sort((a, b) => a.createdAt - b.createdAt),
    count: async () => rows().filter(keep).length,
    toArray: async () => rows().filter(keep),
  });
  return {
    get: async (id: string) => mocks.outbox.get(id),
    put: async (row: PendingSyncEvent) => {
      mocks.outbox.set(row.clientEventId, row);
      return row.clientEventId;
    },
    where: () => ({ equals: () => ({ filter: selection, toArray: async () => rows() }) }),
  };
}

async function loadDb(): Promise<Db> {
  const module = await import("@/lib/offline/db");
  const outbox = memoryOutbox();
  Object.assign(module.dexieDB, {
    open: async () => module.dexieDB,
    transaction: async (_mode: string, _tables: unknown, scope: () => Promise<unknown>) => scope(),
    table: (name: string) => {
      if (name !== "sync_outbox") throw new Error(`no in-memory table for ${name}`);
      return outbox;
    },
    sync_outbox: outbox,
  });
  return module;
}

function sale(id: string, fields: Partial<PendingSyncEvent> = {}): PendingSyncEvent {
  return {
    op_id: id,
    clientEventId: id,
    type: "CREATE_BILL",
    tenant_id: "shop-1",
    store_id: "shop-1",
    device_id: "device-1",
    entity_type: "bill",
    entity_id: id,
    operation_type: "CREATE_BILL",
    payload: {},
    client_created_at: new Date().toISOString(),
    status: "PENDING",
    retry_count: 0,
    idempotency_key: id,
    createdAt: Date.now(),
    attempts: 0,
    sync_status: "pending_sync",
    next_retry_at: null,
    ...fields,
  };
}

/**
 * Queue counts come from the app's own counting rule, over the in-memory outbox.
 * Alongside them, when the push next has anything to take — rows due now (the
 * real getPendingEvents) and the earliest retry time of the rest — for a
 * scheduler that paces itself by that rather than by the counts alone.
 */
async function retryTiming(rows: PendingSyncEvent[]) {
  const now = Date.now();
  const waiting = rows
    .filter((row) => row.status === "PENDING" || (row.status === "FAILED" && row.retry_count < db.MAX_AUTOMATIC_RETRY_ATTEMPTS))
    .map((row) => (row.next_retry_at ? new Date(row.next_retry_at).getTime() : Number.NaN))
    .filter((at) => at > now);
  return {
    dueNow: (await db.offlineDB.getPendingEvents()).length,
    nextDueAt: waiting.length > 0 ? Math.min(...waiting) : null,
  };
}

/** A row put straight into the outbox, announcing nothing — as another tab's write would look. */
function seed(row: PendingSyncEvent) {
  mocks.outbox.set(row.clientEventId, row);
}

function announcePush(pushed: number) {
  window.dispatchEvent(new CustomEvent("kirana:local-data-changed", {
    detail: { type: "sync", action: "push", pushed, failed: 0, conflicts: 0 },
  }));
}

// One cycle's push, through the real status writes in the order
// pushPendingOutboxOperations makes them.
async function cycle() {
  const due = await db.offlineDB.getPendingEvents();
  mocks.cycles.push({ at: Date.now(), sent: due.length, cause: mocks.cause });
  let pushed = 0;
  if (due.length > 0) {
    const ids = due.map((row) => row.clientEventId);
    await db.offlineDB.updatePendingEventStatus(ids, "SYNCING");
    if (mocks.server === "up") {
      await db.offlineDB.updatePendingEventStatus(ids, "SYNCED");
      pushed = due.length;
      announcePush(pushed);
    } else {
      // No verdict: back to PENDING, deferred by the longest transient streak.
      const deferMs = transientRetryDelayMs(Math.max(0, ...due.map(transientFailureCount)));
      await db.offlineDB.updatePendingEventStatus(ids, "PENDING", "HTTP 500", { deferMs });
      // A 200 whose events each came back retryable is announced as a push too;
      // a batch that 500ed never reaches that line.
      if (mocks.server === "retryable-events") announcePush(0);
    }
  }
  return { pushed, pulled: 0, conflicts: 0, failed: 0, pending: 0, skipped: due.length - pushed };
}

/**
 * Timers wrapped so a cycle knows which one started it. Fake timers run one timer
 * at a time and let every promise it started settle before the next, so the label
 * set when a timer fires is still the current one when its chain reaches a cycle.
 */
function labelled() {
  return {
    setTimeout: (run: () => void, delay = 0) => setTimeout(() => {
      mocks.cause = `timeout:${delay}`;
      run();
    }, delay),
    setInterval: (run: () => void, delay = 0) => setInterval(() => {
      mocks.cause = `interval:${delay}`;
      run();
    }, delay),
    clearTimeout,
    clearInterval,
  };
}

// What started a cycle. The loop's own tick is never sooner than the fast rung
// (the drain rung aside, which needs rows landing), the snapshot runs on its
// minute, and the boot catch-ups once in the first second. The rest — 250ms
// (useMultiDeviceSync after a queue event), 450ms (useOfflineStatus after one)
// and 900ms (its queue recovery after one) — only ever run because something
// announced a queue change.
const FOLLOW_UPS = new Set(["timeout:250", "timeout:450", "timeout:900"]);
const BOOT_MS = 2_000;

const T0 = 1_757_500_000_000;
const pageListener = vi.fn();

async function mount(parts: { engine?: boolean; multiDevice?: boolean } = { engine: true, multiDevice: true }) {
  if (parts.engine) {
    const { useOfflineStatus } = await import("@/features/core/sync/useOfflineStatus");
    useOfflineStatus();
    unsubscribe = mocks.subscribe!(() => undefined);
  }
  if (parts.multiDevice) {
    const { useMultiDeviceSync } = await import("@/lib/realtime/useMultiDeviceSync");
    useMultiDeviceSync();
  }
}

const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};
const afterBoot = () => mocks.cycles.filter((entry) => entry.at - T0 >= BOOT_MS);
const attempts = () => afterBoot().filter((entry) => entry.sent > 0);
const followUps = () => afterBoot().filter((entry) => FOLLOW_UPS.has(entry.cause));

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubGlobal("window", Object.assign(new EventTarget(), labelled()));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("BroadcastChannel", undefined);
  Object.assign(mocks, {
    subscribe: null,
    snapshot: null,
    cleanups: [],
    outbox: new Map(),
    cycles: [],
    cause: "direct",
    throttle: new Map(),
    server: "down",
  });
  pageListener.mockReset();
  db = await loadDb();
  window.addEventListener("kirana:sync-queue-updated", pageListener);
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  for (const cleanup of mocks.cleanups) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what an outbox status write announces", () => {
  const announced = () => pageListener.mock.calls.map(([event]) => (event as CustomEvent).detail);

  it("marks the push's own writes as sync bookkeeping", async () => {
    seed(sale("sale-1"));
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "SYNCING");
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "PENDING", "HTTP 500", { deferMs: 1_000 });
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "FAILED", "HTTP 422");
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "CONFLICT", "Sync conflict");
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "SYNCED");
    // None of them leaves a row the push would take now, so none is work. Every
    // one still reaches the page listeners, which refresh on the event whatever
    // its detail says.
    expect(announced()).toEqual(["SYNCING", "PENDING", "FAILED", "CONFLICT", "SYNCED"].map((status) => ({
      type: "sync",
      action: "status_changed",
      status,
      count: 1,
    })));
  });

  it("announces a requeue as work, because it makes the row due", async () => {
    seed(sale("sale-1", { status: "FAILED", sync_status: "failed", next_retry_at: new Date(T0 + 60_000).toISOString() }));
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "PENDING");
    expect(announced()).toEqual([{ action: "status_changed", status: "PENDING", count: 1 }]);
    expect((await db.offlineDB.getPendingEvents()).map((row) => row.clientEventId)).toEqual(["sale-1"]);
  });
});

describe("a push attempt does not schedule another sync", () => {
  it("runs no follow-up cycle across a five-minute 500 outage", async () => {
    await mount();
    await db.offlineDB.enqueueOutboxOperation(sale("sale-1"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    // The sale is still retried on its deferral schedule, 1s doubling to 30s.
    expect(attempts().length).toBeGreaterThanOrEqual(10);
    // And nothing else follows those attempts: before, every one of them was
    // chased by a useMultiDeviceSync cycle at 250ms and an engine cycle at 450ms,
    // each with nothing to send.
    expect(followUps()).toEqual([]);
    // Every status write still reached the page listeners.
    expect(pageListener.mock.calls.length).toBeGreaterThanOrEqual(2 * attempts().length);
  });

  it("runs none when a 200 comes back with every event retryable", async () => {
    // That push also announces itself on kirana:local-data-changed as
    // { type: "sync", action: "push" }, which useMultiDeviceSync did not filter.
    mocks.server = "retryable-events";
    await mount();
    await db.offlineDB.enqueueOutboxOperation(sale("sale-1"));
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(attempts().length).toBeGreaterThanOrEqual(6);
    expect(followUps()).toEqual([]);
  });

  it("still refreshes the queue counts on those writes", async () => {
    // A row mid-push: counted as pending, and not something a cycle would send.
    seed(sale("sale-1", { status: "SYNCING", sync_status: "syncing" }));
    await mount({ engine: true });
    await vi.advanceTimersByTimeAsync(BOOT_MS);
    expect(mocks.snapshot!().pendingCount).toBe(1);
    const writtenAt = Date.now();
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "SYNCED");
    await settle();
    // Read on the event itself, before any timer has had a chance to run.
    expect(mocks.snapshot!().pendingCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.cycles.filter((entry) => entry.at >= writtenAt && FOLLOW_UPS.has(entry.cause))).toEqual([]);
  });
});

describe("new work still prompts a sync from each listener", () => {
  // Each alone, so neither can pass on the other's behalf. The loop is left to
  // idle down first, so its own next tick is far off and cannot be what sends.
  const listeners = [
    ["useOfflineStatus", { engine: true }],
    ["useMultiDeviceSync", { multiDevice: true }],
  ] as const;

  it.each(listeners)("%s sends a requeued row at once", async (_name, parts) => {
    mocks.server = "up";
    await mount(parts);
    await vi.advanceTimersByTimeAsync(90_000);
    seed(sale("sale-1", { status: "FAILED", sync_status: "failed", retry_count: 3, next_retry_at: new Date(Date.now() + 10 * 60_000).toISOString() }));
    const requeuedAt = Date.now();
    // A requeue: PENDING with no deferral, due the moment it is written.
    await db.offlineDB.updatePendingEventStatus(["sale-1"], "PENDING");
    await vi.advanceTimersByTimeAsync(1_000);
    const sent = mocks.cycles.find((entry) => entry.at >= requeuedAt && entry.sent > 0);
    expect(sent?.cause).toMatch(/^timeout:(250|450|900)$/);
    expect((mocks.outbox.get("sale-1") as PendingSyncEvent).status).toBe("SYNCED");
  });

  it.each(listeners)("%s sends a new sale at once", async (_name, parts) => {
    mocks.server = "up";
    await mount(parts);
    await vi.advanceTimersByTimeAsync(90_000);
    const enqueuedAt = Date.now();
    await db.offlineDB.enqueueOutboxOperation(sale("sale-2"));
    await vi.advanceTimersByTimeAsync(1_000);
    const sent = mocks.cycles.find((entry) => entry.at >= enqueuedAt && entry.sent > 0);
    expect(sent?.cause).toMatch(/^timeout:(250|450|900)$/);
    expect((mocks.outbox.get("sale-2") as PendingSyncEvent).status).toBe("SYNCED");
  });
});
