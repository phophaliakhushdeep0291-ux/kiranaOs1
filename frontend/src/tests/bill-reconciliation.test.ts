import { describe, expect, it } from "vitest";
import { dedupeBillsForDisplay, dedupePaymentsForDisplay, pairServerChildRows } from "@/features/core/sync/bill-reconciliation";

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

  it("keeps a local cancellation visible over its older synced active twin", () => {
    const rows = dedupeBillsForDisplay([
      {
        id: "bill_local_cancelled",
        local_id: "bill_local_cancelled",
        server_id: "server_bill_cancelled",
        clientBillId: "bill_local_cancelled",
        status: "cancelled",
        sync_status: "conflict",
        updated_at: "2026-08-01T08:07:36.000Z",
      },
      {
        id: "server_bill_cancelled",
        local_id: "bill_local_cancelled",
        server_id: "server_bill_cancelled",
        clientBillId: "bill_local_cancelled",
        status: "completed",
        sync_status: "synced",
        updated_at: "2026-08-01T08:06:56.000Z",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      id: "bill_local_cancelled",
      status: "cancelled",
      sync_status: "conflict",
    }));
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

  it("dedupes exact duplicate payment rows already stored for the same bill", () => {
    const rows = dedupePaymentsForDisplay([
      { id: "cash_1", bill_id: "cmqexobma001f4zu4wk7xlvo8", mode: "cash", amount: 350, paid_at: "2026-06-15T08:10:39.000Z", sync_status: "synced" },
      { id: "upi_1", bill_id: "cmqexobma001f4zu4wk7xlvo8", mode: "upi", amount: 190, paid_at: "2026-06-15T08:10:39.000Z", sync_status: "synced" },
      { id: "upi_2", bill_id: "cmqexobma001f4zu4wk7xlvo8", mode: "upi", amount: 190, paid_at: "2026-06-15T08:10:40.000Z", sync_status: "synced" },
      { id: "cash_2", bill_id: "cmqexobma001f4zu4wk7xlvo8", mode: "cash", amount: 350, paid_at: "2026-06-15T08:10:40.000Z", sync_status: "synced" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(540);
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

describe("pairing a bill's server rows back to the local rows they came from", () => {
  // The real shape of a first sync: local ids are random uuids, so Dexie hands
  // these back in an order unrelated to the cart, while the server echoes them
  // in cart order. Nothing here carries a server id yet.
  const butterLocal = { id: "bill_item_f1e2", bill_id: "bill_local_1", name: "Amul Butter 100g", productId: "prod_amul", quantity: 3, ratePerRateUnit: 62, line_total: 186, lineTotal: 186 };
  const pasteLocal = { id: "bill_item_0a9b", bill_id: "bill_local_1", name: "Colgate Strong Teeth 100g", productId: "prod_colgate", quantity: 1, ratePerRateUnit: 60, line_total: 60, lineTotal: 60 };
  const butterServer = { id: "srv_item_butter", billId: "server_bill_1", name: "Amul Butter 100g", productId: "prod_amul", quantity: 3, ratePerRateUnit: 62, lineTotal: 186 };
  const pasteServer = { id: "srv_item_paste", billId: "server_bill_1", name: "Colgate Strong Teeth 100g", productId: "prod_colgate", quantity: 1, ratePerRateUnit: 60, lineTotal: 60 };

  it("pairs each server line with its own local line whatever order the local rows arrive in", () => {
    for (const locals of [[butterLocal, pasteLocal], [pasteLocal, butterLocal]]) {
      const paired = pairServerChildRows([butterServer, pasteServer], locals);
      expect(paired.map((row) => row?.id)).toEqual([butterLocal.id, pasteLocal.id]);
    }
  });

  it("never hands the same local row to two server rows", () => {
    const paired = pairServerChildRows([butterServer, pasteServer], [pasteLocal, butterLocal]);
    const ids = paired.map((row) => row?.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still prefers an explicit server id over the business key", () => {
    const alreadySynced = { ...pasteLocal, id: "srv_item_paste", server_id: "srv_item_paste" };
    const paired = pairServerChildRows([pasteServer, butterServer], [butterLocal, alreadySynced]);
    expect(paired[0]?.id).toBe("srv_item_paste");
    expect(paired[1]?.id).toBe(butterLocal.id);
  });

  it("leaves a genuinely new server line unpaired rather than stealing another line's row", () => {
    const extra = { id: "srv_item_rice", billId: "server_bill_1", name: "Tata Salt 1kg", productId: "prod_salt", quantity: 2, ratePerRateUnit: 28, lineTotal: 56 };
    const paired = pairServerChildRows([butterServer, extra], [butterLocal]);
    expect(paired[0]?.id).toBe(butterLocal.id);
    expect(paired[1]).toBeUndefined();
  });

  it("pairs on name when the local row still holds a local product id", () => {
    const offlineProduct = { ...butterLocal, productId: "product_7c3d-local" };
    const paired = pairServerChildRows([pasteServer, butterServer], [offlineProduct, pasteLocal]);
    expect(paired.map((row) => row?.id)).toEqual([pasteLocal.id, offlineProduct.id]);
  });

  it("falls back to position for two identical lines, where either pairing is the same", () => {
    const a = { id: "bill_item_aaa", bill_id: "bill_local_2", name: "Loose Sugar", quantity: 1, ratePerRateUnit: 45, lineTotal: 45 };
    const b = { id: "bill_item_bbb", bill_id: "bill_local_2", name: "Loose Sugar", quantity: 1, ratePerRateUnit: 45, lineTotal: 45 };
    const s1 = { id: "srv_sugar_1", billId: "server_bill_2", name: "Loose Sugar", quantity: 1, ratePerRateUnit: 45, lineTotal: 45 };
    const s2 = { id: "srv_sugar_2", billId: "server_bill_2", name: "Loose Sugar", quantity: 1, ratePerRateUnit: 45, lineTotal: 45 };
    const paired = pairServerChildRows([s1, s2], [a, b]);
    expect(paired.map((row) => row?.id).sort()).toEqual([a.id, b.id]);
  });

  it("pairs payments by mode and amount, not position", () => {
    const cashLocal = { id: "payment_zz", bill_id: "bill_local_1", mode: "cash", amount: 650 };
    const upiLocal = { id: "payment_aa", bill_id: "bill_local_1", mode: "upi", amount: 150 };
    const cashServer = { id: "srv_pay_cash", billId: "server_bill_1", mode: "cash", amount: 650 };
    const upiServer = { id: "srv_pay_upi", billId: "server_bill_1", mode: "upi", amount: 150 };
    const paired = pairServerChildRows([cashServer, upiServer], [upiLocal, cashLocal]);
    expect(paired.map((row) => row?.id)).toEqual([cashLocal.id, upiLocal.id]);
  });
});
