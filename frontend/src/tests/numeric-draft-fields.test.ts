import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MIN_QUANTITY, parseNumericDraft, parseQuantityDraft } from "@/components/ui/input";

// Regression: clearing the qty box deleted the cart line. Every numeric box
// parsed its own value inline as `Number(e.target.value) || 0`, so emptying one
// committed a 0 — and updateQty filters out any line whose quantity reaches 0.
// The row vanished on the keystroke that cleared it, so the quantity could not
// be retyped at all.

const billingCart = readFileSync("src/features/core/billing/pages/components/BillingCart.tsx", "utf8");
const billingPage = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

const QTY_BOXES = [
  "src/features/core/billing/pages/components/BillingCart.tsx",
  "src/features/core/bills/components/EditBillDialog.tsx",
  "src/features/core/returns/components/ReturnDialog.tsx",
  "src/features/verticals/furniture-home/orders/components/OrderPanel.tsx",
  "src/features/verticals/pharmacy/prescriptions/components/PrescriptionPanel.tsx",
  "src/features/verticals/stationery-books/book-lists/components/BookListPanel.tsx",
];

describe("parseQuantityDraft", () => {
  it("returns null for a cleared box so the row keeps its quantity", () => {
    expect(parseQuantityDraft("")).toBeNull();
    expect(parseQuantityDraft("   ")).toBeNull();
  });

  it("returns null for keystrokes on the way to a decimal", () => {
    expect(parseQuantityDraft("0")).toBeNull();
    expect(parseQuantityDraft("0.")).toBeNull();
    expect(parseQuantityDraft(".")).toBeNull();
    expect(parseQuantityDraft("-")).toBeNull();
  });

  it("returns null for junk and non-positive numbers", () => {
    expect(parseQuantityDraft("abc")).toBeNull();
    expect(parseQuantityDraft("-3")).toBeNull();
    expect(parseQuantityDraft("NaN")).toBeNull();
    expect(parseQuantityDraft("Infinity")).toBeNull();
  });

  it("accepts whole quantities", () => {
    expect(parseQuantityDraft("1")).toBe(1);
    expect(parseQuantityDraft("12")).toBe(12);
    expect(parseQuantityDraft(" 7 ")).toBe(7);
  });

  it("accepts the loose-item decimals a weighing counter needs", () => {
    expect(parseQuantityDraft("0.5")).toBe(0.5);
    expect(parseQuantityDraft("1.25")).toBe(1.25);
    expect(parseQuantityDraft("0.005")).toBe(0.005);
    expect(parseQuantityDraft("0.001")).toBe(MIN_QUANTITY);
  });

  it("rounds to the precision quantities are stored at", () => {
    expect(parseQuantityDraft("1.23456")).toBe(1.235);
  });

  it("returns null when a positive value rounds away below the minimum", () => {
    // 0.0004 clears a raw `> 0` check but stores as 0, and committing 0 removes
    // the line — the very bug this parser exists to prevent.
    expect(parseQuantityDraft("0.0004")).toBeNull();
    expect(parseQuantityDraft("1e-9")).toBeNull();
  });

  it("accepts a typed zero where zero is a real answer", () => {
    // Returns and exchanges pass min 0: zero means this line is not being
    // returned, which must stay reachable by typing.
    expect(parseQuantityDraft("0", 0)).toBe(0);
    expect(parseQuantityDraft("0.0004", 0)).toBe(0);
    // A cleared box still commits nothing, whatever the minimum.
    expect(parseQuantityDraft("", 0)).toBeNull();
    expect(parseQuantityDraft("-1", 0)).toBeNull();
  });
});

const MONEY_BOXES = [
  "src/features/core/bills/components/EditBillDialog.tsx",
  "src/features/core/billing/pages/components/BillingSummary.tsx",
  "src/features/core/products/pages/components/BulkEditDialog.tsx",
  "src/features/verticals/furniture-home/orders/components/OrderPanel.tsx",
  "src/features/verticals/clothing/rentals/components/RentalBookingPanel.tsx",
];

describe("parseNumericDraft at money precision", () => {
  it("keeps paise and drops the third decimal", () => {
    expect(parseNumericDraft("12.34", 0, 2)).toBe(12.34);
    expect(parseNumericDraft("12.345", 0, 2)).toBe(12.35);
    expect(parseNumericDraft("0.004", 0, 2)).toBe(0);
  });

  it("allows a rate or discount of exactly zero", () => {
    // Unlike a cart line, a money field of 0 is a real answer.
    expect(parseNumericDraft("0", 0, 2)).toBe(0);
  });

  it("still commits nothing for an emptied box", () => {
    expect(parseNumericDraft("", 0, 2)).toBeNull();
    expect(parseNumericDraft("  ", 0, 2)).toBeNull();
    expect(parseNumericDraft("-5", 0, 2)).toBeNull();
  });
});

describe("qty boxes across the app", () => {
  it("no qty box parses its own value inline any more", () => {
    for (const path of QTY_BOXES) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} still parses a qty inline`).not.toMatch(/qty:\s*Number\((e|event)\.target\.value\)\s*\|\|\s*0/);
      expect(source, `${path} still parses a quantity inline`).not.toMatch(/quantity:\s*Number\((e|event)\.target\.value\)\s*\|\|\s*0/);
    }
  });

  it("every qty box goes through the shared draft hook", () => {
    for (const path of QTY_BOXES) {
      expect(readFileSync(path, "utf8"), `${path} does not use useQuantityDraft`).toContain("useQuantityDraft");
    }
  });

  it("no money box parses its own value inline any more", () => {
    for (const path of MONEY_BOXES) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} still parses a rate inline`).not.toMatch(/rate\w*:\s*Number\((e|event)\.target\.value\)\s*\|\|\s*0/i);
      expect(source, `${path} still parses a price inline`).not.toMatch(/price\w*:\s*Number\((e|event)\.target\.value\)\s*\|\|\s*0/i);
      expect(source, `${path} still parses a stock value inline`).not.toMatch(/stockValue:\s*Number\((e|event)\.target\.value\)\s*\|\|\s*0/);
    }
  });

  it("every money box goes through a shared draft hook", () => {
    for (const path of MONEY_BOXES) {
      expect(readFileSync(path, "utf8"), `${path} uses no draft hook`).toMatch(/useMoneyDraft|useNumericDraft/);
    }
  });

  it("keeps the stepper buttons able to remove a billing line at zero", () => {
    expect(billingCart).toContain("onUpdateQty(lineKey, item.quantity - 1)");
    expect(billingPage).toContain(".filter((item) => item.quantity > 0)");
  });
});
