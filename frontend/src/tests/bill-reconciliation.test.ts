import { describe, expect, it } from "vitest";
import { dedupeBillsForDisplay, dedupePaymentsForDisplay } from "@/features/sync/bill-reconciliation";

describe("bill reconciliation display dedupe", () => {
  it("prefers the synced server bill over the local pending bill", () => {
    const rows = dedupeBillsForDisplay([
      { id: "bill_local_1", local_id: "bill_local_1", status: "pending_sync", sync_status: "pending_sync", createdAt: "2026-06-05T10:00:00.000Z" },
      { id: "server_bill_1", local_id: "bill_local_1", server_id: "server_bill_1", status: "completed", sync_status: "synced", createdAt: "2026-06-05T10:00:00.000Z" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("server_bill_1");
    expect(rows[0]?.sync_status).toBe("synced");
  });


  it("uses isSynced boolean and content signature to hide a LEGACY local duplicate (no durable client identity) when backend returns the same bill without local_id", () => {
    // Legacy fallback path: neither row carries a clientBillId/idempotencyKey, so
    // there is no durable identity to match on and the content/time signature is
    // the only thing tying them together. Modern bills collapse via identity (the
    // `seen` check) instead — see bill-sync-behavior.test.ts.
    const rows = dedupeBillsForDisplay([
      {
        id: "bill_local_abc",
        local_id: "bill_local_abc",
        billNo: "PENDING-LABC",
        billType: "normal_sale",
        status: "pending_sync",
        sync_status: "pending_sync",
        isSynced: false,
        createdAt: "2026-06-05T10:00:12.000Z",
        customerName: "Ramesh",
        grandTotal: 100,
        items: [{ name: "Sugar", quantity: 2, ratePerRateUnit: 50 }],
      },
      {
        id: "server_bill_abc",
        billNo: "BILL-1001",
        billType: "normal_sale",
        status: "completed",
        sync_status: "synced",
        isSynced: true,
        createdAt: "2026-06-05T10:03:05.000Z",
        customerName: "Ramesh",
        totalAmount: 100,
        items: [{ name: "Sugar", quantity: 2, ratePerRateUnit: 50 }],
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ id: "server_bill_abc", isSynced: true, is_synced: true }));
  });

  it("keeps two genuine synced bills even when amount and items match", () => {
    const rows = dedupeBillsForDisplay([
      { id: "server_bill_1", billNo: "BILL-1", sync_status: "synced", createdAt: "2026-06-05T10:00:00.000Z", customerName: "Walk-in", totalAmount: 50, items: [{ name: "Milk", quantity: 1, ratePerRateUnit: 50 }] },
      { id: "server_bill_2", billNo: "BILL-2", sync_status: "synced", createdAt: "2026-06-05T10:01:00.000Z", customerName: "Walk-in", totalAmount: 50, items: [{ name: "Milk", quantity: 1, ratePerRateUnit: 50 }] },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => (row as Record<string, unknown>).isSynced === true)).toBe(true);
  });

  it("does not show tombstoned merged local bills", () => {
    const rows = dedupeBillsForDisplay([
      { id: "bill_local_1", local_id: "bill_local_1", server_id: "server_bill_1", merged_into_id: "server_bill_1", deleted_at: "2026-06-05T10:01:00.000Z", sync_status: "synced" },
      { id: "server_bill_1", local_id: "bill_local_1", server_id: "server_bill_1", status: "completed", sync_status: "synced" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("server_bill_1");
  });
});

describe("payment reconciliation display dedupe", () => {
  it("dedupes local and server payment rows for the same bill/payment signature", () => {
    const rows = dedupePaymentsForDisplay([
      { id: "payment_local_1", bill_id: "server_bill_1", mode: "cash", amount: 100, paid_at: "2026-06-05T10:00:00.000Z", sync_status: "pending_sync" },
      { id: "server_payment_1", local_id: "payment_local_1", server_id: "server_payment_1", bill_id: "server_bill_1", mode: "cash", amount: 100, paid_at: "2026-06-05T10:00:00.000Z", sync_status: "synced" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("server_payment_1");
  });

  it("dedupes duplicate cash/upi payment rows by bill, mode, and amount even when ids differ", () => {
    const rows = dedupePaymentsForDisplay([
      { id: "payment_local_cash", bill_id: "server_bill_2", mode: "cash", amount: 650, paid_at: "2026-06-07T11:20:00.000Z", sync_status: "pending_sync" },
      { id: "server_payment_cash", bill_id: "server_bill_2", mode: "cash", amount: 650, paid_at: "2026-06-07T11:20:03.000Z", sync_status: "synced" },
      { id: "payment_local_upi", bill_id: "server_bill_2", mode: "upi", amount: 150, paid_at: "2026-06-07T11:20:00.000Z", sync_status: "pending_sync" },
      { id: "server_payment_upi", bill_id: "server_bill_2", mode: "upi", amount: 150, paid_at: "2026-06-07T11:20:02.000Z", sync_status: "synced" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual(["server_payment_cash", "server_payment_upi"]);
  });

  it("dedupes local pending and server payment rows even when bill ids have not been mapped yet", () => {
    const rows = dedupePaymentsForDisplay([
      { id: "payment_local_cash", bill_id: "bill_pending_123", customer_id: "customer_1", mode: "cash", amount: 650, paid_at: "2026-06-07T11:20:00.000Z", sync_status: "pending_sync" },
      { id: "server_payment_cash", bill_id: "server_bill_2", customer_id: "customer_1", mode: "cash", amount: 650, paid_at: "2026-06-07T11:20:03.000Z", sync_status: "synced" },
      { id: "payment_local_upi", bill_id: "bill_pending_123", customer_id: "customer_1", mode: "upi", amount: 150, paid_at: "2026-06-07T11:20:00.000Z", sync_status: "pending_sync" },
      { id: "server_payment_upi", bill_id: "server_bill_2", customer_id: "customer_1", mode: "upi", amount: 150, paid_at: "2026-06-07T11:20:02.000Z", sync_status: "synced" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual(["server_payment_cash", "server_payment_upi"]);
  });

});
