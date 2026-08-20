import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/verify-offline-core-restart.mjs", "utf8");

describe("offline cold-restart QA harness", () => {
  it("builds and serves the production app before cutting the network", () => {
    expect(source).toContain('VITE_API_BASE_URL: API_URL');
    expect(source).toContain('KIRANA_BUILD_ID: BUILD_ID');
    expect(source).toContain('KIRANA_OUT_DIR: BUILD_DIR');
    expect(source).toContain('path.join(OUTPUT_DIR, "dist")');
    expect(source).toContain('"node_modules/vite/bin/vite.js", "preview"');
    expect(source).toContain('navigator.serviceWorker.controller !== null');
  });

  it("closes and relaunches Chrome before checking offline routes", () => {
    expect(source).toContain('await closeChrome(onlineBrowser.client, onlineBrowser.chrome, onlineBrowser.debugPort)');
    expect(source).toContain('offlineBrowser = await launchChrome("about:blank", DEBUG_PORT + 1)');
    expect(source).toContain("waitForUrlDown");
    expect(source).toContain("persistent profile's file locks");
    expect(source).toContain('offline: true');
    expect(source).toContain('networkDisabled: true');
    expect(source).not.toContain("for (const [, route] of ROUTES) await navigateOnline");
  });

  it("covers every core route and fails on bounce, blank/error, loading, overflow or runtime failure", () => {
    for (const route of [
      "/dashboard", "/billing", "/import-order", "/returns/new", "/bills",
      "/orders-received", "/sales-overview", "/products", "/customers", "/inventory",
      "/inventory/stock-in", "/inventory/stock-out", "/inventory/adjustments",
      "/inventory/stock-counts", "/categories", "/purchase-bills", "/suppliers",
      "/expenses", "/offers", "/loyalty", "/gift-cards", "/reports",
      "/channel-settlements", "/money-statement", "/daily-closing", "/settings",
      "/settings/store-profile", "/settings/modules", "/settings/printer",
      "/settings/billing", "/settings/staff", "/settings/devices", "/settings/sync",
      "/settings/taxes", "/settings/security", "/settings/notifications",
      "/settings/integrations", "/settings/advanced", "/sync-status", "/plans",
      "/subscription", "/devices", "/help", "/activity-insights", "/staff",
      "/audit-logs", "/assurance", "/recycle-bin", "/smart-tools", "/recovery-mode",
    ]) expect(source).toContain(`\"${route}\"`);
    expect(source).toContain("bounced from");
    expect(source).toContain("rendered a fatal offline error");
    expect(source).toContain("remained stuck loading offline");
    expect(source).toContain("overflowed offline");
    expect(source).toContain("runtime errors offline");
    expect(source).toContain("offline capability label mismatch");
    expect(source).toContain('data-testid="internet-required-route"');
    expect(source).toContain("hasCoreMarker");
  });

  it("proves local product and customer data survive the cold restart", () => {
    expect(source).toContain("Offline Matrix Rice");
    expect(source).toContain("Offline Matrix Customer");
    expect(source).toContain("did not restore cached product data");
    expect(source).toContain("did not restore cached customer data");
    expect(source).toContain("did not expose the encrypted local backup tool offline");
  });
});
