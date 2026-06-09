export const PLAN_CODES = ["starter", "standard", "growth", "pro"];

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
  "basic_recycle_bin",
];

const standardOnlyFeatures = [
  "auto_two_way_sync",
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
  "supplier_entry",
  "purchase_entry",
  "stock_adjustment",
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
    priceMonthlyPaise: 29900,
    priceYearlyPaise: 29900 * 12,
    maxDevices: 1,
    maxStores: 1,
    maxStaff: 0,
    features: starterFeatures,
  },
  standard: {
    code: "standard",
    name: "Standard",
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
    priceMonthlyPaise: 49900,
    priceYearlyPaise: 49900 * 12,
    maxDevices: 3,
    maxStores: 1,
    maxStaff: 5,
    features: [...starterFeatures, ...standardOnlyFeatures, ...growthOnlyFeatures],
  },
  pro: {
    code: "pro",
    name: "Pro",
    priceMonthlyPaise: 69900,
    priceYearlyPaise: 69900 * 12,
    maxDevices: 5,
    maxStores: 2,
    maxStaff: 15,
    features: [...starterFeatures, ...standardOnlyFeatures, ...growthOnlyFeatures, ...proOnlyFeatures],
  },
};

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
