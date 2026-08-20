import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A pull outage must be reportable.
 *
 * Live report (2026-08-20): `/sync/pull` answered HTTP 500 on every call for an
 * entire session. `pullServerChanges()` swallowed it in a bare `catch` and
 * returned the same success shape it returns when there is genuinely nothing new,
 * so `runSyncCycle()` reported `{pulled: 0, failed: 0}` and the Sync Status screen
 * said "Everything is syncing cleanly — no failures or conflicts". Push kept
 * working, so bills left the device and nothing suggested the device had stopped
 * receiving anything at all.
 */

const settings = vi.hoisted(() => new Map<string, unknown>());
const pullBehaviour = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    open: vi.fn(async () => undefined),
    sync_cursor: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      bulkPut: vi.fn(async () => undefined),
    },
  },
  offlineDB: {
    setSetting: vi.fn(async (key: string, value: unknown) => {
      settings.set(key, value);
    }),
    getSetting: vi.fn(async (key: string) => (settings.has(key) ? settings.get(key) : null)),
  },
}));

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }),
  nowIso: () => "2026-08-20T11:00:00.000Z",
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  emitLocalDataChanged: vi.fn(),
}));

vi.mock("@/features/core/sync/api", () => ({
  acknowledgeSyncSequence: vi.fn(async () => undefined),
  syncPull: vi.fn(async () => {
    if (pullBehaviour.shouldThrow) throw new Error("Request failed with status 500");
    return {
      changes: [],
      sync: { hasMore: false, nextCursor: "7", nextServerSeq: "7", entityCursors: {} },
    };
  }),
}));

vi.mock("@/features/core/sync/sync-reconcile", () => ({
  mergeServerChange: vi.fn(async () => "merged"),
  refreshBusinessCaches: vi.fn(async () => undefined),
}));

import {
  LAST_PULL_FAILURE_SETTING,
  pullServerChanges,
  readLastPullFailure,
} from "@/features/core/sync/sync-pull";

describe("sync pull failure visibility", () => {
  beforeEach(() => {
    settings.clear();
    pullBehaviour.shouldThrow = false;
  });

  it("reports a pull outage instead of returning a clean-looking result", async () => {
    pullBehaviour.shouldThrow = true;

    const result = await pullServerChanges();

    expect(result.failed).toBe(true);
    expect(result.failureReason).toMatch(/500/);
    // The old shape — pulled: 0 and nothing else — is what made this invisible.
    expect(result.pulled).toBe(0);
  });

  it("keeps a durable record the status screen can read", async () => {
    pullBehaviour.shouldThrow = true;
    await pullServerChanges();

    const recorded = await readLastPullFailure();
    expect(recorded).toEqual(
      expect.objectContaining({ reason: expect.stringMatching(/500/), at: "2026-08-20T11:00:00.000Z" }),
    );
  });

  it("clears the record once the device is receiving again", async () => {
    pullBehaviour.shouldThrow = true;
    await pullServerChanges();
    expect(await readLastPullFailure()).not.toBeNull();

    pullBehaviour.shouldThrow = false;
    const result = await pullServerChanges();

    expect(result.failed).toBe(false);
    expect(await readLastPullFailure()).toBeNull();
    expect(settings.get(LAST_PULL_FAILURE_SETTING)).toBeNull();
  });
});
