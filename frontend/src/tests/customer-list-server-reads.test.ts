import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "@/types/api";

/**
 * `/customers` answers with every customer, and the refresh after every sale
 * re-ran the list on every counter showing Billing — the seller twice, everyone
 * else once. New customers and udhar movements already reach each counter's
 * IndexedDB through the live pull, so between full reads the list answers from
 * there.
 *
 * Runs the real loadCustomerList. Substituted: the API (counting reads),
 * IndexedDB, the instant cache, the offline scope and the clock.
 */

const h = vi.hoisted(() => ({
  serverReads: 0,
  serverRows: [] as Array<Record<string, unknown>>,
  deviceRows: [] as Array<Record<string, unknown>>,
  online: true,
  failNext: false,
}));

vi.mock("@/lib/api/http", () => ({
  ApiClientError: class extends Error {},
  isBrowserOnline: () => h.online,
  isRecoverableNetworkError: (error: unknown) => error instanceof Error && error.message === "offline",
}));
vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: async (table: string) => (table === "customers" ? structuredClone(h.deviceRows) : []),
    transaction: async (_tables: string[], callback: (tx: unknown) => Promise<unknown>) =>
      callback({ putMany: async () => undefined }),
  },
}));
vi.mock("@/lib/offline/instant-cache", () => ({
  instantCacheUpdatedAt: () => 0,
  readInstantCache: (_key: string, fallback: unknown) => fallback,
  writeInstantCache: () => undefined,
}));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "t1", store_id: "s1", device_id: "d1" }) }));
vi.mock("@/features/core/customers/api", () => ({
  listCustomers: async () => {
    h.serverReads += 1;
    if (h.failNext) { h.failNext = false; throw new Error("offline"); }
    return structuredClone(h.serverRows);
  },
}));
vi.mock("@/features/core/sync/sync-id-mapping", () => ({ loadIdMap: async () => ({}) }));
vi.mock("@/features/core/sync/cloud-hydration", () => ({ isSupersededLocalEcho: () => false }));
vi.mock("@/features/core/ledger/api", () => ({}));
vi.mock("@/features/core/ledger/authoritative-balances", () => ({ cacheAuthoritativeSummary: vi.fn(), fetchAuthoritativeSnapshot: vi.fn() }));
vi.mock("@/features/core/customers/local-actions", () => ({ createCustomerLocalFirst: vi.fn(), deleteCustomerLocalFirst: vi.fn(), updateCustomerLocalFirst: vi.fn() }));
vi.mock("@/features/core/payments/local-actions", () => ({ getLocalUdharLedger: vi.fn(), getLocalUdharSummary: vi.fn(), getLocalUdharSummaryAsync: vi.fn(), recordPaymentLocalFirst: vi.fn() }));

const NOW = new Date("2026-10-09T10:00:00.000Z").getTime();
const RAMESH = { id: "c-ramesh", name: "Ramesh", mobile: "9812300011", type: "udhar", udharAmount: 200, sync_status: "synced" };
// Created on another counter and delivered by the pull.
const SITA = { id: "c-sita", name: "Sita", mobile: "9812300022", type: "regular", udharAmount: 0, sync_status: "synced" };

let loadCustomerList: typeof import("@/features/core/customers/queries").loadCustomerList;

describe("the customer list's server reads", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    Object.assign(h, { serverReads: 0, serverRows: [RAMESH], deviceRows: [RAMESH, SITA], online: true, failNext: false });
    ({ loadCustomerList } = await import("@/features/core/customers/queries"));
  });

  afterEach(() => vi.useRealTimers());

  const names = (rows: Customer[]) => rows.map((row) => row.name).sort();
  const minutes = (n: number) => vi.setSystemTime(NOW + n * 60_000);

  it("reads the server once, then answers from the device for ten minutes", async () => {
    await loadCustomerList();
    expect(h.serverReads).toBe(1);

    // A sale on another counter: the pull brought Sita, and Ramesh's udhar moved
    // on the device ledger since that read.
    h.deviceRows = [{ ...RAMESH, udharAmount: 320 }, SITA];
    minutes(5);
    const between = await loadCustomerList();
    expect(h.serverReads).toBe(1);
    expect(names(between)).toEqual(["Ramesh", "Sita"]);
    expect(between.find((row) => row.id === "c-ramesh")?.udharAmount).toBe(320);

    minutes(10);
    await loadCustomerList();
    expect(h.serverReads).toBe(2);
  });

  it("asks the server for every search", async () => {
    await loadCustomerList();
    minutes(1);
    await loadCustomerList({ search: "ram" });
    // The search itself plus the full read it refreshes the cache with.
    expect(h.serverReads).toBe(3);
  });

  it("asks the server while the device has no customers to answer with", async () => {
    h.deviceRows = [];
    await loadCustomerList();
    minutes(1);
    await loadCustomerList();
    expect(h.serverReads).toBe(2);
  });

  it("does not count a read that failed", async () => {
    h.failNext = true;
    expect(names(await loadCustomerList())).toEqual(["Ramesh", "Sita"]);
    minutes(1);
    await loadCustomerList();
    expect(h.serverReads).toBe(2);
  });

  it("answers from the device offline, as before", async () => {
    h.online = false;
    expect(names(await loadCustomerList())).toEqual(["Ramesh", "Sita"]);
    expect(h.serverReads).toBe(0);
  });
});
