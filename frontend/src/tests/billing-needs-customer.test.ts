import { describe, expect, it } from "vitest";
import { billNeedsCustomer } from "@/features/billing/pages/billing-calculations";

const base = {
  isUdharEntry: false,
  creditAmount: 0,
  isCreditMode: false,
  isSplitMode: false,
  splitUdharAmount: 0,
};

describe("billNeedsCustomer", () => {
  it("does NOT require a customer for a plain walk-in cash/UPI sale", () => {
    // Regression: splitUdharAmount defaults to grandTotal (e.g. 50) outside Split mode.
    // It must not force a customer on a normal cash sale.
    expect(billNeedsCustomer({ ...base, splitUdharAmount: 50 })).toBe(false);
  });

  it("requires a customer for an udhar-entry bill", () => {
    expect(billNeedsCustomer({ ...base, isUdharEntry: true })).toBe(true);
  });

  it("requires a customer when any amount goes to credit/udhar", () => {
    expect(billNeedsCustomer({ ...base, creditAmount: 40 })).toBe(true);
  });

  it("requires a customer in full-credit (Udhar) payment mode", () => {
    expect(billNeedsCustomer({ ...base, isCreditMode: true })).toBe(true);
  });

  it("requires a customer only when a Split bill leaves an udhar remainder", () => {
    expect(billNeedsCustomer({ ...base, isSplitMode: true, splitUdharAmount: 30 })).toBe(true);
    // Split fully covered by cash+UPI -> no remainder -> no customer needed.
    expect(billNeedsCustomer({ ...base, isSplitMode: true, splitUdharAmount: 0 })).toBe(false);
  });
});
