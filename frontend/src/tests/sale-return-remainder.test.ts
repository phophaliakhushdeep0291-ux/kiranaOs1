import { takeReturnAmount, roundReturnQuantity } from "../../../backend/src/utils/returnMath.js";
import { describe, expect, it } from "vitest";
import { buildReturnLineBalances, consumeReturnLine, linkedReturnRefundTotal, returnPreviewQuantity } from "@/features/core/returns/return-math";

describe("linked return remainder accounting", () => {
  it("retains five-gram quantities through a partial return and reload", () => {
    const input = { lines: [{ id: "tiny", quantity: 0.015, lineTotal: 30, lineDiscount: 0, lineCost: 15, gstRate: 0 }], discount: 0, gst: 0, gstMode: "none" as const };
    const balance = buildReturnLineBalances(input).get("tiny")!;
    expect(returnPreviewQuantity(0.005, balance)).toBe(0.005);
    expect(consumeReturnLine(balance, 0.005)).toMatchObject({ quantity: 0.005, subtotal: 10, cost: 5, finalReturn: false });
    expect(roundReturnQuantity(0.015 - 0.005)).toBe(0.01);
    const reloaded = buildReturnLineBalances({ ...input, previousReturns: [{ gst: 0, gstMode: "none", items: [
      { originalBillItemId: "tiny", quantity: -0.005, lineTotal: -10, lineDiscount: 0, lineCost: -5, gstRate: 0 },
    ] }] }).get("tiny")!;
    expect(consumeReturnLine(reloaded, 0.01)).toMatchObject({ subtotal: 20, cost: 10, finalReturn: true });
  });

  it("caps each partial refund at the original line's remaining paise on both client and server", () => {
    const balance = buildReturnLineBalances({ lines: [{ id: "tiny-tax", quantity: 4, lineTotal: 0.02, lineDiscount: 0, lineCost: 0.02, gstRate: 18 }],
      discount: 0, gst: 0.02, gstMode: "exclusive" }).get("tiny-tax")!;
    let returned = 0;
    const parts = [];
    for (let index = 0; index < 4; index++) {
      const part = consumeReturnLine(balance, 1);
      const server = takeReturnAmount(0.02, returned, 1, 4, index === 3);
      expect(part).toMatchObject({ subtotal: server, gst: server, cost: server });
      returned = Math.round((returned + server) * 100) / 100;
      parts.push(part.gst);
    }
    expect(parts).toEqual([0.01, 0.01, 0, 0]);
    expect(returned).toBe(0.02);
  });

  it("rounds a one-tenth refund of 1.15 to twelve paise on both client and server", () => {
    const balance = buildReturnLineBalances({ lines: [{ id: "tie", quantity: 10, lineTotal: 1.15, lineDiscount: 0, lineCost: 1.15, gstRate: 0 }],
      discount: 0, gst: 0, gstMode: "none" }).get("tie")!;
    expect(consumeReturnLine(balance, 1).subtotal).toBe(0.12);
    expect(takeReturnAmount(1.15, 0, 1, 10, false)).toBe(0.12);
  });

  it("previews rounded final refunds and caps intermediate refunds at the remaining invoice", () => {
    expect(linkedReturnRefundTotal(199.5, 200, true)).toBe(200);
    expect(linkedReturnRefundTotal(199.4, 199, true)).toBe(199);
    expect(linkedReturnRefundTotal(199.4, 199.6, false)).toBe(199.4);
    expect(linkedReturnRefundTotal(199.4, 199.6, true)).toBe(199.6);
    expect(linkedReturnRefundTotal(0.49, 0.25, false)).toBe(0.25);
    expect(linkedReturnRefundTotal(199.5, undefined, true)).toBe(199.5);
  });
  it("keeps a live preview valid as another return consumes its selected quantity", () => {
    const balance = buildReturnLineBalances({
      lines: [{ id: "line-1", quantity: 2, lineTotal: 40, lineDiscount: 0, lineCost: 20, gstRate: 0 }],
      discount: 0, gst: 0, gstMode: "none",
    }).get("line-1")!;
    expect(returnPreviewQuantity(2, balance)).toBe(2);
    consumeReturnLine(balance, 1);
    expect(returnPreviewQuantity(2, balance)).toBe(1);
    expect(consumeReturnLine({ ...balance }, returnPreviewQuantity(2, balance)).subtotal).toBe(20);
    consumeReturnLine(balance, 1);
    expect(returnPreviewQuantity(1, balance)).toBe(0);
    // Preview tolerance must never weaken the write-side limit.
    expect(() => consumeReturnLine(balance, 1)).toThrow(/exceeds what remains/i);
  });
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
