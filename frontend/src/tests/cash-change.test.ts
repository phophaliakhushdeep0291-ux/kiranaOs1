import { describe, expect, it } from "vitest";
import { computeChangeDue, suggestCashTenders } from "@/features/billing/pages/billing-calculations";

describe("computeChangeDue", () => {
  it("returns the surplus when the customer tenders more than the bill", () => {
    expect(computeChangeDue(500, 457)).toBe(43);
    expect(computeChangeDue(1000, 457.5)).toBe(542.5);
  });

  it("is zero for exact or short payment", () => {
    expect(computeChangeDue(457, 457)).toBe(0);
    expect(computeChangeDue(400, 457)).toBe(0);
  });

  it("tolerates blank/NaN inputs", () => {
    expect(computeChangeDue(Number(""), 457)).toBe(0);
    expect(computeChangeDue(500, Number.NaN)).toBe(500);
  });

  it("rounds to paise, clearing float noise", () => {
    // 1000 − 333.33 = 666.67 (not 666.6700000000001).
    expect(computeChangeDue(1000, 333.33)).toBe(666.67);
  });
});

describe("suggestCashTenders", () => {
  it("includes the exact amount, the next ₹100 round-up, and larger notes", () => {
    // 457 → exact 457, round-up 500, next note 2000 (500 already covered).
    expect(suggestCashTenders(457)).toEqual([457, 500, 2000]);
  });

  it("suggests single notes above the total", () => {
    expect(suggestCashTenders(80)).toEqual([80, 100, 200, 500]);
  });

  it("does not round up when the total is already a round hundred", () => {
    const out = suggestCashTenders(500);
    expect(out[0]).toBe(500);
    expect(out).not.toContain(600); // 500 is exact; round-up equals total, skipped
    expect(out).toContain(2000);
  });

  it("caps the number of suggestions", () => {
    expect(suggestCashTenders(30, 3)).toHaveLength(3);
  });

  it("returns nothing for a zero or negative total", () => {
    expect(suggestCashTenders(0)).toEqual([]);
    expect(suggestCashTenders(-5)).toEqual([]);
  });
});
