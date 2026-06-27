import { describe, it, expect, vi } from "vitest";
import {
  loadCustomerCatalog,
  CatalogUnavailableError,
  type CustomerCatalog,
  type CatalogStorage,
} from "@/features/customer-order/catalog";

function makeCatalog(name = "Ramesh Kirana"): CustomerCatalog {
  return {
    shop: { id: "shop1", name, city: "Pune" },
    products: [{ id: "p1", name: "Salt", category: null, unit: "packet", price: 28, mrp: 30, imageUrl: null }],
    cachedAt: new Date().toISOString(),
  };
}

function memoryStorage(seed?: Record<string, CustomerCatalog>): CatalogStorage {
  const map = new Map<string, CustomerCatalog>(Object.entries(seed ?? {}));
  return {
    read: (code) => map.get(code) ?? null,
    write: (code, cat) => void map.set(code, cat),
    remove: (code) => void map.delete(code),
  };
}

describe("loadCustomerCatalog", () => {
  it("fetches from the network and refreshes the cache when online", async () => {
    const storage = memoryStorage();
    const fresh = makeCatalog();
    const fetcher = vi.fn().mockResolvedValue(fresh);

    const result = await loadCustomerCatalog("shop1", { fetcher, storage });

    expect(result.source).toBe("network");
    expect(result.catalog).toBe(fresh);
    expect(storage.read("shop1")).toEqual(fresh); // cache was written
  });

  it("falls back to the cached catalog when the network fails (offline)", async () => {
    const cached = makeCatalog("Cached Shop");
    const storage = memoryStorage({ shop1: cached });
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await loadCustomerCatalog("shop1", { fetcher, storage });

    expect(result.source).toBe("cache");
    expect(result.catalog).toEqual(cached);
  });

  it("throws when the network fails and there is no cache", async () => {
    const storage = memoryStorage();
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(loadCustomerCatalog("shop1", { fetcher, storage })).rejects.toThrow(/offline/);
  });

  it("clears the cache and propagates when the shop disabled ordering (404)", async () => {
    const storage = memoryStorage({ shop1: makeCatalog() });
    const fetcher = vi.fn().mockRejectedValue(new CatalogUnavailableError());

    await expect(loadCustomerCatalog("shop1", { fetcher, storage })).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect(storage.read("shop1")).toBeNull(); // stale storefront must not linger
  });
});
