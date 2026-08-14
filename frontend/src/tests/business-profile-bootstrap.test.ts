import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("business profile bootstrap wiring", () => {
  it("sends the selected preset during registration", () => {
    const register = readFileSync("src/features/core/auth/pages/RegisterPage.tsx", "utf8");
    expect(register).toContain("businessType: selectedType");
  });

  it("locks the profile selector using server bootstrap state", () => {
    const profile = readFileSync("src/features/core/settings/pages/StoreProfilePage.tsx", "utf8");
    expect(profile).toContain("getShopBootstrap");
    expect(profile).toContain("disabled={businessTypeLocked}");
    // Wording lives in the dictionary now; assert it there and assert the
    // screen renders the matching key, so neither half can drop it.
    const settingsEn = readFileSync("src/features/core/settings/translations/settings-pages.ts", "utf8");
    expect(settingsEn).toContain("Request Business Type Change");
    expect(profile).toContain("settings.store.requestTypeChange");
    expect(profile).toContain("getBusinessTypeCompatibility");
  });

  it("uses bootstrap navigation for desktop, mobile, and direct route access", () => {
    const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");
    const mobile = readFileSync("src/components/layout/MobileAppChrome.tsx", "utf8");
    const routes = readFileSync("src/app/routes.tsx", "utf8");
    expect(layout).toContain("isPathInBusinessProfile");
    expect(mobile).toContain("isPathInBusinessProfile");
    expect(routes).toContain("BusinessProfileRouteGate");
    expect(routes).toContain('capability="BATCH_TRACKING"');
  });

  it("opens the setup wizard after registration and syncs completion", () => {
    const register = readFileSync("src/features/core/auth/pages/RegisterPage.tsx", "utf8");
    const setup = readFileSync("src/features/core/settings/pages/MerchantSetupPage.tsx", "utf8");
    expect(register).toContain('setLocation("/settings/setup")');
    expect(setup).toContain('updateShopSetupStatus("complete")');
  });
});
