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

export const PLAN_CONFIGS = {
  starter: {
    code: "starter",
    name: "Starter",
    priceMonthlyPaise: 4900,
    priceYearlyPaise: 39900,
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
