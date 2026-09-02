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
  emitLocalDataChanged: vi.fn(),
  instantCacheUpdatedAt: () => 0,
  readIndexedRecentCache: vi.fn(async (key: string, fallback: unknown) => state.cached.has(key) ? state.cached.get(key) : fallback),
  readInstantCache: vi.fn((key: string, fallback: unknown) => state.memory.has(key) ? state.memory.get(key) : fallback),
  writeInstantCache: vi.fn((key: string, value: unknown) => { state.cached.set(key, value); state.memory.set(key, value); }),
}));

import { getExpiryAlerts, INVENTORY_LOT_CACHE_KEYS, listInventoryLots, listSellableBatches, reconcileCachedSellableBatches } from "@/features/core/inventory/inventory-lots-api";

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

  it("never reuses one branch's lot or expiry cache for another branch", async () => {
    const branchALots = [{ id: "lot-a", batchNumber: "A" }];
    const branchAAlerts = { totalCount: 1, totalValueAtRisk: 10, batches: branchALots };
    state.request.mockResolvedValueOnce(branchALots).mockResolvedValueOnce(branchAAlerts);
    await listInventoryLots({ locationId: "branch-a" });
    await getExpiryAlerts({ locationId: "branch-a" });
    state.browserOnline = false;
    await expect(listInventoryLots({ locationId: "branch-b" })).rejects.toMatchObject({ data: { code: "INVENTORY_LOT_CACHE_MISSING" } });
    await expect(getExpiryAlerts({ locationId: "branch-b" })).rejects.toMatchObject({ data: { code: "INVENTORY_LOT_CACHE_MISSING" } });
    await expect(listInventoryLots({ locationId: "branch-a" })).resolves.toEqual(branchALots);
    await expect(getExpiryAlerts({ locationId: "branch-a" })).resolves.toEqual(branchAAlerts);
  });

  it("reopens a product's batch choices after an offline restart", async () => {
    const batches = [{ id: "lot-1", batchNumber: "B-1", expiresOn: "2030-01-01", availableBaseQty: 5, mrp: 20 }];
    state.request.mockResolvedValueOnce(batches);
    await expect(listSellableBatches("product-1")).resolves.toEqual(batches);
    state.browserOnline = false;
    state.memory.clear();
    await expect(listSellableBatches("product-1")).resolves.toEqual(batches);
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it("updates cached FEFO quantities immediately after local movements", async () => {
    state.cached.set(INVENTORY_LOT_CACHE_KEYS.sellable("product-1"), [
      { id: "early", batchNumber: "EARLY", expiresOn: "2030-01-01", availableBaseQty: 2, mrp: 20 },
      { id: "late", batchNumber: "LATE", expiresOn: "2031-01-01", availableBaseQty: 4, mrp: 22 },
    ]);
    await reconcileCachedSellableBatches({ productId: "product-1", movementType: "sale", quantityBaseQty: 3 });
    expect(state.cached.get(INVENTORY_LOT_CACHE_KEYS.sellable("product-1"))).toEqual([
      { id: "late", batchNumber: "LATE", expiresOn: "2031-01-01", availableBaseQty: 3, mrp: 22 },
    ]);
    await reconcileCachedSellableBatches({ productId: "product-1", movementType: "purchase", quantityBaseQty: 5, batchNumber: "NEW", expiresOn: "2032-01-01", batchMrp: 25 });
    expect(state.cached.get(INVENTORY_LOT_CACHE_KEYS.sellable("product-1"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ batchNumber: "NEW", availableBaseQty: 5, mrp: 25, pendingSync: true }),
    ]));
  });

  it("decrements an explicitly selected batch instead of a different FEFO batch", async () => {
    state.cached.set(INVENTORY_LOT_CACHE_KEYS.sellable("product-1"), [
      { id: "early", batchNumber: "EARLY", expiresOn: "2030-01-01", availableBaseQty: 2, mrp: 20 },
      { id: "selected", batchNumber: "SELECTED", expiresOn: "2031-01-01", availableBaseQty: 4, mrp: 22 },
    ]);
    await reconcileCachedSellableBatches({ productId: "product-1", movementType: "sale", quantityBaseQty: 3, batchNumber: "SELECTED" });
    expect(state.cached.get(INVENTORY_LOT_CACHE_KEYS.sellable("product-1"))).toEqual([
      { id: "early", batchNumber: "EARLY", expiresOn: "2030-01-01", availableBaseQty: 2, mrp: 20 },
      { id: "selected", batchNumber: "SELECTED", expiresOn: "2031-01-01", availableBaseQty: 1, mrp: 22 },
    ]);
  });

  it("matches a server lot id when billing consumed a specifically selected batch", async () => {
    state.cached.set(INVENTORY_LOT_CACHE_KEYS.sellable("product-1"), [
      { id: "early", batchNumber: "SAME", expiresOn: "2030-01-01", availableBaseQty: 2, mrp: 20 },
      { id: "selected", batchNumber: "SAME", expiresOn: "2031-01-01", availableBaseQty: 4, mrp: 22 },
    ]);
    await reconcileCachedSellableBatches({ productId: "product-1", movementType: "sale", quantityBaseQty: 3, inventoryLotId: "selected" });
    expect(state.cached.get(INVENTORY_LOT_CACHE_KEYS.sellable("product-1"))).toEqual([
      { id: "early", batchNumber: "SAME", expiresOn: "2030-01-01", availableBaseQty: 2, mrp: 20 },
      { id: "selected", batchNumber: "SAME", expiresOn: "2031-01-01", availableBaseQty: 1, mrp: 22 },
    ]);
  });
});
