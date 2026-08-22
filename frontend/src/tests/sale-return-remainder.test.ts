import { describe, expect, it } from "vitest";
import { buildReturnLineBalances, consumeReturnLine } from "@/features/core/returns/return-math";

describe("linked return remainder accounting", () => {
  it("gives the final partial return the paise remainder", () => {
    const balances = buildReturnLineBalances({
      lines: [{ id: "line-1", quantity: 3, lineTotal: 100, lineDiscount: 0, lineCost: 40, gstRate: 18 }],
      discount: 0,
      gst: 18,
      gstMode: "exclusive",
    });
    const balance = balances.get("line-1")!;
    const first = consumeReturnLine(balance, 1);
    const second = consumeReturnLine(balance, 1);
    const final = consumeReturnLine(balance, 1);

    expect([first.subtotal, second.subtotal, final.subtotal]).toEqual([33.33, 33.33, 33.34]);
    expect([first.gst, second.gst, final.gst]).toEqual([6, 6, 6]);
    expect(first.subtotal + second.subtotal + final.subtotal).toBe(100);
    expect(first.gst + second.gst + final.gst).toBe(18);
  });

  it("rejects returning more than the remaining quantity", () => {
    const balance = buildReturnLineBalances({
      lines: [{ id: "line-1", quantity: 2, lineTotal: 50, lineDiscount: 0, lineCost: 20, gstRate: 0 }],
      discount: 0,
      gst: 0,
      gstMode: "none",
    }).get("line-1")!;
    consumeReturnLine(balance, 1);
    expect(() => consumeReturnLine(balance, 2)).toThrow(/exceeds what remains/i);
  });
});
