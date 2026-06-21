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

  it("does NOT collapse a sales-return refund into a same-magnitude sale tender (sign matters)", () => {
    const sale = {
      id: "payment_sale_1",
      bill_id: "KOS-2026-000010",
      customer_id: "walk-in",
      mode: "cash",
      amount: 200,
      paid_at: "2026-06-21T12:00:00.000Z",
      sync_status: "synced",
    };
    const refund = {
      id: "payment_refund_1",
      bill_id: "RET-2026-000001",
      customer_id: "walk-in",
      mode: "cash",
      amount: -200, // refund pays cash OUT of the drawer
      paid_at: "2026-06-21T12:00:00.000Z",
      sync_status: "pending_sync",
    };
    expect(financialEchoSignature("payments", sale)).not.toBe(financialEchoSignature("payments", refund));
  });

  it("still matches a refund with its own server echo (same negative sign)", () => {
    const localRefund = {
      id: "payment_refund_local",
      bill_id: "RET-LOCAL",
      customer_id: "customer_9",
      mode: "upi",
      amount: -150,
      paid_at: "2026-06-21T12:01:00.000Z",
      sync_status: "pending_sync",
    };
    const serverRefund = {
      id: "cmq-refund-server",
      bill_id: "RET-2026-000009",
      customer_id: "customer_9",
      mode: "upi",
      amount: -150,
      paid_at: "2026-06-21T12:05:00.000Z",
      sync_status: "synced",
    };
    expect(financialEchoSignature("payments", localRefund)).toBe(financialEchoSignature("payments", serverRefund));
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

  it("does not group separate customer-only udhar payments by amount and time", () => {
    const first = {
      id: "server_payment_1",
      customer_id: "customer_1",
      type: "payment",
      source_type: "udhar_payment",
      clientLedgerId: "ledger_1",
      idempotencyKey: "record-payment:customer_1:payment_1",
      mode: "cash",
      amount: 100,
      paid_at: "2026-06-07T12:01:00.000Z",
      sync_status: "synced",
    };
    const second = {
      id: "payment_2",
      customer_id: "customer_1",
      type: "payment",
      source_type: "payment",
      clientLedgerId: "ledger_2",
      idempotencyKey: "record-payment:customer_1:payment_2",
      mode: "cash",
      amount: 100,
      paid_at: "2026-06-07T12:07:00.000Z",
      sync_status: "pending_sync",
    };

    expect(financialEchoSignature("payments", first)).not.toBe(financialEchoSignature("payments", second));
    expect(financialEchoSignature("customer_ledger", first)).not.toBe(financialEchoSignature("customer_ledger", second));
    expect(paymentDuplicateSignature(first)).not.toBe(paymentDuplicateSignature(second));
  });
});
