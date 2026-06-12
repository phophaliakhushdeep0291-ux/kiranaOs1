import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const billingPage = readFileSync("src/features/billing/pages/BillingPage.tsx", "utf8");
const billingSummary = readFileSync("src/features/billing/pages/components/BillingSummary.tsx", "utf8");

describe("billing responsive layout", () => {
  it("allows the billing page to scroll naturally on mobile while keeping desktop POS split-screen", () => {
    expect(billingPage).toContain("min-h-[calc(100dvh-76px)]");
    expect(billingPage).toContain("lg:h-[calc(100dvh-76px)] lg:overflow-hidden");
    expect(billingPage).toContain("lg:h-full lg:flex-row");
  });

  it("applies the saved cart summary width only at desktop breakpoint", () => {
    expect(billingSummary).toContain("lg:w-[var(--bill-summary-width)]");
    expect(billingSummary).toContain("--bill-summary-width");
    expect(billingSummary).not.toContain("style={{ width: summaryWidth");
  });
});
