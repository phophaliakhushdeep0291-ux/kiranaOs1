import { describe, expect, it } from "vitest";
import { buildLedgerStatement, calculateLedgerBalance, calculateUdharAgeing, dedupeLedgerEntries, isManualAdjustmentEntry, ledgerSignedAmount, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";

function entry(id: string, type: string, amount: number, daysAgo: number): CustomerLedgerEntry {
  const date = new Date(Date.UTC(2026, 5, 5));
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return {
    id,
    customerId: "c1",
    customer_id: "c1",
    type,
    amount,
    entry_at: date.toISOString(),
    createdAt: date.toISOString(),
    created_at: date.toISOString(),
  };
}

describe("customer ledger accounting", () => {
  it("treats bills/debit rows as udhar increase and payments as udhar decrease", () => {
    expect(ledgerSignedAmount(entry("b1", "BILL", 500, 1))).toBe(500);
    expect(ledgerSignedAmount(entry("d1", "debit", 450, 1))).toBe(450);
    expect(ledgerSignedAmount(entry("p1", "PAYMENT", 200, 0))).toBe(-200);
    expect(calculateLedgerBalance([entry("b1", "BILL", 500, 1), entry("p1", "PAYMENT", 200, 0)])).toBe(300);
  });


  it("hides local pending udhar ledger echo after the server ledger arrives", () => {
    const rows = dedupeLedgerEntries([
      {
        id: "ledger_bill_local_1_credit",
        customerId: "c1",
        customer_id: "c1",
        type: "BILL",
        amount: 540,
        source_type: "bill",
        source_id: "bill_local_1",
        billId: "bill_local_1",
        bill_id: "bill_local_1",
        sync_status: "pending_sync",
        note: "Udhar from PENDING-ABC123",
        entry_at: "2026-06-07T11:24:00.000Z",
      },
      {
        id: "server_ledger_1",
        customerId: "c1",
        customer_id: "c1",
        type: "debit",
        amount: 540,
        source_type: "bill",
        source_id: "server_bill_1",
        billId: "server_bill_1",
        bill_id: "server_bill_1",
        sync_status: "synced",
        note: "Bill added +₹540 (KOS-2026-00002)",
        entry_at: "2026-06-07T11:25:00.000Z",
      },
    ] as CustomerLedgerEntry[]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("server_ledger_1");
    expect(calculateLedgerBalance(rows)).toBe(540);
  });

  it("keeps separate same-amount udhar payments in the same sync window", () => {
    const rows = dedupeLedgerEntries([
      {
        id: "ledger_bill_1",
        customerId: "c1",
        customer_id: "c1",
        type: "BILL",
        amount: 200,
        source_type: "bill",
        source_id: "bill_1",
        entry_at: "2026-06-07T11:20:00.000Z",
      },
      {
        id: "server_payment_1",
        customerId: "c1",
        customer_id: "c1",
        type: "payment",
        amount: 100,
        source_type: "udhar_payment",
        source_id: "ledger_1",
        clientLedgerId: "ledger_1",
        client_ledger_id: "ledger_1",
        idempotencyKey: "record-payment:c1:payment_1",
        idempotency_key: "record-payment:c1:payment_1",
        sync_status: "synced",
        entry_at: "2026-06-07T11:24:00.000Z",
      },
      {
        id: "ledger_2",
        customerId: "c1",
        customer_id: "c1",
        type: "PAYMENT",
        amount: 100,
        source_type: "payment",
        source_id: "payment_2",
        paymentId: "payment_2",
        payment_id: "payment_2",
        clientLedgerId: "ledger_2",
        client_ledger_id: "ledger_2",
        idempotencyKey: "record-payment:c1:payment_2",
        idempotency_key: "record-payment:c1:payment_2",
        sync_status: "pending_sync",
        entry_at: "2026-06-07T11:25:00.000Z",
      },
    ] as CustomerLedgerEntry[]);

    expect(rows.filter((row) => row.type.toString().toUpperCase().includes("PAYMENT") || row.source_type === "udhar_payment")).toHaveLength(2);
    expect(calculateLedgerBalance(rows)).toBe(0);
  });

  it("collapses opening udhar balance when it duplicates the bill credit", () => {
    const rows = dedupeLedgerEntries([
      {
        id: "server_bill_ledger",
        customerId: "c1",
        customer_id: "c1",
        type: "debit",
        source_type: "bill",
        source_id: "server_bill_1",
        billId: "server_bill_1",
        bill_id: "server_bill_1",
        amount: 200,
        note: "Bill KOS-2026-000001",
        entry_at: "2026-06-15T08:10:00.000Z",
      },
      {
        id: "opening_balance_ledger",
        customerId: "c1",
        customer_id: "c1",
        type: "debit",
        source_type: "opening_balance",
        amount: 200,
        note: "Opening udhar balance",
        entry_at: "2026-06-15T08:10:20.000Z",
      },
    ] as CustomerLedgerEntry[]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("server_bill_ledger");
    expect(calculateLedgerBalance(rows)).toBe(200);
  });

  it("keeps statement append-only with running balance", () => {
    const rows = buildLedgerStatement([entry("b1", "BILL", 500, 2), entry("p1", "PAYMENT", 200, 1)]);
    expect(rows[0]?.running_balance).toBe(300);
    expect(rows[1]?.running_balance).toBe(500);
  });

  it("recognises a manual adjustment in both local and synced-echo shapes, and keeps the balance sign", () => {
    // Local optimistic shape: type ADJUSTMENT, direction in the amount sign.
    const localIncrease = { id: "adj_local_up", customerId: "c1", customer_id: "c1", type: "ADJUSTMENT", source_type: "manual_adjustment", amount: 100, entry_at: "2026-06-05T09:00:00.000Z" } as CustomerLedgerEntry;
    const localDecrease = { id: "adj_local_down", customerId: "c1", customer_id: "c1", type: "ADJUSTMENT", source_type: "manual_adjustment", amount: -60, entry_at: "2026-06-05T09:00:00.000Z" } as CustomerLedgerEntry;
    // Synced server echo: direction is in `type` (debit/payment), amount is positive, mode = adjustment.
    const syncedIncrease = { id: "adj_srv_up", customerId: "c1", customer_id: "c1", type: "debit", mode: "adjustment", sourceType: "adjustment", amount: 100, entry_at: "2026-06-05T09:00:00.000Z", sync_status: "synced" } as unknown as CustomerLedgerEntry;
    const syncedDecrease = { id: "adj_srv_down", customerId: "c1", customer_id: "c1", type: "payment", mode: "adjustment", sourceType: "adjustment", amount: 60, entry_at: "2026-06-05T09:00:00.000Z", sync_status: "synced" } as unknown as CustomerLedgerEntry;

    for (const row of [localIncrease, localDecrease, syncedIncrease, syncedDecrease]) {
      expect(isManualAdjustmentEntry(row)).toBe(true);
    }
    // A real cash payment must NOT be treated as an adjustment.
    expect(isManualAdjustmentEntry({ id: "p", type: "PAYMENT", mode: "cash", amount: 60 } as unknown as CustomerLedgerEntry)).toBe(false);

    // Sign survives regardless of representation: increases add to udhar, decreases subtract.
    expect(ledgerSignedAmount(syncedIncrease)).toBe(100);
    expect(ledgerSignedAmount(syncedDecrease)).toBe(-60);
    expect(ledgerSignedAmount(localIncrease)).toBe(100);
    expect(ledgerSignedAmount(localDecrease)).toBe(-60);
  });

  it("collapses a synced adjustment echo with its local optimistic row (no balance double-count)", () => {
    const rows = dedupeLedgerEntries([
      // Local optimistic manual adjustment (reduce udhar by 100), not yet synced.
      { id: "ledger_x", customerId: "c1", customer_id: "c1", type: "ADJUSTMENT", source_type: "manual_adjustment", source_id: "manual_adjustment_y", amount: -100, sync_status: "pending_sync", entry_at: "2026-06-07T10:00:00.000Z" },
      // Server echo of the SAME adjustment: debit/payment-typed, positive amount, mode:adjustment,
      // clientLedgerId === the local row id (backend getLedgerAdjustmentIdentity keys off ledgerEntryId).
      { id: "srv_1", server_id: "srv_1", customerId: "c1", customer_id: "c1", type: "payment", mode: "adjustment", sourceType: "adjustment", sourceId: "c1", amount: 100, clientLedgerId: "ledger_x", idempotencyKey: "ledger_x", sync_status: "synced", entry_at: "2026-06-07T10:00:05.000Z" },
    ] as unknown as CustomerLedgerEntry[]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("srv_1"); // the synced echo wins
    expect(calculateLedgerBalance(rows)).toBe(-100); // not -200
  });

  it("allocates payments against oldest udhar for ageing", () => {
    const now = new Date(Date.UTC(2026, 5, 5));
    const ageing = calculateUdharAgeing([
      entry("old", "BILL", 1000, 35),
      entry("new", "BILL", 500, 3),
      entry("pay", "PAYMENT", 800, 1),
    ], now);
    expect(ageing.thirtyPlus).toBe(200);
    expect(ageing.zeroToSeven).toBe(500);
    expect(ageing.total).toBe(700);
  });
});
