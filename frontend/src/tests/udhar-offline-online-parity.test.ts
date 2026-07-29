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

vi.mock("@/features/sync/cloud-hydration", () => ({
  resyncUdharLedgerFromServer: vi.fn(async () => {
    cacheState.resyncCalls += 1;
    return 4;
  }),
}));

vi.mock("@/features/sync/sync-reconcile", () => ({
  refreshBusinessCaches: vi.fn(async () => {
    cacheState.refreshCalls += 1;
  }),
}));

import {
  AUTHORITATIVE_UDHAR_SUMMARY_CACHE_KEY,
  cacheAuthoritativeSummary,
  readCachedAuthoritativeSummary,
} from "@/features/ledger/authoritative-balances";
import {
  detectLedgerDrift,
  repairLedgerDriftFromServer,
  resetLedgerDriftRepairThrottle,
} from "@/features/ledger/ledger-drift-repair";
import { getLocalUdharSummary } from "@/features/payments/local-actions";
import { metricsWithCustomerBalanceFallback } from "@/features/customers/customer-ledger-data";

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

  it("applies unsynced local movement recorded after the snapshot was captured", () => {
    seedCachedSummary("2026-07-25T12:00:00.000Z");
    cacheState.instant.set("customers", [{ id: "customer_gops", name: "gops" }]);
    cacheState.instant.set("customer_ledger", [
      // Already in the server snapshot — counting it again would double it.
      {
        id: "ledger_old",
        customerId: "customer_gops",
        type: "PAYMENT",
        amount: 50,
        entry_at: "2026-07-25T09:00:00.000Z",
        sync_status: "pending_sync",
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
