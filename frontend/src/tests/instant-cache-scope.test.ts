import { describe, it, expect, beforeEach, vi } from "vitest";

// Drive the offline scope (which shop is "current") from the test.
const h = vi.hoisted(() => ({ store: "shopA" }));
vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: h.store, store_id: h.store, device_id: "dev" }),
  nowIso: () => new Date().toISOString(),
}));
// Stub the IndexedDB layer so this stays a pure in-memory test (no Dexie).
vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    putRecentCache: vi.fn(async () => {}),
    getRecentCache: vi.fn(async (_key: string, fallback: unknown) => fallback),
  },
}));

import { writeInstantCache, readInstantCache, clearInstantMemoryCache } from "@/lib/offline/instant-cache";

describe("instant cache is isolated per shop", () => {
  beforeEach(() => { h.store = "shopA"; clearInstantMemoryCache(); });

  it("never serves one shop's cached data to another shop on the same device", () => {
    h.store = "shopA";
    writeInstantCache("products", [{ id: "a1" }]);

    h.store = "shopB"; // a different shop logs in on the same device
    expect(readInstantCache("products", [])).toEqual([]); // must NOT see shop A's data
    writeInstantCache("products", [{ id: "b1" }]);
    expect(readInstantCache("products", [])).toEqual([{ id: "b1" }]);

    h.store = "shopA"; // shop A's cache is still its own
    expect(readInstantCache("products", [])).toEqual([{ id: "a1" }]);
  });

  it("clearInstantMemoryCache wipes everything (called on logout)", () => {
    writeInstantCache("bills", [{ id: "x" }]);
    clearInstantMemoryCache();
    expect(readInstantCache("bills", [])).toEqual([]);
  });
});
