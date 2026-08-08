export const PLAN_CODES = ["starter", "standard", "growth", "pro"];

// Standard remains a valid code for existing subscriptions and signed device
// licenses, but it is no longer sold to new customers. Public checkout surfaces
// offer Starter, Growth and Business (stored as `pro` for DB compatibility).
export const PUBLIC_PLAN_CODES = ["starter", "growth", "pro"];

export const PLAN_ORDER = {
  starter: 1,
  standard: 2,
  growth: 3,
  pro: 4,
};

const starterFeatures = [
  "basic_billing",
  "rough_bill",
  "paid_udhar_bill",
  "customer_ledger",
  "record_payment",
  "basic_products",
  "offline_billing",
  "seven_day_local_reports",
  "cloud_backup",
  // Minimum two devices means Starter must include real two-way sync too.
  "auto_two_way_sync",
  "basic_recycle_bin",
  // Core shopkeeping workflows are visible in the main app shell, so they must
  // stay usable on Starter instead of failing after the user opens the page.
  "supplier_entry",
  "purchase_entry",
  "stock_adjustment",
  // One-off receipt delivery is table stakes. Bulk/scheduled reminders remain Pro.
  "single_bill_whatsapp",
];

const standardOnlyFeatures = [
  "thirty_day_reports",
  "customer_payment_history",
  "stock_tracking",
  "low_stock_alerts",
  "daily_sales_summary",
  "pdf_bill_share",
  "basic_owner_dashboard",
  "pin_protected_delete",
];

const growthOnlyFeatures = [
  "staff_login",
  "role_based_access",
  "advanced_udhar_reports",
  "profit_estimate",
  "dynamic_customer_pricing",
  "quantity_based_pricing",
  "payment_mode_reports",
  "monthly_reports",
  "csv_import_export",
  "advanced_recycle_bin",
  "audit_logs",
  "priority_support",
];

const proOnlyFeatures = [
  "multi_counter_billing",
  "multi_store",
  "loyalty_program",
  "advanced_inventory",
  "batch_expiry",
  "gst_reports",
  "tally_export",
  "whatsapp_reminders",
  "owner_mobile_dashboard",
  "cloud_bill_archive",
  "yearly_reports",
  "staff_performance_report",
  "advanced_analytics",
  "api_webhook_later",
  "premium_support",
];

// Version marker stored with new shop-type-aware subscription snapshots. A
// subscription without it predates vertical plan gates and is grandfathered so
// adding the gates cannot take an existing workflow away from a live shop.
export const SHOP_TYPE_ENTITLEMENTS_V1 = "shop_type_entitlements_v1";

export const SHOP_TYPE_FEATURES = Object.freeze([
  "product_variants",
  "clothing_rentals",
  "footwear_size_runs",
  "vehicle_fitment",
  "serial_imei_tracking",
  "prescription_tracking",
  "academic_book_lists",
  "furniture_order_book",
  "tester_stock",
  "restaurant_tables",
  "restaurant_kot",
  "restaurant_menu",
  "restaurant_recipe_inventory",
]);

// Essentials are included in Starter for the trade that needs them at the
// counter. Growth adds workflows that improve control or expand the operation;
// Business inherits both and continues to carry multi-counter/multi-store scale.
export const BUSINESS_TYPE_PLAN_FEATURES = Object.freeze({
  kirana: {
    starter: ["batch_expiry"],
    growth: ["advanced_inventory"],
  },
  clothing: {
    starter: ["product_variants"],
    growth: ["clothing_rentals", "loyalty_program"],
  },
  footwear: {
    starter: ["product_variants", "footwear_size_runs"],
    growth: ["loyalty_program"],
  },
  auto_parts: {
    starter: ["vehicle_fitment"],
    growth: ["advanced_inventory"],
  },
  electronics: {
    starter: ["serial_imei_tracking"],
    growth: ["advanced_inventory"],
  },
  pharmacy: {
    starter: ["batch_expiry", "prescription_tracking"],
    growth: ["advanced_inventory"],
  },
  stationery: {
    starter: ["academic_book_lists"],
    growth: [],
  },
  furniture: {
    starter: ["product_variants", "furniture_order_book"],
    growth: ["advanced_inventory"],
  },
  cosmetics: {
    starter: ["product_variants", "batch_expiry", "tester_stock"],
    growth: ["loyalty_program"],
  },
  restaurant: {
    starter: ["batch_expiry", "restaurant_tables", "restaurant_kot", "restaurant_menu"],
    growth: ["restaurant_recipe_inventory", "advanced_inventory"],
  },
  other: {
    starter: [],
    growth: [],
  },
});

export const PLAN_CONFIGS = {
  starter: {
    code: "starter",
    name: "Starter",
    priceMonthlyPaise: 24900,
    priceYearlyPaise: 249900,
    maxDevices: 2,
    maxStores: 1,
    maxStaff: 0,
    features: [...starterFeatures, ...standardOnlyFeatures],
  },
  standard: {
    code: "standard",
    name: "Legacy Standard",
    priceMonthlyPaise: 39900,
    priceYearlyPaise: 39900 * 12,
    maxDevices: 2,
    maxStores: 1,
    maxStaff: 0,
    features: [...starterFeatures, ...standardOnlyFeatures],
  },
  growth: {
    code: "growth",
    name: "Growth",
    priceMonthlyPaise: 59900,
    priceYearlyPaise: 499900,
    maxDevices: 5,
    maxStores: 1,
    maxStaff: 5,
    features: [...starterFeatures, ...standardOnlyFeatures, ...growthOnlyFeatures],
  },
  pro: {
    code: "pro",
    name: "Business",
    priceMonthlyPaise: 99900,
    priceYearlyPaise: 899900,
    maxDevices: 10,
    maxStores: 10,
    maxStaff: 20,
    features: [...starterFeatures, ...standardOnlyFeatures, ...growthOnlyFeatures, ...proOnlyFeatures],
  },
};

// New-sale pricing by trade, benchmarked against Indian POS list prices on
// 2026-08-08. Existing subscriptions never read this matrix: their price and
// feature snapshots remain authoritative until an explicit plan change.
export const BUSINESS_TYPE_PLAN_PRICING = Object.freeze({
  kirana:      { starter: [24900, 249900], growth: [59900, 499900], pro: [99900, 899900] },
  stationery:  { starter: [24900, 249900], growth: [59900, 499900], pro: [99900, 899900] },
  other:       { starter: [24900, 249900], growth: [59900, 499900], pro: [99900, 899900] },
  clothing:    { starter: [34900, 349900], growth: [69900, 599900], pro: [109900, 999900] },
  footwear:    { starter: [34900, 349900], growth: [69900, 599900], pro: [109900, 999900] },
  cosmetics:   { starter: [34900, 349900], growth: [69900, 599900], pro: [109900, 999900] },
  auto_parts:  { starter: [39900, 399900], growth: [79900, 699900], pro: [119900, 1099900] },
  electronics: { starter: [39900, 399900], growth: [79900, 699900], pro: [119900, 1099900] },
  furniture:   { starter: [39900, 399900], growth: [79900, 699900], pro: [119900, 1099900] },
  pharmacy:    { starter: [49900, 499900], growth: [89900, 799900], pro: [129900, 1199900] },
  restaurant:  { starter: [59900, 599900], growth: [99900, 899900], pro: [149900, 1399900] },
});

export function normalizeBusinessType(businessType) {
  return Object.hasOwn(BUSINESS_TYPE_PLAN_PRICING, businessType) ? businessType : "other";
}

export function getPlanConfigForBusinessType(planCode = "starter", businessType = "kirana") {
  const base = getPlanConfig(planCode);
  if (planCode === "standard") return base;
  const normalizedType = normalizeBusinessType(businessType);
  const [priceMonthlyPaise, priceYearlyPaise] = BUSINESS_TYPE_PLAN_PRICING[normalizedType][planCode] ?? [];
  const vertical = BUSINESS_TYPE_PLAN_FEATURES[normalizedType];
  const starterEntitlements = vertical.starter;
  const growthEntitlements = planAtLeast(planCode, "growth") ? vertical.growth : [];
  return {
    ...base,
    priceMonthlyPaise: priceMonthlyPaise ?? base.priceMonthlyPaise,
    priceYearlyPaise: priceYearlyPaise ?? base.priceYearlyPaise,
    features: [...new Set([...base.features, SHOP_TYPE_ENTITLEMENTS_V1, ...starterEntitlements, ...growthEntitlements])],
  };
}

export const FIRST_YEAR_ONBOARDING_SKU = Object.freeze({
  code: "FIRST_YEAR_ONBOARDING",
  name: "First-year shop launch service",
  amountPaise: 499900,
  includes: ["in_person_installation", "starter_catalog_entry", "owner_and_staff_training", "supported_hardware_setup", "first_year_support"],
});

export function validatePlanCode(planCode) {
  return PLAN_CODES.includes(planCode);
}

export function getPlanConfig(planCode = "starter") {
  return PLAN_CONFIGS[planCode] ?? PLAN_CONFIGS.starter;
}

export function serializeFeatures(planCode) {
  return JSON.stringify(getPlanConfig(planCode).features);
}

export function deserializeFeatures(featuresJson) {
  if (Array.isArray(featuresJson)) return featuresJson;
  try {
    const parsed = JSON.parse(featuresJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function planAtLeast(actualPlanCode, minimumPlanCode) {
  return (PLAN_ORDER[actualPlanCode] ?? 0) >= (PLAN_ORDER[minimumPlanCode] ?? 999);
}

export const DEFAULT_TRIAL_DAYS = 7;
export const DEFAULT_GRACE_DAYS = 3;
