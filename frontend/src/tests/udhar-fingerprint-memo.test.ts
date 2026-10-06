import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerLedgerEntry } from "@/features/core/ledger/accounting";

/**
 * The udhar balance check stamps each server summary with the device's confirmed
 * ledger. A summary is requested every few seconds while the Customers page is
 * open and after every sync, and each request used to read and dedupe the whole
 * ledger — about 15ms of dedupe alone on a 10,000-entry ledger on a desktop, more
 * on a till — although most syncs carry no udhar at all.
 */

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  counts: { "[tenant_id+store_id]": 0, sync_status: 0 } as Record<string, number>,
  scope: { tenant_id: "shop-1", store_id: "shop-1" },
  countFails: false,
  reads: 0,
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    init: async () => undefined,
    getAll: async () => {
      state.reads += 1;
      return state.rows;
    },
  },
  dexieDB: {
    customer_ledger: {
      where: (index: string) => ({
        equals: () => ({
          count: async () => {
            if (state.countFails) throw new Error("IndexedDB unavailable");
            return state.counts[index];
          },
        }),
      }),
    },
  },
}));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => state.scope }));
vi.mock("@/features/core/ledger/api", () => ({ getUdharSummary: async () => ({ totalOutstanding: 0, customers: [] }) }));

import { dedupeLedgerEntries } from "@/features/core/ledger/accounting";
import {
  confirmedLedgerFingerprints,
  fetchAuthoritativeSnapshot,
  fingerprintDedupedLedger,
  resetLedgerFingerprintMemo,
} from "@/features/core/ledger/authoritative-balances";

const sale = (id: string, amount: number, extra: Partial<CustomerLedgerEntry> = {}): CustomerLedgerEntry => ({
  id,
  customerId: "ramesh",
  type: "debit",
  amount,
  clientLedgerId: `ledger_${id}`,
  sync_status: "synced",
  createdAt: "2026-10-06T08:00:00.000Z",
  ...extra,
});

function setLedger(rows: CustomerLedgerEntry[]) {
  state.rows = rows;
  state.counts["[tenant_id+store_id]"] = rows.length;
  state.counts.sync_status = rows.filter((row) => row.sync_status === "synced").length;
}

describe("the device ledger fingerprint behind each udhar summary", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetLedgerFingerprintMemo();
    state.reads = 0;
    state.countFails = false;
    state.scope = { tenant_id: "shop-1", store_id: "shop-1" };
    setLedger([sale("s1", 120), sale("s2", 50)]);
  });

  it("counts already-deduped entries in one pass, with the same answer as deduping again", () => {
    // A pending local row and its server echo collapse to one; a pending row never counts.
    const rows = [
      sale("s1", 120),
      sale("ledger_bill_1_credit", 120, { type: "BILL", sync_status: "pending_sync", clientLedgerId: "ledger_bill_1_credit" }),
      sale("s2", 50, { clientLedgerId: "ledger_bill_1_credit" }),
    ];
    expect(fingerprintDedupedLedger(dedupeLedgerEntries(rows))).toEqual(confirmedLedgerFingerprints(rows));
    expect(confirmedLedgerFingerprints(rows)).toEqual({ ramesh: { count: 2, total: 170 } });
  });

  it("reads the ledger again only when it has gained, lost or confirmed a row", async () => {
    expect((await fetchAuthoritativeSnapshot()).confirmedLedger).toEqual({ ramesh: { count: 2, total: 170 } });
    await fetchAuthoritativeSnapshot();
    await fetchAuthoritativeSnapshot();
    expect(state.reads).toBe(1); // three summaries, one ledger read

    setLedger([sale("s1", 120), sale("s2", 50), sale("s3", 30)]); // another counter's udhar sale lands
    expect((await fetchAuthoritativeSnapshot()).confirmedLedger).toEqual({ ramesh: { count: 3, total: 200 } });
    expect(state.reads).toBe(2);

    // A pending row becoming confirmed changes the synced count, not the total.
    setLedger([sale("s1", 120), sale("s2", 50), sale("s3", 30), sale("p4", 10, { sync_status: "pending_sync" })]);
    await fetchAuthoritativeSnapshot();
    setLedger([sale("s1", 120), sale("s2", 50), sale("s3", 30), sale("p4", 10)]);
    expect((await fetchAuthoritativeSnapshot()).confirmedLedger).toEqual({ ramesh: { count: 4, total: 210 } });
    expect(state.reads).toBe(4);
  });

  it("does not carry one shop's fingerprint into another", async () => {
    await fetchAuthoritativeSnapshot();
    state.scope = { tenant_id: "shop-2", store_id: "shop-2" }; // same row counts, different shop
    await fetchAuthoritativeSnapshot();
    expect(state.reads).toBe(2);
  });

  it("re-reads after five minutes even if the counts never moved", async () => {
    vi.useFakeTimers();
    await fetchAuthoritativeSnapshot();
    vi.advanceTimersByTime(4 * 60_000);
    await fetchAuthoritativeSnapshot();
    expect(state.reads).toBe(1);
    vi.advanceTimersByTime(2 * 60_000);
    await fetchAuthoritativeSnapshot();
    expect(state.reads).toBe(2);
  });

  it("falls back to reading every time when the counts cannot be taken", async () => {
    state.countFails = true;
    await fetchAuthoritativeSnapshot();
    await fetchAuthoritativeSnapshot();
    expect(state.reads).toBe(2);
  });
});
