import { describe, expect, it } from "vitest";
import { buildMoneyStatement, normaliseMoneyMode } from "./statement-data";

describe("money statement", () => {
  it("normalises owner payment modes into cash upi and bank", () => {
    expect(normaliseMoneyMode("cash")).toBe("cash");
    expect(normaliseMoneyMode("UPI")).toBe("upi");
    expect(normaliseMoneyMode("bank_transfer")).toBe("bank");
    expect(normaliseMoneyMode("card")).toBe("bank");
    expect(normaliseMoneyMode("credit")).toBeNull();
  });

  it("does not double count a bill when a separate payment row exists for that bill", () => {
    const result = buildMoneyStatement({
      customers: [{ id: "c1", name: "Ramesh", mobile: "9999999999" }],
      bills: [{
        id: "b1",
        customerId: "c1",
        billNo: "KOS-2026-000001",
        createdAt: "2026-07-10T10:00:00.000Z",
        payments: [{ id: "p1", mode: "cash", amount: 500 }],
        grandTotal: 500,
      }],
      payments: [{
        id: "p1",
        billId: "b1",
        customerId: "c1",
        mode: "cash",
        amount: 500,
        paid_at: "2026-07-10T10:01:00.000Z",
      }],
    }, { from: "2026-07-10", to: "2026-07-10" });

    expect(result.rows).toHaveLength(1);
    expect(result.totals.cashIn).toBe(500);
    expect(result.totals.totalIn).toBe(500);
  });

  it("resolves bill payment customer name from the linked bill when payment has only bill id", () => {
    const result = buildMoneyStatement({
      bills: [{
        id: "bill-10",
        billNo: "KOS-2026-000010",
        customerName: "Gopal Store",
        customerMobile: "9000011111",
        createdAt: "2026-07-10T09:00:00.000Z",
        paymentMode: "bank",
        paidAmount: 1000,
      }],
      payments: [{
        id: "payment-10",
        billId: "bill-10",
        mode: "bank",
        amount: 1000,
        paidAt: "2026-07-10T13:28:00.000Z",
        status: "synced",
      }],
    }, { from: "2026-07-10", to: "2026-07-10", mode: "bank" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.partyName).toBe("Gopal Store");
    expect(result.rows[0]?.partyMobile).toBe("9000011111");
    expect(result.rows[0]?.reference).toBe("KOS-2026-000010");
    expect(result.rows[0]?.dateLabel).toBe("10 Jul 2026");
    expect(result.rows[0]?.timeLabel).toBeTruthy();
  });

  it("attaches bill item details to linked bill payment rows", () => {
    const result = buildMoneyStatement({
      products: [{ id: "prod-1", name: "Sugar", unit: "kg" }],
      bills: [{
        id: "bill-11",
        billNo: "KOS-2026-000011",
        customerName: "Ramesh",
        createdAt: "2026-07-10T09:00:00.000Z",
        grandTotal: 90,
        paidAmount: 90,
      }],
      billItems: [{
        id: "item-1",
        billId: "bill-11",
        productId: "prod-1",
        quantity: 2,
        ratePerRateUnit: 45,
        lineTotal: 90,
      }],
      payments: [{
        id: "payment-11",
        billId: "bill-11",
        mode: "cash",
        amount: 90,
        paidAt: "2026-07-10T13:28:00.000Z",
      }],
    }, { from: "2026-07-10", to: "2026-07-10" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.detail?.billNo).toBe("KOS-2026-000011");
    expect(result.rows[0]?.detail?.total).toBe(90);
    expect(result.rows[0]?.detail?.items).toEqual([
      { id: "item-1", name: "Sugar", quantity: 2, unit: "kg", rate: 45, amount: 90 },
    ]);
  });

  it("includes bank udhar payments from customer ledger when payment cache is missing", () => {
    const result = buildMoneyStatement({
      customers: [{ id: "c1", name: "Ramesh Sharma", mobile: "9829012345" }],
      customerLedger: [{
        id: "ledger-1",
        customerId: "c1",
        type: "PAYMENT",
        source_type: "payment",
        paymentId: "payment-bank-1",
        mode: "bank",
        amount: 1000,
        entry_at: "2026-07-10T13:28:00.000Z",
        note: "Bank udhar recovery",
      }],
    }, { from: "2026-07-10", to: "2026-07-10", mode: "bank" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.source).toBe("Udhar payment");
    expect(result.rows[0]?.partyName).toBe("Ramesh Sharma");
    expect(result.rows[0]?.mode).toBe("bank");
    expect(result.totals.bankIn).toBe(1000);
    expect(result.totals.totalIn).toBe(1000);
  });

  it("does not double count udhar payment when payment and ledger rows both exist", () => {
    const result = buildMoneyStatement({
      customers: [{ id: "c1", name: "Ramesh Sharma" }],
      payments: [{
        id: "payment-bank-1",
        customerId: "c1",
        mode: "bank",
        amount: 1000,
        paidAt: "2026-07-10T13:28:00.000Z",
      }],
      customerLedger: [{
        id: "ledger-1",
        customerId: "c1",
        type: "PAYMENT",
        source_type: "payment",
        paymentId: "payment-bank-1",
        source_id: "payment-bank-1",
        mode: "bank",
        amount: 1000,
        entry_at: "2026-07-10T13:28:00.000Z",
      }],
    }, { from: "2026-07-10", to: "2026-07-10", mode: "bank" });

    expect(result.rows).toHaveLength(1);
    expect(result.totals.bankIn).toBe(1000);
  });

  it("tracks cash upi and bank inflow and purchase expense outflow", () => {
    const result = buildMoneyStatement({
      customers: [{ id: "c1", name: "Suresh" }],
      payments: [
        { id: "pay-cash", customerId: "c1", mode: "cash", amount: 140, paid_at: "2026-07-10T09:00:00.000Z" },
        { id: "pay-upi", customerId: "c1", mode: "upi", amount: 60, paid_at: "2026-07-10T09:10:00.000Z" },
        { id: "pay-bank", customerId: "c1", mode: "bank", amount: 200, paid_at: "2026-07-10T09:20:00.000Z" },
      ],
      suppliers: [{ id: "s1", name: "Balaji Supplier" }],
      purchaseBills: [{
        id: "pur-1",
        supplierId: "s1",
        paymentMode: "bank_transfer",
        paidAmount: 75,
        createdAt: "2026-07-10T12:00:00.000Z",
      }],
      expenses: [{
        id: "exp-1",
        title: "Delivery",
        vendor: "Driver",
        paymentMode: "cash",
        amount: 40,
        spentAt: "2026-07-10T13:00:00.000Z",
      }],
    }, { from: "2026-07-10", to: "2026-07-10" });

    expect(result.totals.cashIn).toBe(140);
    expect(result.totals.cashOut).toBe(40);
    expect(result.totals.upiIn).toBe(60);
    expect(result.totals.bankIn).toBe(200);
    expect(result.totals.bankOut).toBe(75);
    expect(result.totals.totalNet).toBe(285);
  });

  it("filters by party, reference, mode, and direction", () => {
    const result = buildMoneyStatement({
      payments: [
        { id: "a", payerName: "Ramesh Sharma", mode: "upi", amount: 100, paid_at: "2026-07-09T10:00:00.000Z" },
        { id: "b", payerName: "Pooja Meena", mode: "cash", amount: 50, paid_at: "2026-07-10T10:00:00.000Z" },
      ],
      purchaseBills: [
        { id: "c", supplierName: "Ramesh Traders", paymentMode: "cash", paidAmount: 25, createdAt: "2026-07-10T11:00:00.000Z" },
      ],
    }, { from: "2026-07-10", to: "2026-07-10", mode: "cash", direction: "out", search: "ramesh" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.source).toBe("Purchase payment");
    expect(result.totals.cashOut).toBe(25);
  });

  it("resolves party name and mobile from server ids and row fallbacks", () => {
    const result = buildMoneyStatement({
      customers: [{ id: "local-c1", server_id: "server-c1", name: "Khushdeep", mobile: "9571738238" }],
      payments: [{
        id: "pay-1",
        customer_id: "server-c1",
        mode: "cash",
        amount: 40,
        paidAt: "2026-07-10T09:30:00",
      }],
      bills: [{
        id: "bill-1",
        customerName: "Fallback Buyer",
        customerMobile: "9000000000",
        paymentMode: "upi",
        paidAmount: 80,
        createdAt: "2026-07-10T10:45:00",
      }],
    }, { from: "2026-07-10", to: "2026-07-10" });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]?.partyName).toBe("Khushdeep");
    expect(result.rows[1]?.partyMobile).toBe("9571738238");
    expect(result.rows[0]?.partyName).toBe("Fallback Buyer");
    expect(result.rows[0]?.partyMobile).toBe("9000000000");
    expect(result.rows[0]?.dateLabel).toBe("10 Jul 2026");
    expect(result.rows[0]?.timeLabel).toMatch(/10:45/);
  });
});
