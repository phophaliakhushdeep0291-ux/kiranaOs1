import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHARED_NAVIGATION, isPathInBusinessProfile } from "@/features/core/settings/business-profile-bootstrap";

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

  it("keeps the restaurant order inbox closed until marketplace ingestion is enabled", () => {
    const restaurantWithoutMarketplace = [...SHARED_NAVIGATION, "tables", "kitchen-kot"];
    expect(isPathInBusinessProfile("/orders-received", restaurantWithoutMarketplace)).toBe(false);
    // A cached profile from an older server may not carry the Tables key. The
    // explicit business type still keeps the inbox closed until `orders` exists.
    expect(isPathInBusinessProfile("/orders-received", [...SHARED_NAVIGATION], "restaurant")).toBe(false);
    expect(isPathInBusinessProfile("/orders-received", undefined, "restaurant")).toBe(false);
    expect(isPathInBusinessProfile("/tables", restaurantWithoutMarketplace)).toBe(true);

    // The explicit orders key is the future connector opt-in. A non-restaurant
    // shop without Tables keeps its existing customer-order inbox through Sales.
    expect(isPathInBusinessProfile("/orders-received", [...restaurantWithoutMarketplace, "orders"])).toBe(true);
    expect(isPathInBusinessProfile("/orders-received", [...SHARED_NAVIGATION, "orders"], "restaurant")).toBe(true);
    expect(isPathInBusinessProfile("/orders-received", [...SHARED_NAVIGATION])).toBe(true);

    const restaurantNavigation = readFileSync("../backend/src/verticals/restaurant/navigation.js", "utf8");
    const navigationBody = restaurantNavigation.slice(restaurantNavigation.indexOf("["), restaurantNavigation.indexOf("]"));
    const navigationKeys = [...navigationBody.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
    expect(navigationKeys).toContain("tables");
    expect(navigationKeys).not.toContain("orders");

    const routes = readFileSync("src/app/routes.tsx", "utf8");
    expect(routes).toContain('return <Redirect to="/tables" />');
  });

  it("opens the setup wizard after registration and syncs completion", () => {
    const register = readFileSync("src/features/core/auth/pages/RegisterPage.tsx", "utf8");
    const setup = readFileSync("src/features/core/settings/pages/MerchantSetupPage.tsx", "utf8");
    expect(register).toContain('setLocation("/settings/setup")');
    expect(setup).toContain('updateShopSetupStatus("complete")');
  });
});
