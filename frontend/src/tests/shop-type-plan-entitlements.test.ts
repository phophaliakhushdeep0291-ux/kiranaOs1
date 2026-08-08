import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_IDS, type BusinessType } from "@/features/core/settings/business-type-store";
import {
  getPlanForBusinessType,
  getPlanForEntitlementSnapshot,
  SHOP_TYPE_ENTITLEMENTS_V1,
} from "@/features/core/subscription/plans";
import { packForBusinessType } from "@/features/verticals/registry";

const PLAN_BASELINE_BULLET_COUNT = 6;

describe("shop-type subscription entitlements", () => {
  it.each(BUSINESS_TYPE_IDS)("keeps %s plan features hierarchical", (businessType) => {
    const starter = getPlanForBusinessType("starter", businessType);
    const growth = getPlanForBusinessType("growth", businessType);
    const business = getPlanForBusinessType("pro", businessType);

    expect(starter.features).toContain(SHOP_TYPE_ENTITLEMENTS_V1);
    expect(starter.features.every((feature) => growth.features.includes(feature))).toBe(true);
    expect(growth.features.every((feature) => business.features.includes(feature))).toBe(true);
    expect(starter.bullets.length).toBeGreaterThan(PLAN_BASELINE_BULLET_COUNT);
  });

  it("puts counter-critical workflows in Starter and operational extras in Growth", () => {
    expect(getPlanForBusinessType("starter", "pharmacy").features).toEqual(expect.arrayContaining(["prescription_tracking", "batch_expiry"]));
    expect(getPlanForBusinessType("starter", "electronics").features).toContain("serial_imei_tracking");
    expect(getPlanForBusinessType("starter", "restaurant").features).toEqual(expect.arrayContaining(["restaurant_tables", "restaurant_kot", "restaurant_menu"]));
    expect(getPlanForBusinessType("starter", "restaurant").features).not.toContain("restaurant_recipe_inventory");
    expect(getPlanForBusinessType("growth", "restaurant").features).toContain("restaurant_recipe_inventory");
    expect(getPlanForBusinessType("starter", "clothing").features).not.toContain("clothing_rentals");
    expect(getPlanForBusinessType("growth", "clothing").features).toContain("clothing_rentals");
  });

  it("grandfathers only the vertical screens an older subscription could already open", () => {
    const legacyClothing = getPlanForEntitlementSnapshot("starter", "clothing", ["basic_billing"]);
    const versionedClothing = getPlanForEntitlementSnapshot("starter", "clothing", [SHOP_TYPE_ENTITLEMENTS_V1]);
    const legacyPharmacy = getPlanForEntitlementSnapshot("starter", "pharmacy", ["basic_billing"]);

    expect(legacyClothing.features).toContain("clothing_rentals");
    expect(versionedClothing.features).not.toContain("clothing_rentals");
    expect(legacyPharmacy.features).toContain("prescription_tracking");
    expect(legacyPharmacy.features).not.toContain("batch_expiry");
  });

  it.each([
    ["clothing", "/rentals", "clothing_rentals"],
    ["footwear", "/size-runs", "footwear_size_runs"],
    ["auto_parts", "/fitment", "vehicle_fitment"],
    ["electronics", "/serial-units", "serial_imei_tracking"],
    ["pharmacy", "/prescriptions", "prescription_tracking"],
    ["stationery", "/book-lists", "academic_book_lists"],
    ["furniture", "/orders", "furniture_order_book"],
    ["cosmetics", "/testers", "tester_stock"],
    ["restaurant", "/kitchen-stock", "restaurant_recipe_inventory"],
  ] as const)("gates the %s route %s with %s", (businessType, path, featureName) => {
    const route = packForBusinessType(businessType as BusinessType).routes.find((item) => item.path === path);
    expect(route?.featureName).toBe(featureName);
  });
});
