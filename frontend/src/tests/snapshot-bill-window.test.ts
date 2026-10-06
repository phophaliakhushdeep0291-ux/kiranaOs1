import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The routine snapshot used to read two years of bills, every ten minutes, on
 * every counter. Every bill carries its lines and payments, so a till doing a
 * hundred bills a day reached the 20,000-bill paging cap and downloaded it six
 * times an hour — while the incremental pull was already delivering each change.
 *
 * Runs the real hydrateFromBackendSnapshot. Substituted: the API (recording which
 * bill window was asked for), IndexedDB, localStorage and the clock.
 */

const h = vi.hoisted(() => ({
  billRequests: [] as string[],
  replaced: [] as string[],
  written: [] as string[],
  cached: [] as string[],
  page: { bills: [] as unknown[], total: 0 },
  failBills: false,
}));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: { open: async () => undefined, table: () => ({ count: async () => 0, get: async () => undefined }) },
  offlineDB: {
    init: async () => undefined,
    getAll: async () => [],
    putMany: async (table: string) => { h.written.push(table); },
    replaceSyncedSnapshot: async (table: string) => { h.replaced.push(table); },
    removeOrphans: async () => undefined,
  },
  assertCurrentOfflineScope: () => undefined,
}));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }) }));
vi.mock("@/lib/api/http", () => ({
  apiRequest: async (url: string) => {
    if (!url.startsWith("/bills?")) return [];
    h.billRequests.push(url);
    if (h.failBills) throw new Error("Network unavailable");
    return h.page;
  },
}));
vi.mock("@/lib/offline/instant-cache", () => ({
  writeInstantCache: (key: string) => { h.cached.push(key); },
  emitLocalDataChanged: () => undefined,
}));
vi.mock("@/features/core/sync/sync-reconcile", () => ({ refreshBusinessCaches: async () => undefined }));
vi.mock("@/features/core/sync/api", () => ({ syncPull: async () => ({ purchaseHistory: [], sync: {} }) }));
vi.mock("@/features/core/sync/sync-id-mapping", () => ({ loadIdMap: async () => ({}) }));
vi.mock("@/features/core/purchases/sync-guards", () => ({ loadPurchaseOverrideMatcher: async () => ({ keys: new Set() }), rowMatchesPurchaseOverride: () => false }));
vi.mock("@/features/core/subscription/access", () => ({ writeSubscriptionSnapshot: async () => 0 }));

import { hydrateFromBackendSnapshot } from "@/features/core/sync/cloud-hydration";

const NOW = new Date("2026-10-06T10:00:00.000Z");
const FULL_FROM = "from=2024-10-06";
const RECENT_FROM = "from=2026-10-03";
const BILL = { id: "bill-1", businessDate: "2026-10-05T09:00:00.000Z", items: [], payments: [] };

/** The bill window the last snapshot asked for, and what it did with the result. */
async function snapshot(options?: { routine?: boolean }) {
  h.billRequests = [];
  h.replaced = [];
  h.written = [];
  h.cached = [];
  await hydrateFromBackendSnapshot(options);
  return {
    from: h.billRequests[0]?.match(/from=[\d-]+/)?.[0],
    pages: h.billRequests.length,
    quarantined: h.replaced.includes("bills"),
    wroteBills: h.written.includes("bills"),
    cachedBills: h.cached.includes("bills"),
  };
}

describe("the bills a snapshot reads", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    });
    h.page = { bills: [BILL], total: 1 };
    h.failBills = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads two years on a device with no full read on record, then only recent days", async () => {
    const first = await snapshot({ routine: true });
    expect(first).toMatchObject({ from: FULL_FROM, quarantined: true, cachedBills: true });

    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
    const next = await snapshot({ routine: true });
    expect(next.from).toBe(RECENT_FROM);
  });

  it("writes what a recent window fetched, and removes nothing", async () => {
    await snapshot({ routine: true });
    const recent = await snapshot({ routine: true });
    expect(recent.from).toBe(RECENT_FROM);
    // Quarantine removes synced bills the answer lacks. The recent window's edge
    // moves every day, so it must never be the one allowed to do that.
    expect(recent.quarantined).toBe(false);
    expect(recent.wroteBills).toBe(true);
    // Three days of bills is not the bills cache; the rebuild after the snapshot is.
    expect(recent.cachedBills).toBe(false);
  });

  it("goes back to the full read once a day has passed", async () => {
    await snapshot({ routine: true });
    vi.setSystemTime(new Date(NOW.getTime() + 23 * 60 * 60_000));
    expect((await snapshot({ routine: true })).from).toBe(RECENT_FROM.replace("10-03", "10-04"));
    vi.setSystemTime(new Date(NOW.getTime() + 24 * 60 * 60_000));
    expect((await snapshot({ routine: true })).from).toBe("from=2024-10-07");
  });

  it("reads the full window for every explicit repair, however recent the last one", async () => {
    await snapshot({ routine: true });
    // Sign-in bootstrap, Sync now and remote support call it without `routine`.
    expect((await snapshot()).from).toBe(FULL_FROM);
  });

  it("counts a full read the paging cap cut short, or a large shop would repeat it every time", async () => {
    h.page = { bills: Array.from({ length: 2000 }, (_, i) => ({ ...BILL, id: `bill-${i}` })), total: 30_000 };
    const capped = await snapshot({ routine: true });
    expect(capped).toMatchObject({ from: FULL_FROM, pages: 10, quarantined: false });

    h.page = { bills: [BILL], total: 1 };
    expect((await snapshot({ routine: true })).from).toBe(RECENT_FROM);
  });

  it("tries the full read again when it failed", async () => {
    h.failBills = true;
    expect((await snapshot({ routine: true })).from).toBe(FULL_FROM);
    h.failBills = false;
    expect((await snapshot({ routine: true })).from).toBe(FULL_FROM);
    expect((await snapshot({ routine: true })).from).toBe(RECENT_FROM);
  });

  it("falls back to the full read when the device cannot store the record", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    });
    expect((await snapshot({ routine: true })).from).toBe(FULL_FROM);
    expect((await snapshot({ routine: true })).from).toBe(FULL_FROM);
  });
});
