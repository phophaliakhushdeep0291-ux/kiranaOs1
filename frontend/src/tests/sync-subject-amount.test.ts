import { describe, expect, it } from "vitest";
import { readSyncSubjectAmount } from "@/features/core/sync/subject-amount";

describe("queued operation amount", () => {
  it("shows the bill total for cash, partial payment and credit bills", () => {
    for (const creditAmount of [0, 20, 58]) {
      expect(readSyncSubjectAmount([{actualAmount: 58, creditAmount}])).toBe(58);
    }
  });
  it("prefers a nested bill total over an envelope credit balance", () => {
    expect(readSyncSubjectAmount([{creditAmount: 0}, {grandTotal: 58}])).toBe(58);
  });
  it("does not turn absent or malformed amounts into zero", () => {
    expect(readSyncSubjectAmount([{grandTotal: null, actualAmount: "", amount: false}])).toBeNull();
    expect(readSyncSubjectAmount([{grandTotal: null, amount: "12.50"}])).toBe(12.5);
    expect(readSyncSubjectAmount([{amount: Number.NaN, credit_amount: 20}])).toBe(20);
  });
  it("retains explicit zero and negative adjustments", () => {
    expect(readSyncSubjectAmount([{actual_amount: 0, credit_amount: 20}])).toBe(0);
    expect(readSyncSubjectAmount([{amount: -12.5}])).toBe(-12.5);
  });
});
