import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ shop: "shop-a", get: vi.fn(), put: vi.fn(async () => {}) }));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: state.shop, store_id: state.shop, device_id: "device" }) }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { getRecentCache: state.get, putRecentCache: state.put } }));
import { clearInstantMemoryCache, hydrateInstantCacheFromIndexedDB, readIndexedRecentCache, readInstantCache, writeInstantMemoryCache } from "@/lib/offline/instant-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { state.shop = "shop-a"; vi.clearAllMocks(); clearInstantMemoryCache(); });

describe("concurrent instant-cache hydration", () => {
  it("shares one IndexedDB read across 100 concurrent readers", async () => {
    const pending = deferred<unknown>();
    state.get.mockReturnValue(pending.promise);
    const readers = Array.from({ length: 100 }, () => readIndexedRecentCache("products", []));
    pending.resolve([{ id: "a1" }]);
    expect(await Promise.all(readers)).toEqual(Array.from({ length: 100 }, () => [{ id: "a1" }]));
    expect(state.get).toHaveBeenCalledTimes(1);
  });

  it("shares overlapping batch and individual hydration", async () => {
    const pending = deferred<unknown>();
    state.get.mockReturnValue(pending.promise);
    const batch = hydrateInstantCacheFromIndexedDB(["products", "products"]);
    const one = readIndexedRecentCache("products", []);
    pending.resolve([{ id: "a1" }]);
    await Promise.all([batch, one]);
    expect(state.get).toHaveBeenCalledTimes(1);
  });

  it("does not cache an old shop's in-flight rows into the new shop", async () => {
    const pending = deferred<unknown>();
    state.get.mockReturnValue(pending.promise);
    const one = readIndexedRecentCache("products", []);
    state.shop = "shop-b";
    pending.resolve([{ id: "a1" }]);
    expect(await one).toEqual([]);
    expect(readInstantCache("products", [])).toEqual([]);
  });

  it("does not repopulate memory after logout clears it", async () => {
    const pending = deferred<unknown>();
    state.get.mockReturnValue(pending.promise);
    const batch = hydrateInstantCacheFromIndexedDB(["products"]);
    clearInstantMemoryCache();
    pending.resolve([{ id: "a1" }]);
    await batch;
    expect(readInstantCache("products", [])).toEqual([]);
  });

  it("does not replace a fresh local write with an older hydrated snapshot", async () => {
    const pending = deferred<unknown>();
    state.get.mockReturnValue(pending.promise);
    const one = readIndexedRecentCache("products", []);
    writeInstantMemoryCache("products", [{ id: "new" }]);
    const lateReader = readIndexedRecentCache("products", []);
    pending.resolve([{ id: "old" }]);
    expect(await lateReader).toEqual([{ id: "new" }]);
    expect(await one).toEqual([{ id: "new" }]);
    expect(readInstantCache("products", [])).toEqual([{ id: "new" }]);
  });

  it("releases failed reads so the next request can retry", async () => {
    state.get.mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValueOnce([{ id: "recovered" }]);
    expect(await readIndexedRecentCache("products", [])).toEqual([]);
    expect(await readIndexedRecentCache("products", [])).toEqual([{ id: "recovered" }]);
    expect(state.get).toHaveBeenCalledTimes(2);
  });

  it("keeps caller fallbacks separate for a missing cache key", async () => {
    state.get.mockResolvedValue(undefined);
    const results = await Promise.all([readIndexedRecentCache("missing", ["a"]), readIndexedRecentCache("missing", ["b"])]);
    expect(results).toEqual([["a"], ["b"]]);
  });
});
