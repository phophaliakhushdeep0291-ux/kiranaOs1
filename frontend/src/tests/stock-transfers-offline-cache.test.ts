import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  browserOnline: true,
  cached: new Map<string, unknown>(),
  memory: new Map<string, unknown>(),
  request: vi.fn(),
}));

vi.mock("@/lib/api/http", () => ({
  ApiClientError: class ApiClientError extends Error {
    data: Record<string, unknown>;
    constructor(message: string, public status: number, data: Record<string, unknown> = {}) { super(message); this.data = data; }
  },
  apiRequest: state.request,
  isBrowserOnline: () => state.browserOnline,
  isRecoverableNetworkError: (error: unknown) => !(error instanceof Error && "status" in error && Number((error as { status: number }).status) > 0 && Number((error as { status: number }).status) < 500),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  instantCacheUpdatedAt: () => 0,
  readIndexedRecentCache: vi.fn(async (key: string, fallback: unknown) => state.cached.has(key) ? state.cached.get(key) : fallback),
  readInstantCache: vi.fn((key: string, fallback: unknown) => state.memory.has(key) ? state.memory.get(key) : fallback),
  writeInstantCache: vi.fn((key: string, value: unknown) => { state.cached.set(key, value); state.memory.set(key, value); }),
}));

import {
  cacheStockTransferResource,
  getLocationInventory,
  getStoreLocations,
  listStockTransfers,
  STOCK_TRANSFER_CACHE_KEYS,
} from "@/features/core/inventory/stock-transfers-api";

describe("stock transfers offline cache", () => {
  beforeEach(() => {
    state.browserOnline = true;
    state.cached.clear();
    state.memory.clear();
    state.request.mockReset();
  });

  it("stores successful multi-store reads and serves them after an offline restart", async () => {
    const transfers = [{ id: "transfer-1", status: "in_transit" }];
    state.request.mockResolvedValueOnce(transfers);
    await expect(listStockTransfers<typeof transfers>()).resolves.toEqual(transfers);

    state.browserOnline = false;
    state.memory.clear();
    await expect(listStockTransfers<typeof transfers>()).resolves.toEqual(transfers);
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it("caches each branch inventory separately", async () => {
    const first = { location: { id: "branch-a" }, products: [{ id: "p1", stockBaseQty: 4 }] };
    const second = { location: { id: "branch-b" }, products: [{ id: "p1", stockBaseQty: 9 }] };
    state.request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await getLocationInventory<typeof first>("branch-a");
    await getLocationInventory<typeof second>("branch-b");
    expect(state.cached.get(STOCK_TRANSFER_CACHE_KEYS.locationInventory("branch-a"))).toEqual(first);
    expect(state.cached.get(STOCK_TRANSFER_CACHE_KEYS.locationInventory("branch-b"))).toEqual(second);
  });

  it("persists server-confirmed ledger updates immediately", () => {
    const next = [{ id: "transfer-2", status: "partially_received" }];
    expect(cacheStockTransferResource(STOCK_TRANSFER_CACHE_KEYS.transfers, next)).toEqual(next);
    expect(state.cached.get(STOCK_TRANSFER_CACHE_KEYS.transfers)).toEqual(next);
    expect(state.memory.get(STOCK_TRANSFER_CACHE_KEYS.transfers)).toEqual(next);
  });

  it("does not hide permission failures behind an old cache", async () => {
    const { ApiClientError } = await import("@/lib/api/http");
    state.cached.set(STOCK_TRANSFER_CACHE_KEYS.locations, { locations: [{ id: "old" }] });
    state.request.mockRejectedValueOnce(new ApiClientError("Forbidden", 403));
    await expect(getStoreLocations()).rejects.toThrow("Forbidden");
  });

  it("fails clearly when a resource was never cached on this device", async () => {
    state.browserOnline = false;
    await expect(getStoreLocations()).rejects.toMatchObject({ status: 0, data: { code: "STOCK_TRANSFER_CACHE_MISSING" } });
  });
});
