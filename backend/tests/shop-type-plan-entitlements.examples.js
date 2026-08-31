import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUSINESS_TYPE_PLAN_FEATURES,
  BUSINESS_TYPE_PLAN_PRICING,
  getPlanConfigForBusinessType,
  hasLegacyShopTypeFeatureAccess,
  isOnboardingServiceAvailable,
  offeredPlanCodesForBusinessType,
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
  assert.ok(starter.priceYearlyPaise < growth.priceYearlyPaise, `${businessType} Growth costs more than Starter`);
  // A trade sold fewer tiers than it has codes for — restaurant is sold as
  // Counter and Dine-in — leaves `pro` resolving onto the top plan it does sell,
  // so its price matches rather than exceeds. What must never happen is a higher
  // code costing LESS than a lower one, which would make the ladder nonsense.
  const sold = offeredPlanCodesForBusinessType(businessType);
  assert.ok(
    sold.includes("pro") ? growth.priceYearlyPaise < business.priceYearlyPaise : growth.priceYearlyPaise === business.priceYearlyPaise,
    `${businessType} Business is priced above Growth, or equal to it where Business is not sold`,
  );
}

// Restaurant is now two plans: Counter at ₹799 and Dine-in at ₹1,499, each
// billed yearly as ten months.
assert.equal(getPlanConfigForBusinessType("starter", "restaurant").priceYearlyPaise, 799000);
assert.equal(getPlanConfigForBusinessType("growth", "restaurant").priceYearlyPaise, 1499000);
assert.equal(getPlanConfigForBusinessType("growth", "auto_parts").priceYearlyPaise, 899900);
assert.equal(getPlanConfigForBusinessType("starter", "kirana").priceYearlyPaise, 99900);
assert.equal(getPlanConfigForBusinessType("growth", "kirana").priceYearlyPaise, 299900);
assert.equal(getPlanConfigForBusinessType("pro", "kirana").priceYearlyPaise, 599900);
assert.equal(getPlanConfigForBusinessType("starter", "kirana").maxDevices, 1);
assert.equal(getPlanConfigForBusinessType("growth", "kirana").maxDevices, 3);
assert.ok(!getPlanConfigForBusinessType("starter", "kirana").features.includes("purchase_entry"));
assert.ok(getPlanConfigForBusinessType("growth", "kirana").features.includes("purchase_entry"));
assert.ok(!getPlanConfigForBusinessType("growth", "kirana").features.includes("dynamic_customer_pricing"));
assert.ok(getPlanConfigForBusinessType("pro", "kirana").features.includes("dynamic_customer_pricing"));
const kiranaPromises = {
  starter: ["basic_billing", "paid_udhar_bill", "offline_billing", "basic_products", "customer_ledger", "seven_day_local_reports", "cloud_backup", "single_bill_whatsapp"],
  growth: ["purchase_entry", "supplier_entry", "stock_adjustment", "low_stock_alerts", "batch_expiry", "auto_two_way_sync", "thirty_day_reports", "basic_owner_dashboard", "staff_login", "role_based_access", "pdf_bill_share"],
  pro: ["dynamic_customer_pricing", "quantity_based_pricing", "loyalty_program", "advanced_inventory", "gst_reports", "tally_export", "monthly_reports", "yearly_reports", "audit_logs", "staff_performance_report", "whatsapp_reminders", "advanced_analytics", "premium_support", "multi_store"],
};
for (const [code, promisedFeatures] of Object.entries(kiranaPromises)) {
  const actualFeatures = getPlanConfigForBusinessType(code, "kirana").features;
  assert.deepEqual(promisedFeatures.filter((feature) => !actualFeatures.includes(feature)), [], `${code} includes every advertised Kirana feature`);
}
assert.equal(isOnboardingServiceAvailable("kirana"), false);
assert.equal(isOnboardingServiceAvailable("restaurant"), true);

assert.ok(!getPlanConfigForBusinessType("starter", "clothing").features.includes("clothing_rentals"));
assert.ok(getPlanConfigForBusinessType("growth", "clothing").features.includes("clothing_rentals"));
assert.ok(getPlanConfigForBusinessType("starter", "pharmacy").features.includes("prescription_tracking"));
// Restaurant divides at "do guests sit down?": Counter cooks and sells, Dine-in
// runs a floor. Kitchen tickets move UP to Dine-in because a cloud kitchen has
// no pass to route to, and recipes move DOWN to Counter because a kitchen with
// no floor still needs selling a dish to move its ingredients.
assert.ok(!getPlanConfigForBusinessType("starter", "restaurant").features.includes("restaurant_kot"));
assert.ok(!getPlanConfigForBusinessType("starter", "restaurant").features.includes("restaurant_tables"));
assert.ok(getPlanConfigForBusinessType("starter", "restaurant").features.includes("restaurant_recipe_inventory"));
assert.ok(getPlanConfigForBusinessType("growth", "restaurant").features.includes("restaurant_kot"));
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
