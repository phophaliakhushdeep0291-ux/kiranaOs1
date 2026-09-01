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
  buildQuery: (params: Record<string, unknown>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
    return query.size ? `?${query.toString()}` : "";
  },
  isBrowserOnline: () => state.browserOnline,
  isRecoverableNetworkError: (error: unknown) => !(error instanceof Error && "status" in error && Number((error as { status: number }).status) > 0 && Number((error as { status: number }).status) < 500),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  instantCacheUpdatedAt: () => 0,
  readIndexedRecentCache: vi.fn(async (key: string, fallback: unknown) => state.cached.has(key) ? state.cached.get(key) : fallback),
  readInstantCache: vi.fn((key: string, fallback: unknown) => state.memory.has(key) ? state.memory.get(key) : fallback),
  writeInstantCache: vi.fn((key: string, value: unknown) => { state.cached.set(key, value); state.memory.set(key, value); }),
}));

import { getExpiryAlerts, INVENTORY_LOT_CACHE_KEYS, listInventoryLots } from "@/features/core/inventory/inventory-lots-api";

describe("inventory lots offline cache", () => {
  beforeEach(() => { state.browserOnline = true; state.cached.clear(); state.memory.clear(); state.request.mockReset(); });

  it("reopens batch rows and expiry totals after an offline restart", async () => {
    const lots = [{ id: "lot-1", batchNumber: "B-1", status: "active" }];
    const alerts = { totalCount: 1, totalValueAtRisk: 200, batches: lots };
    state.request.mockResolvedValueOnce(lots).mockResolvedValueOnce(alerts);
    await expect(listInventoryLots()).resolves.toEqual(lots);
    await expect(getExpiryAlerts()).resolves.toEqual(alerts);
    state.browserOnline = false;
    state.memory.clear();
    await expect(listInventoryLots()).resolves.toEqual(lots);
    await expect(getExpiryAlerts()).resolves.toEqual(alerts);
    expect(state.request).toHaveBeenCalledTimes(2);
  });

  it("keeps status-filtered caches separate", async () => {
    const recalled = [{ id: "lot-r", status: "recalled" }];
    state.request.mockResolvedValueOnce(recalled);
    await listInventoryLots({ status: "recalled" });
    expect(state.cached.get(INVENTORY_LOT_CACHE_KEYS.list("recalled"))).toEqual(recalled);
    expect(state.cached.has(INVENTORY_LOT_CACHE_KEYS.list("all"))).toBe(false);
  });

  it("does not hide permission errors behind cached batch data", async () => {
    const { ApiClientError } = await import("@/lib/api/http");
    state.cached.set(INVENTORY_LOT_CACHE_KEYS.list("all"), [{ id: "old" }]);
    state.request.mockRejectedValueOnce(new ApiClientError("Forbidden", 403));
    await expect(listInventoryLots()).rejects.toThrow("Forbidden");
  });

  it("reports a clear miss when batches were never cached", async () => {
    state.browserOnline = false;
    await expect(listInventoryLots()).rejects.toMatchObject({ status: 0, data: { code: "INVENTORY_LOT_CACHE_MISSING" } });
  });
});
