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
  buildQuery: (params: Record<string, unknown>) => `?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()}`,
  isBrowserOnline: () => state.browserOnline,
  isRecoverableNetworkError: (error: unknown) => !(error instanceof Error && "status" in error && Number((error as { status: number }).status) > 0 && Number((error as { status: number }).status) < 500),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  instantCacheUpdatedAt: () => 0,
  readIndexedRecentCache: vi.fn(async (key: string, fallback: unknown) => state.cached.has(key) ? state.cached.get(key) : fallback),
  readInstantCache: vi.fn((key: string, fallback: unknown) => state.memory.has(key) ? state.memory.get(key) : fallback),
  writeInstantCache: vi.fn((key: string, value: unknown) => { state.cached.set(key, value); state.memory.set(key, value); }),
}));

import { createStockCount, getStockCount, getStockCounts, STOCK_COUNT_CACHE_KEYS } from "@/features/core/inventory/api";

const count = {
  id: "count-1", name: "Closing count", status: "counting", blindCount: true,
  locationId: "main", location: { id: "main", name: "Main", code: "MAIN" },
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  lines: [], summary: { totalLines: 0, countedLines: 0, remainingLines: 0, varianceLines: 0, netVarianceBaseQty: null },
} as const;

describe("stock counts offline cache", () => {
  beforeEach(() => { state.browserOnline = true; state.cached.clear(); state.memory.clear(); state.request.mockReset(); });

  it("reopens the saved count list and detail after an offline restart", async () => {
    state.request.mockResolvedValueOnce([count]).mockResolvedValueOnce(count);
    await expect(getStockCounts()).resolves.toEqual([count]);
    await expect(getStockCount(count.id)).resolves.toEqual(count);
    state.browserOnline = false;
    state.memory.clear();
    await expect(getStockCounts()).resolves.toEqual([count]);
    await expect(getStockCount(count.id)).resolves.toEqual(count);
    expect(state.request).toHaveBeenCalledTimes(2);
  });

  it("persists a server-confirmed new count before the refetch finishes", async () => {
    state.request.mockResolvedValueOnce(count);
    await expect(createStockCount({ name: count.name, blindCount: true })).resolves.toEqual(count);
    expect(state.cached.get(STOCK_COUNT_CACHE_KEYS.detail(count.id))).toEqual(count);
    expect(state.cached.get(STOCK_COUNT_CACHE_KEYS.list("all", 30))).toEqual([count]);
  });

  it("does not mask authorization errors with cached sessions", async () => {
    const { ApiClientError } = await import("@/lib/api/http");
    state.cached.set(STOCK_COUNT_CACHE_KEYS.list("all", 30), [count]);
    state.request.mockRejectedValueOnce(new ApiClientError("Forbidden", 403));
    await expect(getStockCounts()).rejects.toThrow("Forbidden");
  });

  it("reports a clear miss when this device never cached the count", async () => {
    state.browserOnline = false;
    await expect(getStockCount("missing")).rejects.toMatchObject({ status: 0, data: { code: "STOCK_COUNT_CACHE_MISSING" } });
  });
});
