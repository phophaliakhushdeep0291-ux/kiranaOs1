import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A cursor that claims data the device does not have.
 *
 * A cursor means "I have everything up to here". Until the server fix, a CASHIER
 * pull advanced the suppliers and expenses cursors while sending [] for them, and
 * cursors are keyed per device, not per user. So an owner signing in on a counter
 * machine a cashier had synced resumed AFTER rows they never received. Nothing
 * re-requested them: the supplier list and expense history were empty offline for
 * good, while sync reported it was up to date.
 *
 * The recovery sync now clears a cursor whose table is empty. It checks the mark
 * rather than the cause, so it also catches whatever else leaves one — and it
 * disarms itself, because once the table has rows the condition is false.
 */

const store = vi.hoisted(() => ({
  cursors: new Map<string, Record<string, unknown>>(),
  counts: new Map<string, number>(),
  deleted: [] as string[],
}));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    open: async () => undefined,
    table: (name: string) => (name === "sync_cursor"
      ? {
        get: async (id: string) => store.cursors.get(id),
        delete: async (id: string) => { store.deleted.push(id); store.cursors.delete(id); },
        count: async () => store.cursors.size,
      }
      : { count: async () => store.counts.get(name) ?? 0 }),
  },
  offlineDB: { init: async () => undefined, putMany: async () => undefined },
  assertCurrentOfflineScope: () => undefined,
}));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }) }));
vi.mock("@/lib/api/http", () => ({ apiRequest: async () => [] }));
vi.mock("@/lib/offline/instant-cache", () => ({ writeInstantCache: () => undefined, emitLocalDataChanged: () => undefined }));
vi.mock("@/features/core/sync/sync-reconcile", () => ({ refreshBusinessCaches: async () => undefined }));
vi.mock("@/features/core/sync/api", () => ({ syncPull: async () => ({ purchaseHistory: [], sync: {} }) }));
vi.mock("@/features/core/sync/sync-id-mapping", () => ({ loadIdMap: async () => ({}) }));
vi.mock("@/features/core/purchases/sync-guards", () => ({ loadPurchaseOverrideMatcher: async () => ({ keys: new Set() }), rowMatchesPurchaseOverride: () => false }));
vi.mock("@/features/core/subscription/access", () => ({ writeSubscriptionSnapshot: async () => 0 }));

import { hydrateFromBackendSnapshot } from "@/features/core/sync/cloud-hydration";

const OURS = { tenant_id: "t1", store_id: "s1" };

beforeEach(() => {
  store.cursors.clear();
  store.counts.clear();
  store.deleted = [];
});

describe("the recovery sync, on a cursor ahead of the data", () => {
  it("clears the cursor for a table the device was told it had filled", async () => {
    store.cursors.set("entity:suppliers", { ...OURS, cursor: "2026-09-01T00:00:00.000Z|abc" });
    store.counts.set("suppliers", 0);

    await hydrateFromBackendSnapshot();

    expect(store.deleted).toContain("entity:suppliers");
  });

  it("leaves a cursor alone once the table actually holds rows", async () => {
    store.cursors.set("entity:suppliers", { ...OURS, cursor: "2026-09-01T00:00:00.000Z|abc" });
    store.counts.set("suppliers", 12);

    await hydrateFromBackendSnapshot();

    // This is what stops the repair re-downloading on every manual sync.
    expect(store.deleted).toHaveLength(0);
  });

  it("does nothing for a shop that genuinely has no suppliers", async () => {
    // With no rows to return the server hands back the prior cursor, which is
    // null — so there is nothing set to clear and no repair to trigger.
    store.cursors.set("entity:suppliers", { ...OURS, cursor: null });
    store.counts.set("suppliers", 0);

    await hydrateFromBackendSnapshot();

    expect(store.deleted).toHaveLength(0);
  });

  it("will not touch another shop's cursor row", async () => {
    store.cursors.set("entity:suppliers", { tenant_id: "other", store_id: "s1", cursor: "x|y" });
    store.counts.set("suppliers", 0);

    await hydrateFromBackendSnapshot();

    expect(store.deleted).toHaveLength(0);
  });

  it("repairs expenses on the same rule", async () => {
    store.cursors.set("entity:expenses", { ...OURS, cursor: "2026-09-01T00:00:00.000Z|abc" });
    store.counts.set("expenses", 0);

    await hydrateFromBackendSnapshot();

    expect(store.deleted).toEqual(["entity:expenses"]);
  });

  it("does not take the recovery down when the cursor table cannot be read", async () => {
    store.cursors.set("entity:suppliers", { ...OURS, cursor: "x|y" });
    store.counts.set("suppliers", 0);
    const { dexieDB } = await import("@/lib/offline/db");
    const boom = vi.spyOn(dexieDB, "table").mockImplementationOnce(() => { throw new Error("idb closed"); });

    // The imports are the point of this function; a failed repair must not
    // throw away a hydration that otherwise worked.
    await expect(hydrateFromBackendSnapshot()).resolves.toBeDefined();
    boom.mockRestore();
  });
});
