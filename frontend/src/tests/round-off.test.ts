import { describe, expect, it } from "vitest";
import { applyRoundOff, roundToRupee } from "@/lib/money";
import { applyRoundOff as applyRoundOffFromBilling } from "@/features/billing/pages/billing-calculations";
import { billCreationSchema } from "@/lib/validation";

describe("nearest-rupee round-off", () => {
  it("rounds up from ₹0.50 and above (Indian counter convention)", () => {
    expect(applyRoundOff(247.5, true)).toEqual({ payable: 248, roundOff: 0.5 });
    expect(applyRoundOff(247.6, true)).toEqual({ payable: 248, roundOff: 0.4 });
    expect(applyRoundOff(247.99, true)).toEqual({ payable: 248, roundOff: 0.01 });
  });

  it("rounds down below ₹0.50 (shop keeps the paise it can't hand back)", () => {
    expect(applyRoundOff(247.49, true)).toEqual({ payable: 247, roundOff: -0.49 });
    expect(applyRoundOff(247.3, true)).toEqual({ payable: 247, roundOff: -0.3 });
  });

  it("leaves a whole-rupee total untouched", () => {
    expect(applyRoundOff(248, true)).toEqual({ payable: 248, roundOff: 0 });
  });

  it("passes paise straight through when the setting is off", () => {
    expect(applyRoundOff(247.6, false)).toEqual({ payable: 247.6, roundOff: 0 });
  });

  it("normalizes junk input to 0 instead of NaN", () => {
    expect(applyRoundOff(Number.NaN, true)).toEqual({ payable: 0, roundOff: 0 });
    expect(roundToRupee(undefined)).toBe(0);
  });

  it("is the same function billing imports (no drift between the money util and the counter)", () => {
    expect(applyRoundOffFromBilling).toBe(applyRoundOff);
  });
});

describe("bill validation accepts the rounded tender", () => {
  // Regression: the counter collects the nearest rupee, so the paid-vs-total guard must
  // compare against the rounded total. Before round-off was threaded through, a legitimate
  // ₹248 tender on a ₹247.60 bill was rejected as "paid exceeds total".
  const base = {
    billType: "normal_sale" as const,
    items: [{ name: "Atta", quantity: 1, enteredUnit: "kg", ratePerRateUnit: 247.6, lineDiscount: 0, gstRate: 0 }],
    customerName: "Walk-in",
  };

  it("accepts a rounded-up cash tender when round-off is on", () => {
    const result = billCreationSchema.safeParse({
      ...base,
      roundOff: true,
      payments: [{ mode: "cash", amount: 248 }],
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a tender above the rounded total", () => {
    const result = billCreationSchema.safeParse({
      ...base,
      roundOff: true,
      payments: [{ mode: "cash", amount: 260 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects the same rounded-up tender when round-off is off (no free pass)", () => {
    const result = billCreationSchema.safeParse({
      ...base,
      roundOff: false,
      payments: [{ mode: "cash", amount: 248 }],
    });
    expect(result.success).toBe(false);
  });
});
