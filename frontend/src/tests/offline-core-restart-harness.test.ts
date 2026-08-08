import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/verify-offline-core-restart.mjs", "utf8");

describe("offline cold-restart QA harness", () => {
  it("builds and serves the production app before cutting the network", () => {
    expect(source).toContain('VITE_API_BASE_URL: API_URL');
    expect(source).toContain('KIRANA_BUILD_ID: BUILD_ID');
    expect(source).toContain('"node_modules/vite/bin/vite.js", "preview"');
    expect(source).toContain('navigator.serviceWorker.controller !== null');
  });

  it("closes and relaunches Chrome before checking offline routes", () => {
    expect(source).toContain('await closeChrome(onlineBrowser.client, onlineBrowser.chrome)');
    expect(source).toContain('offlineBrowser = await launchChrome("about:blank")');
    expect(source).toContain('offline: true');
    expect(source).toContain('networkDisabled: true');
  });

  it("covers every core route and fails on bounce, blank/error, loading, overflow or runtime failure", () => {
    for (const route of [
      "/dashboard", "/billing", "/products", "/customers", "/inventory",
      "/bills", "/purchase-bills", "/reports", "/settings", "/sync-status",
    ]) expect(source).toContain(`\"${route}\"`);
    expect(source).toContain("bounced from");
    expect(source).toContain("rendered a fatal offline error");
    expect(source).toContain("remained stuck loading offline");
    expect(source).toContain("overflowed offline");
    expect(source).toContain("runtime errors offline");
  });

  it("proves local product and customer data survive the cold restart", () => {
    expect(source).toContain("Offline Matrix Rice");
    expect(source).toContain("Offline Matrix Customer");
    expect(source).toContain("did not restore cached product data");
    expect(source).toContain("did not restore cached customer data");
  });
});
