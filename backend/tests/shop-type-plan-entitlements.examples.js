import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUSINESS_TYPE_PLAN_FEATURES,
  BUSINESS_TYPE_PLAN_PRICING,
  getPlanConfigForBusinessType,
  hasLegacyShopTypeFeatureAccess,
  SHOP_TYPE_ENTITLEMENTS_V1,
} from "../src/modules/subscription/planConfig.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");

for (const businessType of Object.keys(BUSINESS_TYPE_PLAN_PRICING)) {
  const starter = getPlanConfigForBusinessType("starter", businessType);
  const growth = getPlanConfigForBusinessType("growth", businessType);
  const business = getPlanConfigForBusinessType("pro", businessType);

  assert.ok(starter.features.includes(SHOP_TYPE_ENTITLEMENTS_V1), `${businessType} Starter snapshots entitlement version`);
  assert.deepEqual(
    BUSINESS_TYPE_PLAN_FEATURES[businessType].starter.filter((feature) => !starter.features.includes(feature)),
    [],
    `${businessType} Starter includes its counter essentials`,
  );
  assert.deepEqual(starter.features.filter((feature) => !growth.features.includes(feature)), [], `${businessType} Growth inherits Starter`);
  assert.deepEqual(growth.features.filter((feature) => !business.features.includes(feature)), [], `${businessType} Business inherits Growth`);
}

assert.ok(!getPlanConfigForBusinessType("starter", "clothing").features.includes("clothing_rentals"));
assert.ok(getPlanConfigForBusinessType("growth", "clothing").features.includes("clothing_rentals"));
assert.ok(getPlanConfigForBusinessType("starter", "pharmacy").features.includes("prescription_tracking"));
assert.ok(getPlanConfigForBusinessType("starter", "restaurant").features.includes("restaurant_kot"));
assert.ok(!getPlanConfigForBusinessType("starter", "restaurant").features.includes("restaurant_recipe_inventory"));
assert.ok(getPlanConfigForBusinessType("growth", "restaurant").features.includes("restaurant_recipe_inventory"));

assert.equal(hasLegacyShopTypeFeatureAccess(["basic_billing"], "clothing_rentals"), true, "pre-marker shops retain vertical access");
assert.equal(hasLegacyShopTypeFeatureAccess([SHOP_TYPE_ENTITLEMENTS_V1], "clothing_rentals"), false, "versioned snapshots obey the matrix");
assert.equal(hasLegacyShopTypeFeatureAccess(["basic_billing"], "multi_store"), false, "grandfathering is limited to newly gated vertical workflows");

const routeGates = {
  "src/verticals/clothing/rentals/rentals.routes.js": "clothing_rentals",
  "src/verticals/auto-parts/fitment/fitment.routes.js": "vehicle_fitment",
  "src/verticals/electronics/units/units.routes.js": "serial_imei_tracking",
  "src/verticals/footwear/sizes/sizes.routes.js": "footwear_size_runs",
  "src/verticals/furniture-home/orders/orders.routes.js": "furniture_order_book",
  "src/verticals/pharmacy/prescriptions/prescriptions.routes.js": "prescription_tracking",
  "src/verticals/stationery-books/book-lists/book-lists.routes.js": "academic_book_lists",
  "src/verticals/beauty-cosmetics/testers/testers.routes.js": "tester_stock",
  "src/verticals/restaurant/tables/tables.routes.js": "restaurant_tables",
  "src/verticals/restaurant/kot/kot.routes.js": "restaurant_kot",
  "src/verticals/restaurant/menu/menu.routes.js": "restaurant_menu",
  "src/verticals/restaurant/recipes/recipes.routes.js": "restaurant_recipe_inventory",
};

for (const [relativePath, feature] of Object.entries(routeGates)) {
  const source = fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
  assert.ok(source.includes(`requireFeature("${feature}")`), `${relativePath} enforces ${feature} server-side`);
}

console.log("shop-type-plan-entitlements examples: ok");
