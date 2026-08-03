import { describe, expect, it } from "vitest";
import { buildCustomerTimeline } from "@/features/core/customers/customer-ledger-data";
import type { CustomerDetailData } from "@/features/core/customers/customer-ledger-data";

type TimelineInput = Pick<CustomerDetailData, "bills" | "payments" | "ledger">;

function input(overrides: Partial<TimelineInput> = {}): TimelineInput {
  return { bills: [], payments: [], ledger: [], ...overrides } as TimelineInput;
}

describe("buildCustomerTimeline", () => {
  it("merges bills, payments and adjustments newest-first", () => {
    const events = buildCustomerTimeline(input({
      bills: [
        { id: "b1", billNo: "KOS-1", billType: "normal_sale", grandTotal: 201, createdAt: "2026-07-17T10:00:00Z", items: [{}, {}], paymentMode: "cash" },
        { id: "b2", billNo: "RET-1", billType: "sales_return", grandTotal: -120, createdAt: "2026-07-17T12:00:00Z" },
      ] as never,
      payments: [
        { id: "p1", amount: 40, mode: "cash", paidAt: "2026-07-17T11:00:00Z" },
      ],
      ledger: [
        { id: "l1", display_type: "Adjustment", signed_amount: -15, display_date: "2026-07-17T13:00:00Z", note: "rounding" },
      ] as never,
    }));
    expect(events.map((event) => event.kind)).toEqual(["adjustment", "return", "payment", "sale"]);
    expect(events[1].amount).toBe(-120);
    expect(events[2].amount).toBe(-40); // payment reduces what the customer owes
    expect(events[3].title).toBe("Bill KOS-1");
    expect(events[3].detail).toContain("2 items");
    expect(events[3].href).toBe("/bills/b1");
  });

  it("does not duplicate returns as refund payment rows", () => {
    const events = buildCustomerTimeline(input({
      bills: [{ id: "b1", billNo: "RET-9", billType: "sales_return", grandTotal: -50, createdAt: "2026-07-17T10:00:00Z" }] as never,
      payments: [{ id: "p-refund", amount: -50, mode: "cash", paidAt: "2026-07-17T10:00:01Z" }],
    }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("return");
  });

  it("marks reversed payments and flips their sign back", () => {
    const events = buildCustomerTimeline(input({
      payments: [{ id: "p1", amount: 100, mode: "upi", paidAt: "2026-07-17T10:00:00Z", reversed_at: "2026-07-17T11:00:00Z" }],
    }));
    expect(events[0].kind).toBe("payment_reversed");
    expect(events[0].amount).toBe(100);
  });

  it("excludes bill/payment ledger echoes and undated rows", () => {
    const events = buildCustomerTimeline(input({
      ledger: [
        { id: "l1", display_type: "Udhar (bill)", signed_amount: 200, display_date: "2026-07-17T10:00:00Z" },
        { id: "l2", display_type: "Payment", signed_amount: -200, display_date: "2026-07-17T11:00:00Z" },
        { id: "l3", display_type: "Adjustment", signed_amount: 5, display_date: "" },
      ] as never,
    }));
    expect(events).toHaveLength(0);
  });

  it("shows a synced manual adjustment (debit/payment echo carrying mode:adjustment)", () => {
    const events = buildCustomerTimeline(input({
      ledger: [
        // After sync a reduce-udhar adjustment comes back as a PAYMENT-typed row with mode:"adjustment".
        { id: "adj1", display_type: "PAYMENT", mode: "adjustment", signed_amount: -60, display_date: "2026-07-17T13:00:00Z", note: "goodwill" },
      ] as never,
    }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("adjustment");
    expect(events[0].amount).toBe(-60);
  });

  it("still excludes a real synced payment echo (mode not adjustment) from the timeline", () => {
    const events = buildCustomerTimeline(input({
      ledger: [
        { id: "pay1", display_type: "PAYMENT", mode: "cash", signed_amount: -60, display_date: "2026-07-17T13:00:00Z" },
      ] as never,
    }));
    expect(events).toHaveLength(0);
  });

  it("labels estimates separately from pakka bills", () => {
    const events = buildCustomerTimeline(input({
      bills: [{ id: "b1", billNo: "EST-1", billType: "estimate", grandTotal: 80, createdAt: "2026-07-17T10:00:00Z" }] as never,
    }));
    expect(events[0].kind).toBe("estimate");
    expect(events[0].title).toBe("Estimate EST-1");
  });
});
