import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every sync cycle ends its pull by rebuilding the screens' quick-start caches,
 * which reads most of the offline database. An idle counter used to do that
 * every 2.5 to 45 seconds with nothing new to show. A pull that received
 * nothing now skips it unless something changed locally since the last one.
 */
const state = vi.hoisted(() => ({ reads: [] as string[], failNextRead: false }));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: {},
  offlineDB: {
    getAll: vi.fn(async (table: string) => {
      state.reads.push(table);
      if (state.failNextRead) { state.failNextRead = false; throw new Error("storage unavailable"); }
      return [];
    }),
    removeOrphans: vi.fn(async () => 0),
  },
  rowMatchesCurrentScope: () => true,
}));
vi.mock("@/lib/offline/instant-cache", () => ({ writeInstantCache: vi.fn() }));

type Reconcile = typeof import("@/features/core/sync/sync-reconcile");
let refreshBusinessCaches: Reconcile["refreshBusinessCaches"];
const announce = (detail?: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent("kirana:local-data-changed", { detail }));

beforeEach(async () => {
  state.reads = [];
  vi.stubGlobal("window", new EventTarget());
  // A fresh module per test: the stale flag starts true at app load.
  vi.resetModules();
  ({ refreshBusinessCaches } = await import("@/features/core/sync/sync-reconcile"));
});
afterEach(() => vi.unstubAllGlobals());

describe("quick-start cache refresh after a pull", () => {
  it("still rebuilds on the first sync after the app loads", async () => {
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toContain("products");
    expect(state.reads).toContain("customer_ledger");
  });

  it("skips an empty pull once the caches are current", async () => {
    await refreshBusinessCaches();
    state.reads = [];
    await refreshBusinessCaches({ onlyIfStale: true });
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toEqual([]);
  });

  it("rebuilds after a local change, a restore or a demo reset", async () => {
    for (const detail of [{ type: "bill", action: "created" }, { action: "local-backup-restored" }, undefined]) {
      await refreshBusinessCaches();
      state.reads = [];
      announce(detail);
      await refreshBusinessCaches({ onlyIfStale: true });
      expect(state.reads).toContain("bills");
    }
  });

  it("is not re-armed by sync's own announcements", async () => {
    await refreshBusinessCaches();
    state.reads = [];
    announce({ type: "sync", action: "pull", pulled: 3 });
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toEqual([]);
  });

  it("always rebuilds when the pull received changes or a push succeeded", async () => {
    await refreshBusinessCaches();
    state.reads = [];
    await refreshBusinessCaches();
    expect(state.reads).toContain("products");
  });

  it("stays stale when a rebuild fails, so the next quiet pull retries", async () => {
    await refreshBusinessCaches();
    announce({ type: "expense" });
    // The orphan cleanup's reads are the ones that do not swallow their errors.
    state.failNextRead = true;
    await expect(refreshBusinessCaches({ onlyIfStale: true })).rejects.toThrow("storage unavailable");
    state.reads = [];
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toContain("products");
  });
});
