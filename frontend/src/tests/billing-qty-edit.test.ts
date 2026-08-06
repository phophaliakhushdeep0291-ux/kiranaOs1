import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseQtyDraft } from "@/features/core/billing/pages/billing-calculations";

// Regression: clearing the qty box deleted the cart line. The box pushed
// `Number("") || 0` straight into updateQty, which filters out any line whose
// quantity reaches 0 — so the row vanished the moment it was emptied and the
// quantity could not be retyped at all.

const billingCart = readFileSync("src/features/core/billing/pages/components/BillingCart.tsx", "utf8");
const billingPage = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

describe("parseQtyDraft", () => {
  it("returns null for a cleared box so the line keeps its quantity", () => {
    expect(parseQtyDraft("")).toBeNull();
    expect(parseQtyDraft("   ")).toBeNull();
  });

  it("returns null for keystrokes on the way to a decimal, without deleting the line", () => {
    expect(parseQtyDraft("0")).toBeNull();
    expect(parseQtyDraft("0.")).toBeNull();
    expect(parseQtyDraft(".")).toBeNull();
    expect(parseQtyDraft("-")).toBeNull();
  });

  it("returns null for junk and for non-positive numbers", () => {
    expect(parseQtyDraft("abc")).toBeNull();
    expect(parseQtyDraft("-3")).toBeNull();
    expect(parseQtyDraft("NaN")).toBeNull();
    expect(parseQtyDraft("Infinity")).toBeNull();
  });

  it("accepts whole quantities", () => {
    expect(parseQtyDraft("1")).toBe(1);
    expect(parseQtyDraft("12")).toBe(12);
    expect(parseQtyDraft(" 7 ")).toBe(7);
  });

  it("accepts the loose-item decimals a weighing counter needs", () => {
    expect(parseQtyDraft("0.5")).toBe(0.5);
    expect(parseQtyDraft("1.25")).toBe(1.25);
    expect(parseQtyDraft("0.005")).toBe(0.005);
  });

  it("rounds to the millesimal precision quantities are stored at", () => {
    expect(parseQtyDraft("1.23456")).toBe(1.235);
  });

  it("returns null when a positive value rounds away to zero", () => {
    // 0.0004 is > 0 but stores as 0, and committing 0 removes the line — the very
    // bug this helper exists to prevent.
    expect(parseQtyDraft("0.0004")).toBeNull();
    expect(parseQtyDraft("1e-9")).toBeNull();
  });
});

describe("qty box wiring", () => {
  it("drives the qty box from a draft and commits on blur", () => {
    expect(billingCart).toContain("value={qtyDraft ?? String(item.quantity)}");
    expect(billingCart).toContain("onChange={(e) => onQtyDraftChange(e.target.value)}");
    expect(billingCart).toContain("onBlur={commitQty}");
  });

  it("never pushes a raw parsed value from the qty box again", () => {
    expect(billingCart).not.toContain("onUpdateQty(lineKey, Number(e.target.value) || 0)");
  });

  it("keeps the stepper buttons able to remove a line at zero", () => {
    expect(billingCart).toContain("onUpdateQty(lineKey, item.quantity - 1)");
    expect(billingPage).toContain(".filter((item) => item.quantity > 0)");
  });
});
