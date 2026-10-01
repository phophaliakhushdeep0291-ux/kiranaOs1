import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A lean list row must not empty a cached bill.
 *
 * The bills screen now asks for `view=list`: twenty columns and a COUNT of the
 * lines instead of the lines. Those rows go through cacheBills() like any other,
 * and that cache is not paint — it is the offline copy. loadBillDetail never
 * calls GET /bills/:id; it reads IndexedDB. The same rows are what the reprinted
 * receipt, the WhatsApp share and the cancel dialog use with no internet.
 *
 * So writing a lean row over a cached rich one would take a bill's lines away,
 * and nothing would say so until a customer asked for a duplicate receipt in a
 * power cut. That is the failure this file exists to prevent.
 */

const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], written: [] as Record<string, unknown>[] }));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: async () => store.rows,
    putMany: async (_table: string, rows: Record<string, unknown>[]) => { store.written = rows; },
    pruneStoreOlderThan: async () => undefined,
  },
}));
vi.mock("@/lib/offline/instant-cache", () => ({
  RECENT_CACHE_DAYS: 30,
  pruneRecentRows: <T,>(rows: T[]) => rows,
  instantCacheUpdatedAt: () => Date.now(),
  readInstantCache: () => [],
  writeInstantCache: () => undefined,
}));

import { cacheBills } from "@/features/core/bills/queries";
import type { Bill } from "@/types/api";

const RICH = {
  id: "bill-1",
  billNo: "KOS-2026-000001",
  clientBillId: "client-1",
  idempotencyKey: "idem-1",
  status: "active",
  grandTotal: 540,
  paidAmount: 540,
  businessDate: new Date().toISOString(),
  items: [
    { id: "line-1", name: "Parle-G", quantity: 3, lineTotal: 30, ratePerRateUnit: 10 },
    { id: "line-2", name: "Tata Salt", quantity: 1, lineTotal: 28, ratePerRateUnit: 28 },
  ],
  payments: [{ id: "pay-1", mode: "cash", amount: 540, status: "confirmed", provider: null }],
};

// What view=list sends: no items, a count, payments narrowed to mode+amount.
const LEAN = {
  id: "bill-1",
  billNo: "KOS-2026-000001",
  clientBillId: "client-1",
  idempotencyKey: "idem-1",
  status: "cancelled",          // a scalar that genuinely changed
  grandTotal: 540,
  paidAmount: 540,
  businessDate: RICH.businessDate,
  itemCount: 2,
  payments: [{ mode: "cash", amount: 540 }],
};

beforeEach(() => { store.rows = []; store.written = []; });

describe("caching a lean bills-list row", () => {
  it("keeps the lines the offline receipt prints", async () => {
    store.rows = [{ ...RICH }];
    await cacheBills([LEAN as unknown as Bill], { lean: true });

    const written = store.written.find((row) => row.id === "bill-1");
    expect(written).toBeDefined();
    expect(written?.items).toHaveLength(2);
    expect((written?.items as Array<{ name: string }>)[0].name).toBe("Parle-G");
  });

  it("keeps the full payment rows, not the two columns the screen needed", async () => {
    store.rows = [{ ...RICH }];
    await cacheBills([LEAN as unknown as Bill], { lean: true });

    const payments = store.written.find((row) => row.id === "bill-1")?.payments as Array<Record<string, unknown>>;
    expect(payments[0].status).toBe("confirmed");
    expect(payments[0].id).toBe("pay-1");
  });

  it("still applies the scalars the lean row came to deliver", async () => {
    store.rows = [{ ...RICH }];
    await cacheBills([LEAN as unknown as Bill], { lean: true });

    const written = store.written.find((row) => row.id === "bill-1");
    // The bill was cancelled since the rich copy was cached. That has to land,
    // or the screen keeps showing a cancelled sale as active.
    expect(written?.status).toBe("cancelled");
    expect(written?.itemCount).toBe(2);
  });

  it("matches the prior copy on client identity, not only on id", async () => {
    // A bill the till created offline is cached under its client id and gets a
    // server id later. Matching on `id` alone would miss it and wipe its lines.
    store.rows = [{ ...RICH, id: "local-uuid", server_id: "bill-1" }];
    await cacheBills([LEAN as unknown as Bill], { lean: true });

    const written = store.written.find((row) => String(row.id) === "bill-1" || String(row.server_id) === "bill-1");
    expect(written?.items).toHaveLength(2);
  });

  it("caches a bill it has never seen without inventing relations", async () => {
    store.rows = [];
    await cacheBills([LEAN as unknown as Bill], { lean: true });

    const written = store.written.find((row) => row.id === "bill-1");
    expect(written).toBeDefined();
    expect(written?.items).toBeUndefined();
    expect(written?.itemCount).toBe(2);
  });

  it("leaves the full hydration path alone", async () => {
    // The cache warm still asks for view=full and must overwrite wholesale —
    // that is the copy everything else is protecting.
    store.rows = [{ ...RICH, items: [{ id: "stale", name: "Old line", quantity: 1, lineTotal: 1 }] }];
    await cacheBills([RICH as unknown as Bill]);

    const items = store.written.find((row) => row.id === "bill-1")?.items as Array<{ name: string }>;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Parle-G");
  });
});
