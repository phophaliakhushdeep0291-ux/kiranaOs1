import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const billingPage = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
const billingSummary = readFileSync("src/features/core/billing/pages/components/BillingSummary.tsx", "utf8");
const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("billing responsive layout", () => {
  it("allows the billing page to scroll naturally on mobile while keeping desktop POS split-screen", () => {
    expect(billingPage).toContain("min-h-[calc(100dvh-var(--app-mobile-topbar-height)-var(--app-mobile-nav-height))]");
    // The banner height belongs in this subtraction. `--app-desktop-topbar-height`
    // is a static 76px matching the header alone, while the trial/offline banners
    // sit below it: at 1280x800 the workspace ran 45px past the fold. Layout
    // republishes `--app-banner-height` and it stays 0px when no banner shows.
    expect(billingPage).toContain("lg:h-[calc(100dvh-var(--app-desktop-topbar-height)-var(--app-banner-height))] lg:min-h-0 lg:overflow-hidden");
    expect(billingPage).toContain("lg:h-full lg:flex-row");
    expect(billingPage).toContain("overflow-visible lg:min-h-0 lg:overflow-hidden");
  });

  it("applies the saved cart summary width only at desktop breakpoint", () => {
    expect(billingSummary).toContain("lg:w-[var(--bill-summary-width)]");
    expect(billingSummary).toContain("--bill-summary-width");
    expect(billingSummary).not.toContain("style={{ width: summaryWidth");
  });

  it("measures every top banner before rendering the full-height billing workspace", () => {
    const measuredBannerStart = layout.indexOf('<div ref={bannerRef}>');
    const mainStart = layout.indexOf('<main\n          id="main-content"', measuredBannerStart);
    const measuredBanner = layout.slice(measuredBannerStart, mainStart);
    const mainBody = layout.slice(mainStart, layout.indexOf('</main>', mainStart));

    expect(measuredBanner).toContain("<SubscriptionStatusBanner />");
    expect(measuredBanner).toContain("<BackendUnreachableBanner");
    expect(measuredBanner).toContain("<SyncAlertBanner />");
    expect(measuredBanner).toContain("<DemoModeBanner />");
    expect(mainBody).not.toContain("<SyncAlertBanner />");
    expect(mainBody).not.toContain("<DemoModeBanner />");
  });
});
