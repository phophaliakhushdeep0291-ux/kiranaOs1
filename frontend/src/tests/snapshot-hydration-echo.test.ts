import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSyncEvent } from "@/lib/offline/db";
import type { CloudHydrationResult } from "@/features/core/sync/cloud-hydration";
import { calculateSyncQueueCounts } from "@/features/core/sync/sync-health";

/**
 * A snapshot hydration writes the server's state onto the device. That is not new
 * local work, and nothing it announces should start another sync.
 *
 * It announces three times on kirana:local-data-changed: the subscription snapshot
 * it saves, the purchase history it imports, and the import as a whole. The
 * schedulers skip the sync engine's own announcements by `type: "sync"`, and these
 * carried none — the import was typed "cloud-hydration", the subscription write
 * nothing at all. So useOfflineStatus took each for a local edit: reset its
 * cadence, ran another cycle 450ms later and, with a row parked for review, a
 * forced recovery cycle at 900ms. useMultiDeviceSync, which skipped the import by
 * action name, queued a cycle 250ms after each of the other two. None of those
 * cycles had anything to send — and that 250ms one takes the snapshot path when a
 * snapshot is due, so a hydration started at sign-in or from Sync Status could set
 * a second whole hydration going, seven more requests, off its own announcement.
 *
 * What runs for real: the scheduler in useOfflineStatus, the listeners in
 * useMultiDeviceSync (its effect body, with React's hooks reduced to calls),
 * hydrateFromBackendSnapshot and everything it calls — writeSubscriptionSnapshot,
 * hydratePurchaseHistoryFromSyncPull, syncPull, refreshBusinessCaches — and
 * enqueueOutboxOperation / getPendingEvents over an in-memory outbox.
 * Substituted: the network (answered by path, after a delay), the business-table
 * writes (accepted and dropped — none of them announces anything), the health
 * probe, the device license, and the tab coordinator.
 *
 * sync-status-write-echo.test.ts is the sibling of this file: the same rule, for the
 * outbox status writes a push makes rather than for a snapshot's imports.
 */

type Db = typeof import("@/lib/offline/db");
type Announcement = { type?: string; action?: string };

const mocks = vi.hoisted(() => ({
  subscribe: null as null | ((listener: () => void) => () => void),
  snapshot: null as null | (() => { pendingCount: number; failedCount: number }),
  cleanups: [] as (() => void)[],
  outbox: new Map<string, unknown>(),
  // Each cycle, with the timer that started it — see `labelled` below.
  cycles: [] as { at: number; sent: number; cause: string }[],
  cause: "direct",
  throttle: new Map<string, number>(),
  hydrations: [] as { at: number; result: CloudHydrationResult }[],
  // Queue-count reads and announcements, in the order they happened.
  timeline: [] as string[],
}));

vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: NonNullable<typeof mocks.subscribe>, snapshot: NonNullable<typeof mocks.snapshot>) => {
    mocks.subscribe = subscribe;
    mocks.snapshot = snapshot;
    return snapshot();
  },
  useRef: <T,>(current: T) => ({ current }),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) mocks.cleanups.push(cleanup);
  },
  useCallback: <T,>(callback: T) => callback,
  useMemo: <T,>(make: () => T) => make(),
  useState: <T,>(value: T) => [value, () => undefined],
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: async () => undefined }) }));
vi.mock("@/features/core/auth/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, accessToken: "token", user: { id: "user-1", shopId: "shop-1" }, shop: { id: "shop-1" } }),
}));
vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "shop-1", store_id: "shop-1", device_id: "device-1" }),
  nowIso: () => new Date().toISOString(),
}));
vi.mock("@/features/core/devices/license", () => ({ getLicenseEvaluation: async () => null }));
vi.mock("@/features/core/sync/backend-health", () => ({
  readBackendConnectionSnapshot: () => ({ browserOnline: true, backendReachable: true, checkedAt: null, apiBaseUrl: "" }),
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
    mocks.timeline.push("read");
    return calculateSyncQueueCounts([...mocks.outbox.values()] as PendingSyncEvent[], []);
  },
  clearRetryBackoffAfterReconnect: async () => 0,
}));
vi.mock("@/features/core/sync/deferred-runtime", () => ({
  runSyncCycle: () => cycle(),
  runManualSyncCycle: () => cycle(),
  hydrateFromBackendSnapshot: () => hydrate(),
}));
vi.mock("@/lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/http")>()),
  apiRequest: (path: string) => answer(path),
}));

// The snapshot's requests, answered by path after a delay. Bills is the slow one,
// so the three announcements land at different moments, as they do for real.
const SERVER: [prefix: string, delayMs: number, body: unknown][] = [
  ["/subscription/current", 30, { planCode: "pro", status: "active" }],
  ["/products?", 30, [{ id: "product-1", name: "Atta 5kg", stock: 4 }]],
  ["/customers?", 30, []],
  ["/bills?", 180, { bills: [] }],
  ["/udhar?", 30, { entries: [] }],
  ["/sync/pull", 40, { purchaseHistory: [{ id: "purchase-1", supplierName: "Metro", total: 1200 }], sync: {} }],
  ["/inventory", 60, []],
];

function answer(path: string): Promise<unknown> {
  const route = SERVER.find(([prefix]) => path.startsWith(prefix));
  if (!route) return Promise.reject(new Error(`no route for ${path}`));
  const [, delayMs, body] = route;
  // The global timer, not the window's, so a response landing relabels nothing.
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(body)), delayMs));
}

// Loaded before the clock starts: a module import is real I/O, and fake time
// racing ahead of it would leave the snapshot's requests unscheduled.
let hydration: typeof import("@/features/core/sync/cloud-hydration");

async function hydrate(): Promise<CloudHydrationResult> {
  const result = await hydration.hydrateFromBackendSnapshot();
  mocks.hydrations.push({ at: Date.now(), result });
  return result;
}

let db: Db;
let unsubscribe: (() => void) | undefined;

/** The outbox table enqueueOutboxOperation and getPendingEvents read and write. */
function memoryOutbox() {
  const rows = () => [...mocks.outbox.values()] as PendingSyncEvent[];
  return {
    get: async (id: string) => mocks.outbox.get(id),
    put: async (row: PendingSyncEvent) => {
      mocks.outbox.set(row.clientEventId, row);
      return row.clientEventId;
    },
    toArray: async () => rows(),
    where: () => ({
      equals: () => ({
        toArray: async () => rows(),
        filter: (keep: (row: PendingSyncEvent) => boolean) => ({
          sortBy: async () => rows().filter(keep).sort((a, b) => a.createdAt - b.createdAt),
          toArray: async () => rows().filter(keep),
        }),
      }),
    }),
  };
}

async function loadDb(): Promise<Db> {
  const module = await import("@/lib/offline/db");
  const outbox = memoryOutbox();
  Object.assign(module.dexieDB, {
    open: async () => module.dexieDB,
    transaction: async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)(),
    table: (name: string) => {
      if (name !== "sync_outbox") throw new Error(`no in-memory table for ${name}`);
      return outbox;
    },
    sync_outbox: outbox,
    subscription_cache: { put: async (row: { id: string }) => row.id },
    customer_ledger: { filter: () => ({ primaryKeys: async () => [] }), bulkDelete: async () => undefined },
  });
  Object.assign(module.offlineDB, {
    getAll: async (name: string) => (name === "sync_outbox" ? [...mocks.outbox.values()] : []),
    replaceSyncedSnapshot: async () => undefined,
    removeOrphans: async () => 0,
    putMany: async () => undefined,
    putRecentCache: async () => undefined,
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

/** Refused by the server and out of automatic retries: blocking, but never sent again on its own. */
function parkedSale(): PendingSyncEvent {
  const attempts = db.MAX_AUTOMATIC_RETRY_ATTEMPTS;
  return sale("sale-parked", { status: "FAILED", sync_status: "failed", retry_count: attempts, attempts, error_message: "HTTP 422" });
}

// One cycle's push: the server takes whatever the real getPendingEvents says is
// due. Settled straight into the outbox — the push's own status writes are not
// what this file is about.
async function cycle() {
  const cause = mocks.cause;
  const due = await db.offlineDB.getPendingEvents();
  mocks.cycles.push({ at: Date.now(), sent: due.length, cause });
  for (const row of due) mocks.outbox.set(row.clientEventId, { ...row, status: "SYNCED", sync_status: "synced" });
  return { pushed: due.length, pulled: 0, conflicts: 0, failed: 0, pending: 0, skipped: 0 };
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
// (useMultiDeviceSync after a local write), 450ms (useOfflineStatus after one)
// and 900ms (its queue recovery after one) — only ever run because something
// announced a change.
const FOLLOW_UPS = new Set(["timeout:250", "timeout:450", "timeout:900"]);
const BOOT_MS = 2_000;
// useOfflineStatus's key for the 900ms queue recovery.
const QUEUE_RECOVERY_THROTTLE_KEY = "kirana.sync.localQueueRecovery.lastRun";
const T0 = 1_757_600_000_000;

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

const followUpsSince = (at: number) => mocks.cycles.filter((entry) => entry.at >= at && FOLLOW_UPS.has(entry.cause));

const announced: Announcement[] = [];
const queueAnnounced: unknown[] = [];
const onLocalDataChanged = (event: Event) => {
  const detail = ((event as CustomEvent<Announcement | undefined>).detail ?? {}) as Announcement;
  announced.push(detail);
  mocks.timeline.push(`announce:${detail.action ?? "untagged"}`);
};
const onQueueUpdated = (event: Event) => queueAnnounced.push((event as CustomEvent).detail);
/** Page-like listeners, added after the engine's so each hears an event second. */
function listenLikeAPage() {
  window.addEventListener("kirana:local-data-changed", onLocalDataChanged);
  window.addEventListener("kirana:sync-queue-updated", onQueueUpdated);
}

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
    hydrations: [],
    timeline: [],
  });
  announced.length = 0;
  queueAnnounced.length = 0;
  db = await loadDb();
  hydration = await import("@/features/core/sync/cloud-hydration");
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  for (const cleanup of mocks.cleanups) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what a snapshot hydration announces", () => {
  it("marks every announcement as the sync engine's own, and leaves the queue alone", async () => {
    listenLikeAPage();
    const running = hydrate();
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await running;

    // A part that threw is swallowed into `errors` and skips its announcement, so
    // an empty list is what makes the three below the whole story.
    expect(result.errors).toEqual([]);
    expect(announced).toHaveLength(3);
    expect(announced).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "sync", action: "subscription-import" }),
      expect.objectContaining({ type: "sync", action: "purchase-history-import" }),
      expect.objectContaining({ type: "sync", action: "direct-import" }),
    ]));
    // Nothing reached the outbox, and so nothing was announced as queued: the
    // tag cannot be hiding work that needed pushing.
    expect(mocks.outbox.size).toBe(0);
    expect(queueAnnounced).toEqual([]);
  });
});

describe("a snapshot hydration does not schedule another sync", () => {
  const queues = [
    ["an empty queue", () => []],
    // The case seen live: the 900ms recovery forces a /health and a cycle
    // whenever anything is blocking, sendable or not.
    ["a sale parked for review", () => [parkedSale()]],
  ] as const;

  it.each(queues)("runs no follow-up after the daemon's own snapshot, with %s", async (_name, rows) => {
    for (const row of rows()) mocks.outbox.set(row.clientEventId, row);
    await mount();
    await vi.advanceTimersByTimeAsync(3 * 60_000);

    const snapshots = mocks.hydrations.filter((entry) => entry.at - T0 >= BOOT_MS);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    for (const { result } of snapshots) expect(result.errors).toEqual([]);
    expect(followUpsSince(T0 + BOOT_MS)).toEqual([]);
  });

  it.each(queues)("runs none after one started elsewhere — sign-in, manual sync, remote support — with %s", async (_name, rows) => {
    for (const row of rows()) mocks.outbox.set(row.clientEventId, row);
    await mount();
    await vi.advanceTimersByTimeAsync(90_000);
    // The recovery throttle is shared by every tab, and with a row blocking the
    // loop takes it every other tick. Freed here, so the recovery that used to
    // follow a snapshot gets the opening it got live rather than one by chance.
    mocks.throttle.delete(QUEUE_RECOVERY_THROTTLE_KEY);
    const startedAt = Date.now();
    const running = hydrate();
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await running).errors).toEqual([]);
    expect(followUpsSince(startedAt)).toEqual([]);
  });

  it("still reads the queue counts on every announcement", async () => {
    await mount({ engine: true });
    await vi.advanceTimersByTimeAsync(BOOT_MS);
    listenLikeAPage();
    mocks.timeline.length = 0;
    const running = hydrate();
    await vi.advanceTimersByTimeAsync(1_000);
    await running;

    // The engine hears each event first, and its first act is to re-read the
    // counts. Only the cycle it used to schedule after that is gone.
    const announcements = mocks.timeline.flatMap((entry, index) => (entry.startsWith("announce:") ? [index] : []));
    expect(announcements).toHaveLength(3);
    for (const index of announcements) expect(mocks.timeline[index - 1]).toBe("read");
  });
});

describe("new work still prompts a sync from each listener", () => {
  // Each alone, so neither can pass on the other's behalf. The loop is left to
  // idle down first, so its own next tick is far off and cannot be what sends.
  const listeners = [
    ["useOfflineStatus", { engine: true }],
    ["useMultiDeviceSync", { multiDevice: true }],
  ] as const;

  it.each(listeners)("%s sends a sale rung up while a snapshot is landing", async (_name, parts) => {
    await mount(parts);
    await vi.advanceTimersByTimeAsync(90_000);
    const running = hydrate();
    // Mid-snapshot: the subscription and purchase announcements have landed, the
    // bills import is still in flight.
    await vi.advanceTimersByTimeAsync(60);
    const enqueuedAt = Date.now();
    await db.offlineDB.enqueueOutboxOperation(sale("sale-1"));
    await vi.advanceTimersByTimeAsync(1_000);
    await running;

    const sent = mocks.cycles.find((entry) => entry.at >= enqueuedAt && entry.sent > 0);
    expect(sent?.cause).toMatch(/^timeout:(250|450|900)$/);
    expect((mocks.outbox.get("sale-1") as PendingSyncEvent).status).toBe("SYNCED");
  });
});
