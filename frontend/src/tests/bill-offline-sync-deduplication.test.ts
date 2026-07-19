import { describe, expect, it } from "vitest";
import {
  dedupeBillsForDisplay,
  isLikelySyncedCopyOfPendingBill,
  isMergedBillTwin,
} from "@/features/sync/bill-reconciliation";

describe("offline bill sync deduplication", () => {
  it("prefers the synced server bill over its pending offline copy", () => {
    const pending = {
      id: "bill_local_1",
      billNo: "PENDING-ABC123",
      customerName: "Khushdeep phophalia",
      grandTotal: 4500,
      paidAmount: 4500,
      creditAmount: 0,
      createdAt: "2026-06-07T02:20:41.000Z",
      sync_status: "pending_sync",
      status: "pending_sync",
      tenant_id: "shop",
      store_id: "main",
    };
    const synced = {
      id: "server_bill_1",
      billNo: "KOS-2026-000004",
      customerName: "Khushdeep phophalia",
      grandTotal: 4500,
      paidAmount: 4500,
      creditAmount: 0,
      createdAt: "2026-06-07T02:20:41.000Z",
      sync_status: "synced",
      tenant_id: "shop",
      store_id: "main",
    };

    expect(isLikelySyncedCopyOfPendingBill(pending, synced)).toBe(true);
    const rows = dedupeBillsForDisplay([pending, synced]) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("server_bill_1");
  });

  it("keeps two normal synced bills that only share amount and customer", () => {
    const one = {
      id: "server_bill_1",
      billNo: "KOS-2026-000010",
      customerName: "Walk-in",
      grandTotal: 100,
      paidAmount: 100,
      creditAmount: 0,
      createdAt: "2026-06-07T02:20:41.000Z",
      sync_status: "synced",
    };
    const two = {
      id: "server_bill_2",
      billNo: "KOS-2026-000011",
      customerName: "Walk-in",
      grandTotal: 100,
      paidAmount: 100,
      creditAmount: 0,
      createdAt: "2026-06-07T02:20:41.000Z",
      sync_status: "synced",
    };

    const rows = dedupeBillsForDisplay([one, two]) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
  });

  it("dedupes a pending offline bill when server copy drops mobile but keeps same customer name and amount", () => {
    const pending = {
      id: "bill_local_270",
      billNo: "PENDING-C4C09E",
      customerName: "Khushdeep phophalia",
      customerMobile: "9571738238",
      grandTotal: 270,
      paidAmount: 270,
      creditAmount: 0,
      createdAt: "2026-06-07T02:45:59.000Z",
      sync_status: "pending_sync",
      status: "completed",
    };
    const synced = {
      id: "server_bill_270",
      billNo: "KOS-2026-000005",
      customerName: "Khushdeep phophalia",
      grandTotal: 270,
      paidAmount: 270,
      creditAmount: 0,
      createdAt: "2026-06-07T03:31:32.000Z",
      sync_status: "synced",
    };

    expect(isLikelySyncedCopyOfPendingBill(pending, synced)).toBe(true);
    const rows = dedupeBillsForDisplay([pending, synced]) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("server_bill_270");
  });

  it("dedupes every failed local bill when multiple older retries later receive server echoes", () => {
    const rows = dedupeBillsForDisplay([
      {
        id: "bill_local_first",
        billNo: "PENDING-FIRST",
        customerName: "Khushdeep",
        grandTotal: 450,
        paidAmount: 450,
        creditAmount: 0,
        createdAt: "2026-06-07T09:00:00.000Z",
        sync_status: "failed",
        status: "pending_sync",
      },
      {
        id: "bill_local_second",
        billNo: "PENDING-SECOND",
        customerName: "Khushdeep",
        grandTotal: 900,
        paidAmount: 900,
        creditAmount: 0,
        createdAt: "2026-06-07T09:02:00.000Z",
        sync_status: "failed",
        status: "pending_sync",
      },
      {
        id: "server_bill_first",
        billNo: "KOS-2026-000101",
        customerName: "Khushdeep",
        grandTotal: 450,
        paidAmount: 450,
        creditAmount: 0,
        createdAt: "2026-06-07T09:44:00.000Z",
        sync_status: "synced",
      },
      {
        id: "server_bill_second",
        billNo: "KOS-2026-000102",
        customerName: "Khushdeep",
        grandTotal: 900,
        paidAmount: 900,
        creditAmount: 0,
        createdAt: "2026-06-07T09:46:00.000Z",
        sync_status: "synced",
      },
    ]) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual(["server_bill_first", "server_bill_second"]);
  });

  it("flags reconcile merge-tombstones so the recycle bin can exclude them", () => {
    // After a synced bill's echo arrives, reconcile stamps merged_into_id +
    // deleted_at on the local optimistic row. The recycle bin filters
    // isDeleted && !isMergedTwin, so a merge-tombstone must be recognisable —
    // otherwise every synced bill leaves a phantom "deleted" entry.
    const mergeTombstone = { id: "bill_local_1", billNo: "PENDING-ABC123", deleted_at: "2026-06-07T02:20:41.000Z", merged_into_id: "server_bill_1" };
    const userDeleted = { id: "server_bill_2", billNo: "KOS-2026-000020", deleted_at: "2026-06-08T10:00:00.000Z" };
    const activeBill = { id: "server_bill_1", billNo: "KOS-2026-000004" };

    expect(isMergedBillTwin(mergeTombstone)).toBe(true);
    expect(isMergedBillTwin({ ...activeBill, mergedIntoId: "server_bill_1", deletedAt: "2026-06-07T02:20:41.000Z" })).toBe(true); // camelCase variant
    expect(isMergedBillTwin(userDeleted)).toBe(false);  // a real user delete stays in the recycle bin
    expect(isMergedBillTwin(activeBill)).toBe(false);

    // The recycle-bin predicate the Bills page uses: deleted AND not a merge twin.
    const inRecycleBin = [mergeTombstone, userDeleted, activeBill].filter(
      (b) => (typeof b.deleted_at === "string" || typeof (b as { deletedAt?: unknown }).deletedAt === "string") && !isMergedBillTwin(b),
    );
    expect(inRecycleBin.map((b) => b.id)).toEqual(["server_bill_2"]);
  });

});
