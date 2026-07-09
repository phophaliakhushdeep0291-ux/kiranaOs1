import { afterEach, describe, it, expect, vi } from "vitest";
import {
  loadCustomerCatalog,
  submitCustomerOrder,
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

describe("submitCustomerOrder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an idempotency key in the header and body so customer retries do not duplicate orders", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { orderId: "order_1", itemCount: 1, estimatedTotal: 42, shopName: "Test Kirana" },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitCustomerOrder(
      "shop1",
      { customerName: "Ramesh", customerMobile: "9876543210", customerAddress: "Market road" },
      [{ productId: "p1", qty: 2 }],
      "customer-order:shop1:test-key",
    );

    expect(result.orderId).toBe("order_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Idempotency-Key"]).toBe("customer-order:shop1:test-key");
    expect(JSON.parse(String(options.body))).toMatchObject({
      customerName: "Ramesh",
      idempotencyKey: "customer-order:shop1:test-key",
      items: [{ productId: "p1", qty: 2 }],
    });
  });
});
