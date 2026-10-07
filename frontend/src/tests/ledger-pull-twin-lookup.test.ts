import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every payment and bill entry the pull delivered read the device's whole udhar
 * ledger to look for a local twin, so a page of 500 entries was 500 full reads and
 * a counter catching up on 5,200 sat at full CPU for minutes. The twin index reads
 * the ledger once per page; these tests hold that it finds exactly the twins the
 * full read found, because a missed twin is a duplicated udhar entry — a doubled
 * balance — and a wrong one merges two real entries into one.
 *
 * Runs the real mergeServerChange on a real Dexie database (fake-indexeddb).
 */

vi.mock("@/lib/offline/context", async (original) => ({
  ...await original<typeof import("@/lib/offline/context")>(),
  getOfflineScope: () => ({ tenant_id: "shop-a", store_id: "store-a", device_id: "counter-a" }),
}));
vi.mock("@/lib/offline/instant-cache", () => ({ readInstantCache: (_key: string, fallback: unknown) => fallback, writeInstantCache: vi.fn(), emitLocalDataChanged: vi.fn() }));

import { dexieDB } from "@/lib/offline/db";
import { createLedgerTwinIndex, mergeServerChange } from "@/features/core/sync/sync-reconcile";
import { replaceReferencesMany } from "@/features/core/sync/sync-id-mapping";

type Row = Record<string, unknown> & { id: string };
const scoped = (row: Record<string, unknown>): Row => ({ tenant_id: "shop-a", store_id: "store-a", created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z", ...row }) as Row;

/** A device with a mix of every kind of row a pulled entry can and cannot match. */
async function seedDevice() {
  await dexieDB.customer_ledger.bulkPut([
    // A pending bill debit not yet echoed: twin of server entry "srv-bill-1".
    scoped({ id: "local-debit-1", customerId: "cust-1", type: "debit", source_type: "bill", source_id: "bill-1", amount: 120, sync_status: "pending_sync" }),
    // A pending payment, matched by its client id.
    scoped({ id: "local-pay-1", customerId: "cust-1", type: "payment", clientLedgerId: "client-pay-1", amount: 50, sync_status: "pending_sync" }),
    // Already the server's row.
    scoped({ id: "srv-known", server_id: "srv-known", customerId: "cust-1", type: "debit", source_type: "bill", source_id: "bill-9", amount: 70, sync_status: "synced" }),
    // A legacy row whose key is local but which names its server id.
    scoped({ id: "local-legacy", server_id: "srv-legacy", customerId: "cust-2", type: "payment", amount: 30, sync_status: "synced" }),
    // Look-alikes that must not match: another customer, another amount, mapped elsewhere.
    scoped({ id: "local-other-cust", customerId: "cust-3", type: "debit", source_type: "bill", source_id: "bill-1", amount: 120, sync_status: "pending_sync" }),
    scoped({ id: "local-other-amount", customerId: "cust-1", type: "payment", clientLedgerId: "client-pay-1", amount: 51, sync_status: "pending_sync" }),
    scoped({ id: "srv-elsewhere", server_id: "srv-elsewhere", customerId: "cust-1", type: "debit", source_type: "bill", source_id: "bill-1", amount: 120, sync_status: "synced" }),
    ...Array.from({ length: 300 }, (_, i) => scoped({ id: `srv-old-${i}`, server_id: `srv-old-${i}`, customerId: "cust-4", type: "debit", amount: 10, sync_status: "synced" })),
  ]);
}

/** One pull page: echoes of the twins above, a known row, a legacy row, and new entries. */
const page = () => [
  { id: "srv-bill-1", customerId: "cust-1", type: "debit", sourceType: "bill", sourceId: "bill-1", amount: 120 },
  { id: "srv-pay-1", customerId: "cust-1", type: "payment", clientLedgerId: "client-pay-1", amount: 50 },
  { id: "srv-known", customerId: "cust-1", type: "debit", sourceType: "bill", sourceId: "bill-9", amount: 70 },
  { id: "srv-legacy", customerId: "cust-2", type: "payment", amount: 30 },
  // A second echo of the same bill on the page: its twin was consumed by the first.
  { id: "srv-bill-1b", customerId: "cust-1", type: "debit", sourceType: "bill", sourceId: "bill-1", amount: 120 },
  ...Array.from({ length: 40 }, (_, i) => ({ id: `srv-new-${i}`, customerId: "cust-5", type: i % 2 ? "payment" : "debit", sourceType: i % 2 ? "payment" : "bill", sourceId: `bill-new-${i}`, amount: 25 })),
].map((entity) => ({ entity_type: "udhar_ledger", entity_id: entity.id, operation_type: "upsert", entity }));

async function applyPage(withIndex: boolean) {
  const twins = withIndex ? createLedgerTwinIndex() : undefined;
  const merged = new Map<string, string>();
  for (const change of page()) await mergeServerChange(change as never, merged, twins);
  await replaceReferencesMany(merged); // as the pull does at the end of each page
  const rows = await dexieDB.customer_ledger.toArray();
  return rows.map((row) => ({ id: row.id, server_id: row.server_id, amount: row.amount, customerId: row.customerId })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function reset() {
  dexieDB.close();
  await Dexie.delete(dexieDB.name);
  await dexieDB.open();
}

describe("matching pulled udhar entries to their local twins", () => {
  beforeEach(reset);
  afterEach(async () => { vi.restoreAllMocks(); dexieDB.close(); await Dexie.delete(dexieDB.name); });

  it("finds exactly the twins the full read found", async () => {
    await seedDevice();
    const viaFullReads = await applyPage(false);
    await reset();
    await seedDevice();
    const viaIndex = await applyPage(true);
    expect(viaIndex).toEqual(viaFullReads);
    // And what a match means here: each twin now names its server entry (readers
    // fold the pair through the ledger dedupe), and no look-alike was claimed.
    const byId = new Map(viaIndex.map((row) => [row.id, row]));
    expect(byId.get("local-debit-1")?.server_id).toBe("srv-bill-1");
    expect(byId.get("local-pay-1")?.server_id).toBe("srv-pay-1");
    expect(byId.get("local-other-cust")?.server_id).toBeUndefined();
    expect(byId.get("local-other-amount")?.server_id).toBeUndefined();
    // The second echo of the bill found its twin already taken and stands alone.
    expect(byId.get("srv-bill-1b")?.server_id).toBe("srv-bill-1b");
  });

  it("reads the whole ledger once for the page, not once per entry", async () => {
    await seedDevice();
    const fullReads = vi.spyOn(dexieDB.customer_ledger, "filter");
    await applyPage(true);
    expect(fullReads).toHaveBeenCalledTimes(1);
    fullReads.mockClear();
    await reset();
    await seedDevice();
    const spy = vi.spyOn(dexieDB.customer_ledger, "filter");
    await applyPage(false);
    expect(spy.mock.calls.length).toBeGreaterThan(40); // the old way: one per entry
  });
});
