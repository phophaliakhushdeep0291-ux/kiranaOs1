import { describe, expect, it } from "vitest";
import { buildLedgerStatement, calculateLedgerBalance, calculateUdharAgeing, dedupeLedgerEntries, ledgerSignedAmount, type CustomerLedgerEntry } from "@/features/ledger/accounting";

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
