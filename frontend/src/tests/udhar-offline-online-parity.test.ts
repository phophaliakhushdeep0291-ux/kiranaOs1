import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The udhar balance a shop sees must not depend on whether the device is online.
 * Live report: the same customer showed ₹300 outstanding online (the server's
 * ledger-derived summary) and −₹330 offline (this device's drifted ledger sum),
 * and the payment guard then read the offline number and refused a legitimate
 * ₹150 collection.
 */

const cacheState = vi.hoisted(() => ({
  instant: new Map<string, unknown>(),
  resyncCalls: 0,
  refreshCalls: 0,
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_1`),
  emitLocalDataChanged: vi.fn(),
  readInstantCache: vi.fn((key: string, fallback: unknown) =>
    cacheState.instant.has(key) ? cacheState.instant.get(key) : fallback,
  ),
  readIndexedRecentCache: vi.fn(async (key: string, fallback: unknown) =>
    cacheState.instant.has(key) ? cacheState.instant.get(key) : fallback,
  ),
  writeInstantCache: vi.fn((key: string, value: unknown) => cacheState.instant.set(key, value)),
  writeInstantMemoryCache: vi.fn((key: string, value: unknown) => cacheState.instant.set(key, value)),
  upsertCachedListItem: vi.fn(),
  normaliseInstantCacheValue: vi.fn((value: unknown) => value),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async () => []),
    put: vi.fn(async () => undefined),
    transaction: vi.fn(async () => undefined),
  },
}));

vi.mock("@/features/core/ledger/api", () => ({
  getUdharSummary: vi.fn(),
}));

vi.mock("@/features/core/sync/cloud-hydration", () => ({
  resyncUdharLedgerFromServer: vi.fn(async () => {
    cacheState.resyncCalls += 1;
    return 4;
  }),
}));

vi.mock("@/features/core/sync/sync-reconcile", () => ({
  refreshBusinessCaches: vi.fn(async () => {
    cacheState.refreshCalls += 1;
  }),
}));

import {
  AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY,
  authoritativeOutstandingWithPendingLedger,
  cacheAuthoritativeSummary,
  confirmedLedgerFingerprints,
  fetchAuthoritativeSnapshot,
  readCachedAuthoritativeSummary,
} from "@/features/core/ledger/authoritative-balances";
import {
  detectLedgerDrift,
  repairLedgerDriftFromServer,
  resetLedgerDriftRepairThrottle,
} from "@/features/core/ledger/ledger-drift-repair";
import { getLocalUdharSummary } from "@/features/core/payments/local-actions";
import { applyAuthoritativeUdharSummary, metricsWithCustomerBalanceFallback, type CustomerWithLedger } from "@/features/core/customers/customer-ledger-data";
import { getUdharSummary } from "@/features/core/ledger/api";
import { offlineDB } from "@/lib/offline/db";
import type { CustomerLedgerEntry } from "@/features/core/ledger/accounting";

const SERVER_SUMMARY = {
  totalOutstanding: 300,
  customers: [
    { customerId: "customer_gops", customerName: "gops", mobile: "8104437379", amount: 300, outstanding: 300 },
  ],
};

function seedCachedSummary(capturedAt = "2026-07-25T12:00:00.000Z") {
  cacheState.instant.set(AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY, {
    summary: SERVER_SUMMARY,
    capturedAt,
  });
}

describe("udhar offline/online parity", () => {
  beforeEach(() => {
    cacheState.instant.clear();
    cacheState.resyncCalls = 0;
    cacheState.refreshCalls = 0;
    resetLedgerDriftRepairThrottle();
  });

  it("caches the server summary so the offline read returns the same number", () => {
    cacheAuthoritativeSummary(SERVER_SUMMARY);

    expect(readCachedAuthoritativeSummary()?.summary).toEqual(SERVER_SUMMARY);
    expect(getLocalUdharSummary()).toEqual(
      expect.objectContaining({
        totalOutstanding: 300,
        customers: [expect.objectContaining({ customerId: "customer_gops", outstanding: 300 })],
      }),
    );
  });

  it("offline summary falls back to the drifted local ledger only when no server snapshot exists", () => {
    cacheState.instant.set("customers", [
      { id: "customer_gops", name: "gops", udharAmount: -330, totalUdhar: -330 },
    ]);

    // A negative balance is not a debt, so it must never be reported as one.
    expect(getLocalUdharSummary()).toEqual({ totalOutstanding: 0, customers: [] });
  });

  it("applies unsynced local movement on top of the snapshot, and only that", () => {
    seedCachedSummary("2026-07-25T12:00:00.000Z");
    cacheState.instant.set("customers", [{ id: "customer_gops", name: "gops" }]);
    cacheState.instant.set("customer_ledger", [
      // Acknowledged by the server, so it is already inside the ₹300 snapshot —
      // counting it again would double it. Being `synced` is what says so.
      {
        id: "ledger_old",
        customerId: "customer_gops",
        type: "PAYMENT",
        amount: 50,
        entry_at: "2026-07-25T09:00:00.000Z",
        sync_status: "synced",
      },
      // Collected offline after the snapshot: has to move the number now.
      {
        id: "ledger_new",
        customerId: "customer_gops",
        type: "PAYMENT",
        amount: 150,
        entry_at: "2026-07-25T18:00:00.000Z",
        sync_status: "pending_sync",
      },
    ]);

    expect(getLocalUdharSummary()).toEqual(
      expect.objectContaining({
        totalOutstanding: 150,
        customers: [expect.objectContaining({ customerId: "customer_gops", outstanding: 150 })],
      }),
    );
  });

  it("applies an unsynced payment even when it predates the snapshot", () => {
    // The udhar page refetches /udhar/summary immediately after a payment is
    // written, so `capturedAt` normally lands AFTER a row that is still waiting
    // to be pushed. Dating that row out of the reckoning lost the first
    // collection of the day and re-created debt the customer had already paid.
    seedCachedSummary("2026-07-25T12:00:00.000Z");
    cacheState.instant.set("customers", [{ id: "customer_gops", name: "gops" }]);
    cacheState.instant.set("customer_ledger", [
      {
        id: "ledger_unpushed",
        customerId: "customer_gops",
        type: "PAYMENT",
        amount: 120,
        entry_at: "2026-07-25T09:00:00.000Z",
        sync_status: "pending_sync",
      },
    ]);

    expect(getLocalUdharSummary()).toEqual(
      expect.objectContaining({
        totalOutstanding: 180,
        customers: [expect.objectContaining({ customerId: "customer_gops", outstanding: 180 })],
      }),
    );
  });

  it("ignores a payment the server rejected", () => {
    // A conflicted row is not pending: the server saw it and refused it. Letting
    // it reduce the balance keeps regenerating debt that was never owed.
    seedCachedSummary("2026-07-25T12:00:00.000Z");
    cacheState.instant.set("customers", [{ id: "customer_gops", name: "gops" }]);
    cacheState.instant.set("customer_ledger", [
      {
        id: "ledger_rejected",
        customerId: "customer_gops",
        type: "PAYMENT",
        amount: 120,
        entry_at: "2026-07-25T18:00:00.000Z",
        sync_status: "conflict",
      },
    ]);

    expect(getLocalUdharSummary()).toEqual(
      expect.objectContaining({
        totalOutstanding: 300,
        customers: [expect.objectContaining({ customerId: "customer_gops", outstanding: 300 })],
      }),
    );
  });

  it("keeps the projected remainder after a partial payment when local history is incomplete", () => {
    const metrics = metricsWithCustomerBalanceFallback(
      { id: "customer_gops", name: "gops", udharAmount: 150, totalUdhar: 150, balance_derived_from_local_ledger: true },
      [{ id: "ledger_partial_payment", customerId: "customer_gops", type: "PAYMENT", amount: 150, sync_status: "pending_sync", entry_at: "2026-07-25T18:00:00.000Z" }],
    );
    expect(metrics.balance).toBe(150);
  });
  it("detects a synced customer whose local ledger contradicts the server", () => {
    const drifts = detectLedgerDrift(
      [
        { ids: ["customer_gops"], localBalance: -330, hasPendingLocalWork: false },
        { ids: ["customer_khushdeep"], localBalance: -90, hasPendingLocalWork: false },
      ],
      SERVER_SUMMARY,
    );

    expect(drifts).toEqual([
      { customerId: "customer_gops", localBalance: -330, serverBalance: 300 },
      // Absent from the summary means settled server-side, so −90 is drift too.
      { customerId: "customer_khushdeep", localBalance: -90, serverBalance: 0 },
    ]);
  });

  it("leaves customers with unsynced local work alone", () => {
    expect(
      detectLedgerDrift(
        [{ ids: ["customer_gops"], localBalance: 150, hasPendingLocalWork: true }],
        SERVER_SUMMARY,
      ),
    ).toEqual([]);
  });

  it("treats a sub-rupee gap as real paise drift", () => {
    expect(
      detectLedgerDrift(
        [{ ids: ["customer_gops"], localBalance: 300.4, hasPendingLocalWork: false }],
        SERVER_SUMMARY,
      ),
    ).toEqual([
      {
        customerId: "customer_gops",
        localBalance: 300.4,
        serverBalance: 300,
      },
    ]);
  });

  it("repairs drift by re-pulling the server ledger, then throttles repeat attempts", async () => {
    const candidates = [{ ids: ["customer_gops"], localBalance: -330, hasPendingLocalWork: false }];

    await expect(repairLedgerDriftFromServer(candidates, SERVER_SUMMARY)).resolves.toBe(true);
    expect(cacheState.resyncCalls).toBe(1);
    expect(cacheState.refreshCalls).toBe(1);

    // A list that re-renders constantly must not re-download the ledger each time.
    await expect(repairLedgerDriftFromServer(candidates, SERVER_SUMMARY)).resolves.toBe(false);
    expect(cacheState.resyncCalls).toBe(1);
  });

  it("does nothing when the device ledger already agrees with the server", async () => {
    await expect(
      repairLedgerDriftFromServer(
        [{ ids: ["customer_gops"], localBalance: 300, hasPendingLocalWork: false }],
        SERVER_SUMMARY,
      ),
    ).resolves.toBe(false);
    expect(cacheState.resyncCalls).toBe(0);
  });
});

/**
 * Two-counter QA run: both tills sat on the billing screen, so the cached
 * summary was the one fetched before any udhar existed. A ₹120 udhar sale synced
 * to both devices, the network dropped, and the udhar page showed the customer
 * as "Cleared" at ₹0 — and refused a ₹100 collection — while both device
 * ledgers correctly held the ₹120.
 */
describe("a cached udhar summary older than the confirmed ledger", () => {
  const RAMESH = "customer_ramesh";
  const syncedSale: CustomerLedgerEntry = {
    id: "srv_ledger_1",
    customerId: RAMESH,
    type: "debit",
    amount: 120,
    clientLedgerId: "ledger_bill_1_credit",
    sync_status: "synced",
    createdAt: "2026-10-05T07:36:19.221Z",
  };
  const settledSnapshot = { totalOutstanding: 0, customers: [], confirmedLedger: {} };

  beforeEach(() => {
    cacheState.instant.clear();
    vi.mocked(offlineDB.getAll).mockReset().mockResolvedValue([]);
    vi.mocked(getUdharSummary).mockReset();
  });

  it("reads the device ledger for a customer whose confirmed movement postdates the snapshot", () => {
    cacheState.instant.set(AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY, { summary: settledSnapshot, capturedAt: "2026-10-05T07:31:51.600Z" });
    cacheState.instant.set("customers", [{ id: RAMESH, name: "Ramesh" }]);
    cacheState.instant.set("customer_ledger", [syncedSale]);

    expect(getLocalUdharSummary()).toEqual(expect.objectContaining({
      totalOutstanding: 120,
      customers: [expect.objectContaining({ customerId: RAMESH, outstanding: 120 })],
    }));
    // The collection guard asks the same question: no trusted snapshot answer,
    // so it falls back to the device balance instead of refusing at ₹0.
    expect(authoritativeOutstandingWithPendingLedger(settledSnapshot, [RAMESH], [syncedSale])).toBeNull();
  });

  it("keeps the snapshot over a drifted ledger it was taken against", () => {
    // Same confirmed rows as when the snapshot was requested: the ledger has not
    // moved, so its −₹330 is drift and the server's ₹300 still stands.
    const drifted: CustomerLedgerEntry = { id: "srv_old", customerId: "customer_gops", type: "PAYMENT", amount: 330, sync_status: "synced", entry_at: "2026-07-25T09:00:00.000Z" };
    const snapshot = { ...SERVER_SUMMARY, confirmedLedger: confirmedLedgerFingerprints([drifted]) };
    cacheState.instant.set(AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY, { summary: snapshot, capturedAt: "2026-07-25T12:00:00.000Z" });
    cacheState.instant.set("customers", [{ id: "customer_gops", name: "gops" }]);
    cacheState.instant.set("customer_ledger", [drifted]);

    expect(getLocalUdharSummary().customers).toEqual([expect.objectContaining({ customerId: "customer_gops", outstanding: 300 })]);
    expect(authoritativeOutstandingWithPendingLedger(snapshot, ["customer_gops"], [drifted])).toBe(300);
  });

  it("counts a sale confirmed while the summary request was in flight as not covered", async () => {
    vi.mocked(getUdharSummary).mockImplementation(async () => {
      // The pull lands the sale between the request leaving and the answer
      // arriving; the server may or may not have counted it.
      vi.mocked(offlineDB.getAll).mockResolvedValue([syncedSale]);
      return { totalOutstanding: 0, customers: [] };
    });

    const snapshot = await fetchAuthoritativeSnapshot();

    expect(snapshot.confirmedLedger).toEqual({});
    expect(authoritativeOutstandingWithPendingLedger(snapshot, [RAMESH], [syncedSale])).toBeNull();
  });

  it("shows the device balance on the customer list until a newer summary arrives", () => {
    const customer = {
      id: RAMESH,
      name: "Ramesh",
      type: "udhar",
      ledgerBalance: 120,
      rawLedgerBalance: 120,
      udharAmount: 120,
      totalUdhar: 120,
      confirmedLedger: confirmedLedgerFingerprints([syncedSale]),
      ledgerMetrics: { balance: 120, ageing: { total: 120, zeroToSeven: 120, sevenToThirty: 0, thirtyPlus: 0 }, paymentCount: 0, billCount: 1, trustScore: 75, isBadCustomer: false, warning: null },
    } as unknown as CustomerWithLedger;

    expect(applyAuthoritativeUdharSummary([customer], settledSnapshot)[0].ledgerBalance).toBe(120);
    // A summary requested after the sale covers it, and its answer wins again —
    // here it already knows of a ₹20 collection this device has not pulled yet.
    const current = {
      totalOutstanding: 100,
      customers: [{ customerId: RAMESH, customerName: "Ramesh", amount: 100, outstanding: 100 }],
      confirmedLedger: confirmedLedgerFingerprints([syncedSale]),
    };
    expect(applyAuthoritativeUdharSummary([customer], current)[0].ledgerBalance).toBe(100);
  });
});
