import { describe, expect, it } from "vitest";
import { aggregateFinancialRows } from "@/features/core/finance/services/FinancialAggregationService";

/**
 * The tender split must add up to the sales figure printed beside it.
 *
 * Reports shows TOTAL SALES from the bills' signed grand totals, and the Payment
 * Mode Breakdown donut from the same rows split by how each was paid — its own
 * comment says "so the slices reconcile to Total Sales". A return broke that: the
 * headline dropped by the refund while the slices did not, so one screen showed
 * ₹40 in one card and ₹60 in another, both labelled Total Sales, and the udhar
 * slice disagreed with the Udhar Due figure two cards above it.
 *
 * A refund arrives in one of two shapes, and both are real:
 *
 *   cash   grandTotal -10, paidAmount -10, creditAmount   0, payments [-10 cash]
 *   udhar  grandTotal -20, paidAmount   0, creditAmount -20, payments []
 *
 * The cash one already netted, because its signed payment row carried the sign.
 * The debt-reducing one did not: `Math.max(0, …)` clamped its negative credit to
 * zero, which is the right guard for a sale and erases a refund.
 */

const date = "2026-06-06";
const at = (hour: number) => `2026-06-06T${String(hour).padStart(2, "0")}:00:00.000`;

const cashSale = {
  id: "bill-cash", billType: "normal_sale", status: "active", createdAt: at(10),
  grandTotal: 10, paidAmount: 10, creditAmount: 0,
  payments: [{ mode: "cash", amount: 10 }],
};
const cashRefund = {
  id: "bill-cash-return", billType: "sales_return", status: "active", createdAt: at(11),
  grandTotal: -10, paidAmount: -10, creditAmount: 0, refundMode: "cash",
  payments: [{ mode: "cash", amount: -10 }],
};
const udharSale = {
  id: "bill-udhar", billType: "normal_sale", status: "active", createdAt: at(12),
  customerId: "cust-1", grandTotal: 60, paidAmount: 0, creditAmount: 60, payments: [],
};
const udharRefund = {
  id: "bill-udhar-return", billType: "sales_return", status: "active", createdAt: at(13),
  customerId: "cust-1", grandTotal: -20, paidAmount: 0, creditAmount: -20,
  refundMode: "udhar", payments: [],
};

function tenderSum(snapshot: ReturnType<typeof aggregateFinancialRows>) {
  return Math.round(
    (snapshot.cashSalesToday + snapshot.upiSalesToday + snapshot.bankSalesToday + snapshot.udharSalesToday) * 100,
  ) / 100;
}

describe("a refund nets out of the tender split, not just the headline", () => {
  it("reduces the udhar slice when the refund reduced what the customer owes", () => {
    const snapshot = aggregateFinancialRows({ date, bills: [udharSale, udharRefund] } as never);
    expect(snapshot.revenueToday).toBe(40);
    expect(snapshot.udharSalesToday).toBe(40);
    expect(tenderSum(snapshot)).toBe(snapshot.revenueToday);
  });

  it("reduces the cash slice when the refund went back across the counter", () => {
    const snapshot = aggregateFinancialRows({ date, bills: [cashSale, cashRefund] } as never);
    expect(snapshot.revenueToday).toBe(0);
    expect(snapshot.cashSalesToday).toBe(0);
    expect(tenderSum(snapshot)).toBe(snapshot.revenueToday);
  });

  it("reads a cash refund's own tender when no separate payment row was written", () => {
    // Older and offline-written returns carry the refund on the bill itself. The
    // embedded reader was gated on a POSITIVE amount, so it skipped them.
    const embeddedOnly = { ...cashRefund, payments: [], cashAmount: -10 };
    const snapshot = aggregateFinancialRows({ date, bills: [cashSale, embeddedOnly] } as never);
    expect(snapshot.cashSalesToday).toBe(0);
    expect(tenderSum(snapshot)).toBe(snapshot.revenueToday);
  });

  it("reconciles a day that mixes both refund shapes", () => {
    const snapshot = aggregateFinancialRows({
      date, bills: [cashSale, cashRefund, udharSale, udharRefund],
    } as never);
    expect(snapshot.revenueToday).toBe(40);
    expect(snapshot.cashSalesToday).toBe(0);
    expect(snapshot.udharSalesToday).toBe(40);
    expect(tenderSum(snapshot)).toBe(40);
  });

  it("still refuses to read a negative balance on an ordinary sale as a refund", () => {
    // The clamp exists for a reason: a sale whose credit column went negative is
    // corrupt, not a refund, and must not be allowed to reduce the day's udhar.
    const corruptSale = { ...udharSale, id: "bill-corrupt", creditAmount: -60 };
    const snapshot = aggregateFinancialRows({ date, bills: [corruptSale] } as never);
    expect(snapshot.udharSalesToday).toBe(0);
  });
});
