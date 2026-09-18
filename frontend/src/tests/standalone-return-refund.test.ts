import { describe, expect, it } from "vitest";
import { unlinkedReturnLineAmount } from "@/features/core/returns/return-math";

/**
 * "New Return" was a dead end.
 *
 * Found by using it: Returns → New Return → pick 7Up (₹45) → Continue to refund →
 * set quantity 1. The dialog read "1 item · Refund ₹0" and "Process return" stayed
 * disabled, so a standalone return could never be recorded at all.
 *
 * `ReturnLineInput.soldQty` means two different things. On a bill-linked return it
 * is the quantity sold, and the refund is that line's money apportioned by how much
 * comes back. On a standalone return the form sets it to 0 — its own type calls that
 * "unlimited" — because there is no original sale. Pricing read the second case as
 * "sold nothing" and multiplied the rate by zero.
 */

describe("a standalone return line, with no original sale behind it", () => {
  it("refunds quantity x rate instead of zero", () => {
    const line = unlinkedReturnLineAmount({
      returnQty: 1,
      soldQty: 0,
      ratePerRateUnit: 45,
      gstMode: "inclusive",
    });
    expect(line.total).toBe(45);
  });

  it("scales with quantity", () => {
    expect(unlinkedReturnLineAmount({ returnQty: 3, soldQty: 0, ratePerRateUnit: 45, gstMode: "inclusive" }).total).toBe(135);
  });

  it("adds tax on top only when the shop prices exclusive of GST", () => {
    expect(unlinkedReturnLineAmount({ returnQty: 1, soldQty: 0, ratePerRateUnit: 100, gstRate: 18, gstMode: "exclusive" }))
      .toMatchObject({ net: 100, tax: 18, total: 118 });
    // Inclusive is the Indian retail default: the tax is already inside the rate.
    expect(unlinkedReturnLineAmount({ returnQty: 1, soldQty: 0, ratePerRateUnit: 100, gstRate: 18, gstMode: "inclusive" }))
      .toMatchObject({ net: 100, tax: 0, total: 100 });
  });

  it("refunds nothing until a quantity is set, so the button stays disabled", () => {
    expect(unlinkedReturnLineAmount({ returnQty: 0, soldQty: 0, ratePerRateUnit: 45, gstMode: "inclusive" }).total).toBe(0);
  });
});

describe("a bill-linked return line still apportions the original sale", () => {
  it("returns two of five as two fifths of what was charged", () => {
    // The behaviour that was already correct, pinned so the standalone fix cannot
    // quietly start over-refunding a linked return.
    expect(unlinkedReturnLineAmount({
      returnQty: 2,
      soldQty: 5,
      ratePerRateUnit: 45,
      soldLineTotal: 225,
      gstMode: "inclusive",
    }).total).toBe(90);
  });

  it("prices from rate and discount when the sold line total is unknown", () => {
    expect(unlinkedReturnLineAmount({
      returnQty: 1,
      soldQty: 4,
      ratePerRateUnit: 50,
      lineDiscount: 40,
      gstMode: "inclusive",
    }).total).toBe(40); // (4 x 50 - 40) x 1/4
  });

  it("never refunds more than was charged when the discount exceeds the line", () => {
    expect(unlinkedReturnLineAmount({
      returnQty: 1,
      soldQty: 1,
      ratePerRateUnit: 50,
      lineDiscount: 500,
      gstMode: "inclusive",
    }).total).toBe(0);
  });
});
