import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  online: false,
  memory: new Map<string, unknown>(),
  persisted: new Map<string, unknown>(),
  getLedger: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: (options: unknown) => options,
}));
vi.mock("@/lib/api/http", async (original) => ({
  ...await original<typeof import("@/lib/api/http")>(),
  isBrowserOnline: () => state.online,
}));
vi.mock("@/features/core/inventory/api", () => ({ getStockLedger: state.getLedger }));
vi.mock("@/lib/offline/instant-cache", async (original) => ({
  ...await original<typeof import("@/lib/offline/instant-cache")>(),
  readInstantCache: (key: string, fallback: unknown) => state.memory.get(key) ?? fallback,
  hydrateInstantCacheFromIndexedDB: async (keys: string[]) => {
    for (const key of keys) if (state.persisted.has(key)) state.memory.set(key, state.persisted.get(key));
  },
  writeInstantCache: (key: string, value: unknown) => state.memory.set(key, value),
}));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { getAll: async () => [] } }));
vi.mock("@/features/core/inventory/local-actions", () => ({
  recordDamageLocalFirst: vi.fn(), recordPurchaseLocalFirst: vi.fn(),
  recordSaleLocalFirst: vi.fn(), stockCorrectionLocalFirst: vi.fn(),
}));

import { useGetStockLedger, type InventoryLedgerResponse } from "@/features/core/inventory/queries";
import { ApiClientError } from "@/lib/api/http";

function ledgerQuery() {
  return useGetStockLedger({ limit: 200 }) as unknown as { queryFn: () => Promise<InventoryLedgerResponse> };
}

beforeEach(() => {
  state.online = false;
  state.memory.clear();
  state.persisted.clear();
  state.getLedger.mockReset();
  state.persisted.set("products", [{ id: "soap" }]);
  state.persisted.set("inventory_movements", [
    { id: "sale-1", productId: "soap", action: "sale", changeBaseQty: -1, sync_status: "synced" },
    { id: "foreign-sale", productId: "other-shop-product", action: "sale", changeBaseQty: -10 },
  ]);
});

describe("stock history after a counter restart", () => {
  it("restores saved movements offline while excluding products outside the shop", async () => {
    const ledger = await ledgerQuery().queryFn();
    expect(ledger.total).toBe(1);
    expect(ledger.entries).toEqual([expect.objectContaining({ id: "sale-1", quantityDelta: -1 })]);
    expect(state.getLedger).not.toHaveBeenCalled();
  });

  it("retains persisted history when the browser is online but the API is unavailable", async () => {
    state.online = true;
    state.getLedger.mockRejectedValue(new ApiClientError("Unavailable", 503));
    expect((await ledgerQuery().queryFn()).entries).toHaveLength(1);
    expect(state.getLedger).toHaveBeenCalledOnce();
  });

  it("still replaces old synced history when the server confirms an empty ledger", async () => {
    state.online = true;
    state.getLedger.mockResolvedValue({ entries: [], total: 0 });
    expect((await ledgerQuery().queryFn()).entries).toEqual([]);
  });
});
