import { describe, expect, it } from "vitest";
import {
  dedupeBillsForDisplay,
  isLikelySyncedCopyOfPendingBill,
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

});
