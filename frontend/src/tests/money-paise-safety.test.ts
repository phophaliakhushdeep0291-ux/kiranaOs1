import { describe, expect, it } from "vitest";
import {
  addMoney,
  formatMoney,
  moneyExceeds,
  roundMoney,
  subtractMoney,
  toPaise,
} from "@/lib/money";

describe("money paise safety", () => {
  it("keeps split payment totals exact to one paise", () => {
    expect(addMoney(49, 72.5)).toBe(121.5);
    expect(toPaise(addMoney(49, 72.5))).toBe(12_150);
    expect(subtractMoney(121.5, 49)).toBe(72.5);
  });

  it("compares payment limits in integer paise", () => {
    expect(moneyExceeds(121.5, 121.5)).toBe(false);
    expect(moneyExceeds(121.51, 121.5)).toBe(true);
    expect(moneyExceeds(0.1 + 0.2, 0.3)).toBe(false);
  });

  it("shows paise when present without rounding rupees", () => {
    expect(roundMoney(121.5)).toBe(121.5);
    expect(formatMoney(121.5)).toBe("₹121.50");
    expect(formatMoney(122)).toBe("₹122");
  });
});
