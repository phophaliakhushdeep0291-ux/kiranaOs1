import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const billingPage = readFileSync(new URL("../features/billing/pages/BillingPage.tsx", import.meta.url), "utf8");
const billingSearch = readFileSync(new URL("../features/billing/pages/components/BillingSearch.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/layout/Layout.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../features/dashboard/pages/DashboardPage.tsx", import.meta.url), "utf8");

describe("POS workspace responsive design", () => {
  it("keeps secondary billing panels out of ordinary laptop widths", () => {
    expect(billingSearch).toContain("gap-3 2xl:grid");
    expect(billingSearch).not.toContain("gap-3 xl:grid\" style={{ height: \"260px\" }}");
  });

  it("uses one amount-specific mobile checkout action above navigation", () => {
    expect(billingPage).toContain("Collect ₹${grandTotal.toLocaleString(\"en-IN\")}");
    expect(billingPage).toContain("+ 1.5rem + env(safe-area-inset-bottom)");
  });

  it("removes redundant floating actions while billing", () => {
    expect(layout.match(/cleanPath\(loc\) !== \"\/billing\"/g)).toHaveLength(2);
  });

  it("does not squeeze seven owner metrics into a standard laptop row", () => {
    expect(dashboard).toContain("xl:grid-cols-4 2xl:grid-cols-7");
  });
});
