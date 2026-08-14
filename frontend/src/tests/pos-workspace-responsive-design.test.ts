import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const billingPage = readFileSync(new URL("../features/core/billing/pages/BillingPage.tsx", import.meta.url), "utf8");
const billingSearch = readFileSync(new URL("../features/core/billing/pages/components/BillingSearch.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/layout/Layout.tsx", import.meta.url), "utf8");
const mobileChrome = readFileSync(new URL("../components/layout/MobileAppChrome.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../features/core/dashboard/pages/DashboardPage.tsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../features/core/products/pages/ProductsPage.tsx", import.meta.url), "utf8");
const productFormPanel = readFileSync(new URL("../features/core/products/pages/components/ProductFormPanel.tsx", import.meta.url), "utf8");
const productQueries = readFileSync(new URL("../features/core/products/queries.ts", import.meta.url), "utf8");
const billingSummary = readFileSync(new URL("../features/core/billing/pages/components/BillingSummary.tsx", import.meta.url), "utf8");
const pageLoading = readFileSync(new URL("../components/shared/PageLoading.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("POS workspace responsive design", () => {
  it("keeps secondary billing panels out of ordinary laptop widths", () => {
    expect(billingSearch).toContain("gap-3 2xl:grid");
    expect(billingSearch).not.toContain("gap-3 xl:grid\" style={{ height: \"260px\" }}");
  });

  it("uses one amount-specific mobile checkout action above navigation", () => {
    expect(billingPage).toContain('t("billing.page.reviewCollect", { amount: grandTotal.toLocaleString("en-IN") })');
    expect(billingPage).toContain("var(--app-mobile-bottom-nav-clearance)");
    expect(billingPage).toContain("pb-[calc(var(--app-mobile-fixed-action-height)+2rem)]");
    expect(styles).toContain("--app-mobile-bottom-nav-clearance");
    expect(styles).toContain("--app-mobile-fixed-action-height");
    expect(styles).toContain("--app-mobile-content-bottom-clearance");
    expect(styles).toContain("--app-mobile-checkout-panel-clearance");
    expect(billingPage).toContain('aria-label={mobileCheckoutOpen ? t("billing.page.reviewCollectPayment") : undefined}');
    expect(billingPage).toContain("pb-[var(--app-mobile-checkout-panel-clearance)]");
    expect(billingPage).toContain("cart.length > 0 && !mobileCheckoutOpen");
    expect(billingSummary).toContain("relative flex h-full min-h-0");
    expect(billingSummary).toContain('<ScrollArea className="min-h-0 flex-1">');
  });

  it("uses the local-first product catalogue inside billing", () => {
    expect(billingPage).toContain('import { useListProducts } from "@/features/core/products/queries";');
    expect(billingPage).toContain('window.addEventListener("kirana:local-data-changed", loadLocalProducts)');
    expect(billingPage).toContain("products.data === undefined ? localProductRows : products.data");
    expect(productQueries).toContain("mergeProducts(fresh, localRows)");
    expect(billingPage).not.toContain("useListProducts, type Bill");
    expect(productQueries).toContain("cached.length > 0 ? cached : undefined");
  });

  it("keeps mobile navigation unobstructed and removes redundant billing actions", () => {
    expect(layout.match(/cleanPath\(loc\) !== \"\/billing\"/g)).toHaveLength(1);
    expect(mobileChrome).toContain('data-app-mobile-bottom-nav="true"');
    expect(mobileChrome).toContain('data-app-mobile-topbar="true"');
    expect(layout).not.toContain('aria-label="Create new bill"');
    expect(billingSummary).toContain("hidden grid-cols-5 gap-1.5 border-t");
  });

  it("does not squeeze seven owner metrics into a standard laptop row", () => {
    expect(dashboard).toContain("xl:grid-cols-4 2xl:grid-cols-7");
    // These assert the desktop and mobile quick-start blocks are both present.
    // They match on translation keys rather than English prose because the
    // dashboard now reads its copy from the dictionary — pinning the literal
    // would fail the moment a screen is translated, which is backwards.
    expect(dashboard).toContain('t("dashboard.quickStartSteps")');
    expect(dashboard).toContain('t("dashboard.getReady")');
  });

  it("keeps product overview compact and avoids a duplicate floating add action", () => {
    expect(products).toContain("grid grid-cols-2 gap-2.5");
    expect(products).not.toContain("button-add-product-mobile");
    expect(products).toContain('className="app-table-scroll hidden overflow-x-auto lg:block"');
    expect(products).toContain("space-y-2.5 p-2.5 lg:hidden");
    expect(productFormPanel).toContain('data-mobile-task-panel="product-form"');
    expect(productFormPanel).toContain('document.body.dataset.appMobileTaskOpen = "true"');
    expect(styles).toContain('body[data-app-mobile-task-open="true"] [data-app-mobile-bottom-nav="true"]');
    expect(styles).toContain('body[data-app-mobile-task-open="true"] [data-voice-assistant="true"]');
  });

  it("describes the exact payment action and amount at confirmation", () => {
    expect(billingSummary).toContain("billing.summary.actionCollectCash");
    expect(billingSummary).toContain("billing.summary.actionSaveUdhar");
    expect(billingSummary).toContain('t("billing.summary.paymentAction", { action: paymentAction, amount: fmtRs(grandTotal) })');
  });

  it("uses a compact accessible route-loading state and mobile header", () => {
    expect(pageLoading).toContain('role="status" aria-live="polite"');
    expect(pageLoading).not.toContain("min-h-screen");
    expect(styles).toContain("--app-mobile-topbar-height: 88px");
  });
});
