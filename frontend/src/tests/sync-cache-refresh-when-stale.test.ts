import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every sync cycle ends its pull by rebuilding the screens' quick-start caches,
 * which reads most of the offline database. An idle counter used to do that
 * every 2.5 to 45 seconds with nothing new to show. A pull that received
 * nothing now skips it unless something changed locally since the last one.
 */
const state = vi.hoisted(() => ({ reads: [] as string[], failNextRead: false, onRead: undefined as (() => void) | undefined }));

vi.mock("@/lib/offline/db", () => ({
  assertCurrentOfflineScope: () => undefined,
  dexieDB: {},
  offlineDB: {
    getAll: vi.fn(async (table: string) => {
      state.reads.push(table);
      const notify = state.onRead; state.onRead = undefined; notify?.();
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
  state.reads = []; state.failNextRead = false; state.onRead = undefined;
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
    announce({ type: "product" });
    // The orphan cleanup's reads are the ones that do not swallow their errors.
    state.failNextRead = true;
    await expect(refreshBusinessCaches({ onlyIfStale: true })).rejects.toThrow("storage unavailable");
    state.reads = [];
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toContain("products");
  });
});


describe("only the affected business caches rebuild", () => {
  it("reads each table once during a full recovery, sharing parent and ledger reads", async () => {
    await refreshBusinessCaches();
    expect(state.reads).toHaveLength(9);
    expect(new Set(state.reads).size).toBe(9);
  });
  it("refreshes two supplier caches without scanning sales or the catalogue", async () => {
    await refreshBusinessCaches(); state.reads = [];
    await refreshBusinessCaches({ affectedEntities: ["supplier"] });
    expect(state.reads.sort()).toEqual(["purchase_bills", "suppliers"]);
  });
  it("expense-only sync avoids all eight unrelated business caches", async () => {
    await refreshBusinessCaches(); state.reads = [];
    announce({ type: "expense" });
    await refreshBusinessCaches({ affectedEntities: ["expense"] });
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toEqual([]);
  });
  it("a bill still refreshes stock, children, money and balances but not supplier history", async () => {
    await refreshBusinessCaches(); state.reads = [];
    await refreshBusinessCaches({ affectedEntities: ["bill"] });
    expect(new Set(state.reads)).toEqual(new Set(["products", "inventory_movements", "bills", "payments", "customers", "customer_ledger", "id_mappings"]));
    expect(state.reads).toHaveLength(7);
  });
  it("an unknown entity and an untyped restore both retain the full recovery", async () => {
    await refreshBusinessCaches(); state.reads = [];
    await refreshBusinessCaches({ affectedEntities: ["future_entity"] });
    expect(state.reads).toHaveLength(9);
    state.reads = []; announce({ action: "local-backup-restored" });
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toHaveLength(9);
  });
  it("does not lose changes arriving during a rebuild", async () => {
    await refreshBusinessCaches(); state.reads = [];
    state.onRead = () => announce({ type: "bill" });
    await refreshBusinessCaches({ affectedEntities: ["supplier"] });
    state.reads = [];
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads).toContain("bills"); expect(state.reads).toContain("customer_ledger");
  });
  it("retries precisely the failed caches on a later quiet pull", async () => {
    await refreshBusinessCaches(); state.reads = []; state.failNextRead = true;
    await expect(refreshBusinessCaches({ affectedEntities: ["supplier"] })).rejects.toThrow("storage unavailable");
    state.reads = [];
    await refreshBusinessCaches({ onlyIfStale: true });
    expect(state.reads.sort()).toEqual(["purchase_bills", "suppliers"]);
  });
});
