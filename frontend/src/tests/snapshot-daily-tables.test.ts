import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every ten minutes, on every counter, the routine snapshot re-read the whole
 * catalogue with its stock, every customer and udhar entry (up to 5,000 rows each),
 * and re-pulled purchase history from its first row — all of it already delivered
 * by the incremental pull. Each table is now read in full once a day per device,
 * and on every explicit repair.
 *
 * Runs the real hydrateFromBackendSnapshot. Substituted: the API and sync pull
 * (recording what was asked for), IndexedDB, localStorage and the clock.
 */

const h = vi.hoisted(() => ({
  requests: [] as string[],
  failing: new Set<string>(),
  emptyTables: new Set<string>(),
  user: { id: "cashier-1", role: "cashier" } as { id: string; role: string },
}));

function record(url: string) {
  h.requests.push(url);
  const table = url.split("?")[0];
  if (h.failing.has(table)) { h.failing.delete(table); throw new Error(`${table} unavailable`); }
}

vi.mock("@/lib/api/http", () => ({
  apiRequest: async (url: string) => {
    record(url);
    if (url.startsWith("/bills?")) return { bills: [], total: 0 };
    if (url.startsWith("/udhar?")) return { entries: [] };
    return [];
  },
}));
vi.mock("@/features/core/sync/api", () => ({
  syncPull: async () => {
    record("/sync/pull#purchaseHistory");
    return { purchaseHistory: [], sync: {} };
  },
}));
vi.mock("@/lib/storage/auth-storage", () => ({ loadAuthSession: () => ({ user: h.user }) }));
vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    open: async () => undefined,
    table: (name: string) => ({
      count: async () => 0,
      get: async () => undefined,
      where: () => ({ equals: () => ({ count: async () => (h.emptyTables.has(name) ? 0 : 3) }) }),
    }),
    customer_ledger: { filter: () => ({ primaryKeys: async () => [] }), bulkDelete: async () => undefined },
  },
  offlineDB: {
    init: async () => undefined,
    getAll: async () => [],
    putMany: async () => undefined,
    replaceSyncedSnapshot: async () => undefined,
    removeOrphans: async () => undefined,
  },
  assertCurrentOfflineScope: () => undefined,
}));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }) }));
vi.mock("@/lib/offline/instant-cache", () => ({ writeInstantCache: () => undefined, emitLocalDataChanged: () => undefined }));
vi.mock("@/features/core/sync/sync-reconcile", () => ({ refreshBusinessCaches: async () => undefined }));
vi.mock("@/features/core/sync/sync-id-mapping", () => ({ loadIdMap: async () => ({}) }));
vi.mock("@/features/core/purchases/sync-guards", () => ({ loadPurchaseOverrideMatcher: async () => ({ keys: new Set() }), rowMatchesPurchaseOverride: () => false }));
vi.mock("@/features/core/subscription/access", () => ({ writeSubscriptionSnapshot: async () => 0 }));

import { hydrateFromBackendSnapshot } from "@/features/core/sync/cloud-hydration";

const NOW = new Date("2026-10-07T10:00:00.000Z").getTime();
const FULL_TABLES = ["/products", "/customers", "/udhar", "/inventory", "/sync/pull#purchaseHistory"];

/** Which of the full-table reads a snapshot made, and which bill window it asked for. */
async function snapshot(options?: { routine?: boolean }) {
  h.requests = [];
  const result = await hydrateFromBackendSnapshot(options);
  const tables = FULL_TABLES.filter((table) => h.requests.some((url) => url.split("?")[0] === table));
  const bills = h.requests.find((url) => url.startsWith("/bills?"))?.match(/from=([\d-]+)/)?.[1];
  return { tables, bills, result };
}

describe("the tables a routine snapshot reads in full", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    });
    h.failing.clear();
    h.emptyTables.clear();
    h.user = { id: "cashier-1", role: "cashier" };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads every table on a device with no record, then none of them ten minutes later", async () => {
    expect((await snapshot({ routine: true })).tables).toEqual(FULL_TABLES);

    vi.setSystemTime(NOW + 10 * 60_000);
    const next = await snapshot({ routine: true });
    expect(next.tables).toEqual([]);
    // What still runs: the subscription and the recent bill window.
    expect(next.bills).toBe("2026-10-04");
    expect(h.requests).toContain("/subscription/current");
  });

  it("reports a skipped table as nothing read, not as a failure", async () => {
    await snapshot({ routine: true });
    const { result } = await snapshot({ routine: true });
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({ products: 0, customers: 0, inventoryProducts: 0, udharLedger: 0, purchaseHistory: 0 });
  });

  it("reads each table in full again once a day has passed", async () => {
    await snapshot({ routine: true });
    vi.setSystemTime(NOW + 23 * 60 * 60_000);
    expect((await snapshot({ routine: true })).tables).toEqual([]);
    vi.setSystemTime(NOW + 24 * 60 * 60_000);
    expect((await snapshot({ routine: true })).tables).toEqual(FULL_TABLES);
  });

  it("reads every table for an explicit repair, however recent the last one", async () => {
    await snapshot({ routine: true });
    // Sign-in bootstrap, Sync now and remote support call it without `routine`.
    expect((await snapshot()).tables).toEqual(FULL_TABLES);
  });

  it("reads again only the table whose full read failed", async () => {
    h.failing.add("/customers");
    const first = await snapshot({ routine: true });
    expect(first.result.errors.map((error) => error.label)).toEqual(["customers"]);
    vi.setSystemTime(NOW + 10 * 60_000);
    expect((await snapshot({ routine: true })).tables).toEqual(["/customers"]);
  });

  it("keeps inventory with the products read", async () => {
    h.failing.add("/inventory");
    await snapshot({ routine: true });
    vi.setSystemTime(NOW + 10 * 60_000);
    // Inventory merges stock onto products; it is not a table of its own here.
    expect((await snapshot({ routine: true })).tables).toEqual([]);
  });

  it("reads a table in full whenever the device holds none of it, whatever the record says", async () => {
    await snapshot({ routine: true });
    // A local reset cleared IndexedDB and left localStorage behind.
    h.emptyTables.add("products");
    h.emptyTables.add("customer_ledger");
    vi.setSystemTime(NOW + 10 * 60_000);
    expect((await snapshot({ routine: true })).tables).toEqual(["/products", "/udhar", "/inventory"]);
  });

  it("gives a different user or role on the same counter a full read of their own", async () => {
    await snapshot({ routine: true }); // the cashier's
    vi.setSystemTime(NOW + 10 * 60_000);
    // The owner signs in: the cashier's rows were sent without cost fields.
    h.user = { id: "owner-1", role: "owner" };
    expect((await snapshot({ routine: true })).tables).toEqual(FULL_TABLES);
    h.user = { id: "cashier-1", role: "cashier" };
    expect((await snapshot({ routine: true })).tables).toEqual([]);
    // Same person, new role.
    h.user = { id: "cashier-1", role: "manager" };
    expect((await snapshot({ routine: true })).tables).toEqual(FULL_TABLES);
  });

  it("reads every table when the device cannot keep the record", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    });
    await snapshot({ routine: true });
    expect((await snapshot({ routine: true })).tables).toEqual(FULL_TABLES);
  });
});
