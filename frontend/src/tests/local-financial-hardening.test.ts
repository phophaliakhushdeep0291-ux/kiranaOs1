import { describe, expect, it } from "vitest";
import { financialEchoSignature, paymentDuplicateSignature } from "@/features/sync/local-data-hardening";

describe("local financial hardening", () => {
  it("matches local and server payment echoes even when bill IDs differ", () => {
    const local = {
      id: "payment_local_1",
      bill_id: "PENDING-ABC123",
      customer_id: "customer_1",
      mode: "cash",
      amount: 500,
      paid_at: "2026-06-07T12:01:00.000Z",
      sync_status: "failed",
    };
    const server = {
      id: "cmq-server-payment",
      bill_id: "KOS-2026-000001",
      customer_id: "customer_1",
      mode: "cash",
      amount: 500,
      paid_at: "2026-06-07T12:07:00.000Z",
      sync_status: "synced",
    };

    expect(financialEchoSignature("payments", local)).toBe(financialEchoSignature("payments", server));
  });

  it("matches local and server ledger echoes even when pending bill number changes to KOS bill number", () => {
    const local = {
      id: "ledger_bill_local_credit",
      customer_id: "customer_1",
      type: "BILL",
      source_type: "bill",
      source_id: "PENDING-ABC123",
      amount: 540,
      entry_at: "2026-06-07T12:01:00.000Z",
      sync_status: "pending_sync",
    };
    const server = {
      id: "cmq-server-ledger",
      customer_id: "customer_1",
      type: "BILL",
      source_type: "bill",
      source_id: "KOS-2026-000001",
      amount: 540,
      entry_at: "2026-06-07T12:07:00.000Z",
      sync_status: "synced",
    };

    expect(financialEchoSignature("customer_ledger", local)).toBe(financialEchoSignature("customer_ledger", server));
  });

  it("groups exact duplicate payment rows for repair even when both are already synced", () => {
    const billId = "cmqexobma001f4zu4wk7xlvo8";
    const cashA = { id: "cash_1", bill_id: billId, mode: "cash", amount: 350, paid_at: "2026-06-15T08:10:39.000Z", sync_status: "synced" };
    const cashB = { id: "cash_2", bill_id: billId, mode: "cash", amount: 350, paid_at: "2026-06-15T08:10:40.000Z", sync_status: "synced" };
    const upiA = { id: "upi_1", bill_id: billId, mode: "upi", amount: 190, paid_at: "2026-06-15T08:10:39.000Z", sync_status: "synced" };
    const upiB = { id: "upi_2", bill_id: billId, mode: "upi", amount: 190, paid_at: "2026-06-15T08:10:40.000Z", sync_status: "synced" };

    expect(paymentDuplicateSignature(cashA)).toBe(paymentDuplicateSignature(cashB));
    expect(paymentDuplicateSignature(upiA)).toBe(paymentDuplicateSignature(upiB));
    expect(paymentDuplicateSignature(cashA)).not.toBe(paymentDuplicateSignature(upiA));
  });
});
