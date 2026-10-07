import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/products` answers with the whole catalogue, about 1.2 KB a product, and the
 * refresh after every sale re-ran the list on every counter showing Billing — the
 * seller twice, everyone else once. Stock changes and product edits already reach
 * each counter's IndexedDB through the live pull, so between full reads the list
 * answers from there.
 *
 * Runs the real loadProductList. Substituted: the API (counting reads), IndexedDB,
 * the instant cache, the location context and the clock.
 */

const h = vi.hoisted(() => ({
  serverReads: 0,
  serverRows: [] as Array<Record<string, unknown>>,
  localRows: [] as Array<Record<string, unknown>>,
  single: true,
  online: true,
  failNext: false,
}));

vi.mock("@/lib/api/http", () => ({
  ApiClientError: class extends Error {},
  isBrowserOnline: () => h.online,
  isRecoverableNetworkError: (error: unknown) => error instanceof Error && error.message === "offline",
}));
vi.mock("@/lib/offline/instant-cache", () => ({
  instantCacheUpdatedAt: () => 0,
  KEEP_EVERY_ROW: 0,
  readInstantCache: () => [],
  writeInstantCache: () => undefined,
}));
vi.mock("@/lib/offline/db", () => ({
  offlineDB: { getAll: async () => h.localRows, putMany: async () => undefined },
  dexieDB: { table: () => ({ bulkDelete: async () => undefined }) },
}));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }) }));
vi.mock("@/features/core/stores/location-context", () => ({
  getActiveLocationId: () => "loc-primary",
  isSingleLocationShop: () => h.single,
}));
vi.mock("@/features/core/products/api", () => ({
  listProducts: async () => {
    h.serverReads += 1;
    if (h.failNext) { h.failNext = false; throw new Error("offline"); }
    return h.serverRows;
  },
}));
vi.mock("@/features/core/products/local-actions", () => ({
  createProductLocalFirst: vi.fn(),
  deleteProductLocalFirst: vi.fn(),
  updateProductLocalFirst: vi.fn(),
}));

const NOW = new Date("2026-10-07T10:00:00.000Z").getTime();
const SUGAR = { id: "p-sugar", name: "Sugar 1kg", stockBaseQty: 99, inventoryLocationId: "loc-primary", sync_status: "synced" };
// Created on another counter and delivered by the pull, which does not add the
// server list's location tag.
const TEA = { id: "p-tea", name: "Tea 250g", stockBaseQty: 40, sync_status: "synced" };

let loadProductList: typeof import("@/features/core/products/queries").loadProductList;

describe("the catalogue's server reads", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    Object.assign(h, { serverReads: 0, serverRows: [{ ...SUGAR, stockBaseQty: 100 }], localRows: [SUGAR, TEA], single: true, online: true, failNext: false });
    ({ loadProductList } = await import("@/features/core/products/queries"));
  });

  afterEach(() => vi.useRealTimers());

  const names = (rows: Array<{ name?: string }>) => rows.map((row) => row.name).sort();
  const minutes = (n: number) => vi.setSystemTime(NOW + n * 60_000);

  it("reads the server once, then answers from the device for ten minutes", async () => {
    await loadProductList();
    expect(h.serverReads).toBe(1);

    minutes(5); // a sale's refresh, five minutes on
    const between = await loadProductList();
    expect(h.serverReads).toBe(1);
    // The device's own rows: the sale's stock change and the pulled product.
    expect(between.find((row) => row.id === "p-sugar")?.stockBaseQty).toBe(99);
    expect(names(between)).toEqual(["Sugar 1kg", "Tea 250g"]);

    minutes(10);
    await loadProductList();
    expect(h.serverReads).toBe(2);
  });

  it("shows a product another counter created, which arrives without a location tag", async () => {
    await loadProductList();
    minutes(1);
    expect(names(await loadProductList())).toContain("Tea 250g");
  });

  it("keeps reading the server in a shop with several locations, whose branch stock only it computes", async () => {
    h.single = false;
    await loadProductList();
    minutes(1);
    await loadProductList();
    expect(h.serverReads).toBe(2);
  });

  it("asks the server for a filtered list every time", async () => {
    await loadProductList();
    minutes(1);
    await loadProductList({ search: "sug" });
    await loadProductList({ lowStock: true });
    expect(h.serverReads).toBe(3);
  });

  it("asks the server while the device has no catalogue to answer with", async () => {
    h.localRows = [];
    await loadProductList();
    minutes(1);
    await loadProductList();
    expect(h.serverReads).toBe(2);
  });

  it("does not count a read that failed", async () => {
    h.failNext = true;
    expect(names(await loadProductList())).toEqual(["Sugar 1kg", "Tea 250g"]);
    minutes(1);
    await loadProductList();
    expect(h.serverReads).toBe(2);
  });

  it("answers from the device offline, as before", async () => {
    h.online = false;
    expect(names(await loadProductList())).toEqual(["Sugar 1kg", "Tea 250g"]);
    expect(h.serverReads).toBe(0);
  });
});

describe("whether the shop has a single location", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/features/core/stores/location-context");
    vi.doMock("@/lib/storage/auth-storage", () => ({ loadAuthSession: () => ({ shop: { id: "shop-a" } }) }));
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is unknown, not single, until the shop's locations have been seen", async () => {
    const location = await import("@/features/core/stores/location-context");
    expect(location.isSingleLocationShop()).toBe(false);
    location.cacheLocationCount(1);
    expect(location.isSingleLocationShop()).toBe(true);
    location.cacheLocationCount(2); // a branch was added
    expect(location.isSingleLocationShop()).toBe(false);
  });

  it("forgets the count when the answer only covered the branches a user may see", async () => {
    const location = await import("@/features/core/stores/location-context");
    location.cacheLocationCount(1);
    // A cashier scoped to one branch of a multi-branch shop is shown one location.
    location.cacheLocationCount(null);
    expect(location.isSingleLocationShop()).toBe(false);
  });
});
