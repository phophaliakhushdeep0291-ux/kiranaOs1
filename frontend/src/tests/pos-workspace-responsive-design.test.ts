import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const billingPage = readFileSync(new URL("../features/billing/pages/BillingPage.tsx", import.meta.url), "utf8");
const billingSearch = readFileSync(new URL("../features/billing/pages/components/BillingSearch.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/layout/Layout.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../features/dashboard/pages/DashboardPage.tsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../features/products/pages/ProductsPage.tsx", import.meta.url), "utf8");
const billingSummary = readFileSync(new URL("../features/billing/pages/components/BillingSummary.tsx", import.meta.url), "utf8");

describe("POS workspace responsive design", () => {
  it("keeps secondary billing panels out of ordinary laptop widths", () => {
    expect(billingSearch).toContain("gap-3 2xl:grid");
    expect(billingSearch).not.toContain("gap-3 xl:grid\" style={{ height: \"260px\" }}");
  });

  it("uses one amount-specific mobile checkout action above navigation", () => {
    expect(billingPage).toContain("Review & pay ₹${grandTotal.toLocaleString(\"en-IN\")}");
    expect(billingPage).toContain("+ 1.5rem + env(safe-area-inset-bottom)");
    expect(billingPage).toContain('aria-label={mobileCheckoutOpen ? "Review and collect payment" : undefined}');
  });

  it("removes redundant floating actions while billing", () => {
    expect(layout.match(/cleanPath\(loc\) !== \"\/billing\"/g)).toHaveLength(2);
  });

  it("does not squeeze seven owner metrics into a standard laptop row", () => {
    expect(dashboard).toContain("xl:grid-cols-4 2xl:grid-cols-7");
  });

  it("keeps product overview compact and avoids a duplicate floating add action", () => {
    expect(products).toContain("grid grid-cols-2 gap-2.5");
    expect(products).not.toContain("button-add-product-mobile");
  });

  it("describes the exact payment action and amount at confirmation", () => {
    expect(billingSummary).toContain("Collect Cash");
    expect(billingSummary).toContain("Save as Udhar");
    expect(billingSummary).toContain("${paymentAction} · ${fmtRs(grandTotal)}");
  });
});
