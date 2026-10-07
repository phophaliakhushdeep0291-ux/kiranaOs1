import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateLedgerBalance } from "@/features/core/ledger/accounting";
import type { CustomerLedgerEntry } from "@/types/api";

/**
 * The snapshot's udhar import asked `/udhar` for 5,000 rows, which answers newest
 * first, then deleted every synced ledger row on the device and wrote those 5,000
 * back. A shop past 5,000 entries therefore lost its oldest udhar from every device
 * at each snapshot — and the pull never re-sends what is behind its cursor. Local
 * balances are a sum over the device's entries, so they came out short: offline
 * Billing, receipts printed offline and the cached customer rows all read them.
 *
 * Runs the real import (via resyncUdharLedgerFromServer). Substituted: the API,
 * answering a page at a time newest-first as the server does, and IndexedDB.
 */

const h = vi.hoisted(() => ({
  server: [] as Array<Record<string, unknown>>,
  totalOverride: null as number | null,
  device: new Map<string, Record<string, unknown>>(),
  requests: [] as string[],
}));

vi.mock("@/lib/api/http", () => ({
  apiRequest: async (url: string) => {
    h.requests.push(url);
    const params = new URL(url, "http://local").searchParams;
    const limit = Number(params.get("limit") ?? 100);
    const page = Number(params.get("page") ?? 1);
    const total = h.totalOverride ?? h.server.length;
    return { entries: h.server.slice((page - 1) * limit, page * limit), total, page, limit };
  },
}));
vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    customer_ledger: {
      filter: (match: (row: Record<string, unknown>) => boolean) => ({
        primaryKeys: async () => [...h.device.values()].filter(match).map((row) => row.id),
      }),
      bulkDelete: async (keys: string[]) => { keys.forEach((key) => h.device.delete(key)); },
    },
  },
  offlineDB: {
    putMany: async (_table: string, rows: Array<Record<string, unknown>>) => {
      for (const row of rows) h.device.set(String(row.id), { tenant_id: "t1", store_id: "s1", ...row });
    },
  },
  assertCurrentOfflineScope: () => undefined,
}));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }) }));
vi.mock("@/lib/offline/instant-cache", () => ({ writeInstantCache: () => undefined, emitLocalDataChanged: () => undefined }));
vi.mock("@/features/core/sync/sync-reconcile", () => ({ refreshBusinessCaches: async () => undefined }));
vi.mock("@/features/core/sync/api", () => ({ syncPull: async () => ({}) }));
vi.mock("@/features/core/sync/sync-id-mapping", () => ({ loadIdMap: async () => ({}) }));
vi.mock("@/features/core/purchases/sync-guards", () => ({ loadPurchaseOverrideMatcher: async () => ({ keys: new Set() }), rowMatchesPurchaseOverride: () => false }));
vi.mock("@/features/core/subscription/access", () => ({ writeSubscriptionSnapshot: async () => 0 }));

import { resyncUdharLedgerFromServer } from "@/features/core/sync/cloud-hydration";

/** `count` udhar entries for one customer, newest first, as /udhar orders them. */
function ledger(count: number, customerId = "c-ramesh") {
  return Array.from({ length: count }, (_, i) => {
    const n = count - i;
    const day = new Date(Date.UTC(2025, 0, 1) + n * 3_600_000).toISOString();
    return {
      id: `led-${customerId}-${n}`,
      customerId,
      customer_id: customerId,
      type: n % 3 === 0 ? "payment" : "debit",
      amount: n % 3 === 0 ? 30 : 50,
      businessDate: day,
      createdAt: day,
      sync_status: "synced",
    };
  });
}

function deviceBalance(customerId = "c-ramesh") {
  const rows = [...h.device.values()].filter((row) => row.customerId === customerId) as unknown as CustomerLedgerEntry[];
  return calculateLedgerBalance(rows);
}

describe("the snapshot's udhar ledger import", () => {
  beforeEach(() => {
    h.server = [];
    h.totalOverride = null;
    h.device = new Map();
    h.requests = [];
  });

  it("keeps every entry of a shop past 5,000, so balances stay whole", async () => {
    h.server = ledger(6_200);
    // The device already has them all, delivered by the pull over months.
    for (const row of h.server) h.device.set(String(row.id), { tenant_id: "t1", store_id: "s1", ...row });
    const before = deviceBalance();

    await resyncUdharLedgerFromServer();

    expect(h.device.size).toBe(6_200);
    expect(deviceBalance()).toBe(before);
    expect(deviceBalance()).toBe(calculateLedgerBalance(h.server as unknown as CustomerLedgerEntry[]));
  });

  it("still removes a synced entry the server no longer has, once it has read them all", async () => {
    h.server = ledger(120);
    h.device.set("led-gone", { id: "led-gone", tenant_id: "t1", store_id: "s1", customerId: "c-ramesh", type: "debit", amount: 999, sync_status: "synced" });
    await resyncUdharLedgerFromServer();
    expect(h.device.has("led-gone")).toBe(false);
    expect(h.device.size).toBe(120);
  });

  it("keeps the device's pending entries", async () => {
    h.server = ledger(10);
    h.device.set("led-pending", { id: "led-pending", tenant_id: "t1", store_id: "s1", customerId: "c-ramesh", type: "debit", amount: 75, sync_status: "pending_sync" });
    await resyncUdharLedgerFromServer();
    expect(h.device.get("led-pending")?.amount).toBe(75);
  });

  it("removes nothing when it could not read the whole ledger", async () => {
    // More than the pages it will ask for: an incomplete read must not stand in for the ledger.
    h.server = ledger(120_000);
    h.device.set("led-old", { id: "led-old", tenant_id: "t1", store_id: "s1", customerId: "c-ramesh", type: "debit", amount: 40, sync_status: "synced" });
    await resyncUdharLedgerFromServer();
    expect(h.device.has("led-old")).toBe(true);
  });

  it("removes nothing when a page boundary lost an entry", async () => {
    // The server counts 6,000, but one row never arrived — it moved between pages
    // while they were being read.
    h.server = ledger(6_000);
    const [missing] = h.server.splice(5_000, 1);
    h.totalOverride = 6_000;
    h.device.set(String(missing.id), { tenant_id: "t1", store_id: "s1", ...missing });
    await resyncUdharLedgerFromServer();
    expect(h.device.has(String(missing.id))).toBe(true);
  });
});
