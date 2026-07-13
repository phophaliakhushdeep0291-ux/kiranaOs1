import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const billingPage = readFileSync(new URL("../features/billing/pages/BillingPage.tsx", import.meta.url), "utf8");
const billingSearch = readFileSync(new URL("../features/billing/pages/components/BillingSearch.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/layout/Layout.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../features/dashboard/pages/DashboardPage.tsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../features/products/pages/ProductsPage.tsx", import.meta.url), "utf8");
const billingSummary = readFileSync(new URL("../features/billing/pages/components/BillingSummary.tsx", import.meta.url), "utf8");
const pageLoading = readFileSync(new URL("../components/shared/PageLoading.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("POS workspace responsive design", () => {
  it("keeps secondary billing panels out of ordinary laptop widths", () => {
    expect(billingSearch).toContain("gap-3 2xl:grid");
    expect(billingSearch).not.toContain("gap-3 xl:grid\" style={{ height: \"260px\" }}");
  });

  it("uses one amount-specific mobile checkout action above navigation", () => {
    expect(billingPage).toContain("Review & pay ₹${grandTotal.toLocaleString(\"en-IN\")}");
    expect(billingPage).toContain("var(--app-mobile-bottom-nav-clearance)");
    expect(billingPage).toContain("pb-[calc(var(--app-mobile-fixed-action-height)+2rem)]");
    expect(styles).toContain("--app-mobile-bottom-nav-clearance");
    expect(styles).toContain("--app-mobile-fixed-action-height");
    expect(styles).toContain("--app-mobile-content-bottom-clearance");
    expect(styles).toContain("--app-mobile-checkout-panel-clearance");
    expect(billingPage).toContain('aria-label={mobileCheckoutOpen ? "Review and collect payment" : undefined}');
    expect(billingPage).toContain("pb-[var(--app-mobile-checkout-panel-clearance)]");
    expect(billingPage).toContain("cart.length > 0 && !mobileCheckoutOpen");
  });

  it("keeps mobile navigation unobstructed and removes redundant billing actions", () => {
    expect(layout.match(/cleanPath\(loc\) !== \"\/billing\"/g)).toHaveLength(1);
    expect(layout).not.toContain('aria-label="Create new bill"');
    expect(billingSummary).toContain("hidden grid-cols-5 gap-1.5 border-t");
  });

  it("does not squeeze seven owner metrics into a standard laptop row", () => {
    expect(dashboard).toContain("xl:grid-cols-4 2xl:grid-cols-7");
    expect(dashboard).toContain("Open your counter in three simple steps");
    expect(dashboard).toContain("Get ready for your first customer");
  });

  it("keeps product overview compact and avoids a duplicate floating add action", () => {
    expect(products).toContain("grid grid-cols-2 gap-2.5");
    expect(products).not.toContain("button-add-product-mobile");
    expect(products).toContain('className="app-table-scroll hidden overflow-x-auto lg:block"');
    expect(products).toContain("space-y-2.5 p-2.5 lg:hidden");
  });

  it("describes the exact payment action and amount at confirmation", () => {
    expect(billingSummary).toContain("Collect Cash");
    expect(billingSummary).toContain("Save as Udhar");
    expect(billingSummary).toContain("${paymentAction} · ${fmtRs(grandTotal)}");
  });

  it("uses a compact accessible route-loading state and mobile header", () => {
    expect(pageLoading).toContain('role="status" aria-live="polite"');
    expect(pageLoading).not.toContain("min-h-screen");
    expect(styles).toContain("--app-mobile-topbar-height: 88px");
  });
});
