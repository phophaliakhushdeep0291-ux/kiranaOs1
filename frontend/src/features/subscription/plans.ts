export const PLAN_ORDER = ["starter", "standard", "growth", "pro"] as const;
export type PlanCode = typeof PLAN_ORDER[number];

export type SubscriptionState =
  | "trial"
  | "active"
  | "grace"
  | "expired"
  | "payment_failed"
  | "cancelled";

export type FeatureName =
  | "view_old_data"
  | "new_billing"
  | "basic_billing"
  | "rough_bill"
  | "paid_udhar_bill"
  | "customer_ledger"
  | "record_payment"
  | "basic_products"
  | "offline_billing"
  | "local_reports_7_day"
  | "cloud_backup"
  | "basic_recycle_bin"
  | "basic_support"
  | "automatic_two_way_sync"
  | "reports_30_day"
  | "customer_payment_history"
  | "stock_tracking"
  | "low_stock_alerts"
  | "daily_sales_summary"
  | "pdf_bill_share"
  | "owner_dashboard"
  | "pin_protected_delete"
  | "better_backup"
  | "staff_login"
  | "role_based_access"
  | "advanced_udhar_reports"
  | "profit_loss_estimate"
  | "dynamic_customer_pricing"
  | "quantity_based_pricing"
  | "supplier_entry"
  | "purchase_entry"
  | "stock_adjustment"
  | "payment_mode_reports"
  | "monthly_reports"
  | "csv_import_export"
  | "advanced_recycle_bin"
  | "audit_logs"
  | "priority_support"
  | "multi_counter_billing"
  | "multi_store"
  | "advanced_inventory"
  | "batch_expiry"
  | "gst_reports"
  | "tally_export"
  | "whatsapp_reminders"
  | "owner_mobile_dashboard"
  | "cloud_bill_archive"
  | "yearly_reports"
  | "staff_performance_report"
  | "advanced_analytics"
  | "api_webhook_later"
  | "premium_support"
  | "hindi_voice_billing"
  | "smart_daily_closing"
  | "customer_trust_score"
  | "smart_price_memory"
  | "no_barcode_fast_billing"
  | "offline_confidence_meter"
  | "recovery_mode";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  price: number;
  maxStores: number;
  maxDevices: number;
  headline: string;
  features: FeatureName[];
  bullets: string[];
  highlight?: boolean;
}

const starterFeatures: FeatureName[] = [
  "view_old_data",
  "new_billing",
  "basic_billing",
  "rough_bill",
  "paid_udhar_bill",
  "customer_ledger",
  "record_payment",
  "basic_products",
  "offline_billing",
  "local_reports_7_day",
  "cloud_backup",
  "automatic_two_way_sync",
  "basic_recycle_bin",
  "basic_support",
  "supplier_entry",
  "purchase_entry",
  "stock_adjustment",
  "no_barcode_fast_billing",
  "offline_confidence_meter",
];

const standardExtra: FeatureName[] = [
  "reports_30_day",
  "customer_payment_history",
  "stock_tracking",
  "low_stock_alerts",
  "daily_sales_summary",
  "pdf_bill_share",
  "owner_dashboard",
  "pin_protected_delete",
  "better_backup",
  "smart_daily_closing",
  "recovery_mode",
];

const growthExtra: FeatureName[] = [
  "staff_login",
  "role_based_access",
  "advanced_udhar_reports",
  "profit_loss_estimate",
  "dynamic_customer_pricing",
  "quantity_based_pricing",
  "payment_mode_reports",
  "monthly_reports",
  "csv_import_export",
  "advanced_recycle_bin",
  "audit_logs",
  "priority_support",
  "customer_trust_score",
  "smart_price_memory",
];

const proExtra: FeatureName[] = [
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
  "hindi_voice_billing",
];

export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  starter: {
    code: "starter",
    name: "Starter",
    price: 299,
    maxStores: 1,
    maxDevices: 2,
    headline: "For one shopkeeper using up to two devices.",
    features: starterFeatures,
    bullets: [
      "1 store, 2 devices, owner account only",
      "Basic billing, rough bill, paid/udhar bill",
      "Customer ledger and payment recording",
      "Basic products, offline billing and 7-day offline grace",
      "Supplier entry, purchase entry and stock adjustment",
      "7-day local reports, cloud backup, automatic two-way sync, basic recycle bin",
      "Basic support",
    ],
  },
  standard: {
    code: "standard",
    name: "Standard",
    price: 399,
    maxStores: 1,
    maxDevices: 2,
    headline: "For shops that need safer backup and two devices.",
    features: [...starterFeatures, ...standardExtra],
    bullets: [
      "Everything in Starter",
      "2 devices with automatic two-way sync",
      "30-day reports and customer payment history",
      "Stock tracking, low-stock alerts and daily sales summary",
      "PDF bill share, owner dashboard and PIN-protected delete",
      "Better backup",
    ],
    highlight: true,
  },
  growth: {
    code: "growth",
    name: "Growth",
    price: 499,
    maxStores: 1,
    maxDevices: 3,
    headline: "For growing shops with staff, stock and deeper reports.",
    features: [...starterFeatures, ...standardExtra, ...growthExtra],
    bullets: [
      "Everything in Standard",
      "3 devices, staff login and role-based access",
      "Advanced udhar reports, profit/loss estimate",
      "Dynamic customer pricing and quantity-based pricing",
      "Payment mode reports, monthly reports, CSV import/export",
      "Advanced recycle bin, audit logs and priority support",
    ],
  },
  pro: {
    code: "pro",
    name: "Pro",
    price: 699,
    maxStores: 2,
    maxDevices: 5,
    headline: "For multi-counter shops that need advanced automation.",
    features: [...starterFeatures, ...standardExtra, ...growthExtra, ...proExtra],
    bullets: [
      "Everything in Growth",
      "5 devices, multi-counter billing and up to 2 stores",
      "Advanced inventory with batch/expiry support",
      "GST reports, Tally export and cloud bill archive",
      "Automated WhatsApp reminders and owner mobile dashboard",
      "Yearly reports, staff performance and advanced analytics",
      "API/webhook support later and premium support",
    ],
  },
};

export const FEATURE_LABELS: Record<FeatureName, string> = {
  view_old_data: "View old data",
  new_billing: "New billing",
  basic_billing: "Basic billing",
  rough_bill: "Rough bill",
  paid_udhar_bill: "Paid/udhar bill",
  customer_ledger: "Customer ledger",
  record_payment: "Record payment",
  basic_products: "Basic products",
  offline_billing: "Offline billing",
  local_reports_7_day: "7-day local reports",
  cloud_backup: "Cloud backup",
  basic_recycle_bin: "Basic recycle bin",
  basic_support: "Basic support",
  automatic_two_way_sync: "Automatic two-way sync",
  reports_30_day: "30-day reports",
  customer_payment_history: "Customer payment history",
  stock_tracking: "Product stock tracking",
  low_stock_alerts: "Low-stock alerts",
  daily_sales_summary: "Daily sales summary",
  pdf_bill_share: "PDF bill share",
  owner_dashboard: "Basic owner dashboard",
  pin_protected_delete: "PIN-protected delete",
  better_backup: "Better backup",
  staff_login: "Staff login",
  role_based_access: "Role-based access",
  advanced_udhar_reports: "Advanced udhar reports",
  profit_loss_estimate: "Profit/loss estimate",
  dynamic_customer_pricing: "Dynamic customer pricing",
  quantity_based_pricing: "Quantity-based pricing",
  supplier_entry: "Supplier entry",
  purchase_entry: "Purchase entry",
  stock_adjustment: "Stock adjustment",
  payment_mode_reports: "Payment mode reports",
  monthly_reports: "Monthly reports",
  csv_import_export: "CSV import/export",
  advanced_recycle_bin: "Advanced recycle bin",
  audit_logs: "Audit logs",
  priority_support: "Priority support",
  multi_counter_billing: "Multi-counter billing",
  multi_store: "Multi-store support",
  advanced_inventory: "Advanced inventory",
  batch_expiry: "Batch/expiry support",
  gst_reports: "GST reports",
  tally_export: "Tally export",
  whatsapp_reminders: "Automated WhatsApp reminders",
  owner_mobile_dashboard: "Owner mobile dashboard",
  cloud_bill_archive: "Cloud bill archive",
  yearly_reports: "Yearly reports",
  staff_performance_report: "Staff performance report",
  advanced_analytics: "Advanced analytics",
  api_webhook_later: "API/webhook support later",
  premium_support: "Premium support",
  hindi_voice_billing: "Hindi/Hinglish voice billing",
  smart_daily_closing: "Smart daily closing",
  customer_trust_score: "Customer trust score",
  smart_price_memory: "Smart price memory",
  no_barcode_fast_billing: "No-barcode fast billing",
  offline_confidence_meter: "Offline confidence meter",
  recovery_mode: "Recovery mode",
};

export function getPlan(code: string | null | undefined): PlanDefinition {
  const normalized = String(code ?? "starter").toLowerCase();
  if (normalized === "299") return PLAN_DEFINITIONS.starter;
  if (normalized === "399") return PLAN_DEFINITIONS.standard;
  if (normalized === "499") return PLAN_DEFINITIONS.growth;
  if (normalized === "699") return PLAN_DEFINITIONS.pro;
  return PLAN_DEFINITIONS[(PLAN_ORDER as readonly string[]).includes(normalized) ? normalized as PlanCode : "starter"];
}

export function getRequiredPlanForFeature(featureName: FeatureName): PlanDefinition {
  return PLAN_DEFINITIONS[PLAN_ORDER.find((code) => PLAN_DEFINITIONS[code].features.includes(featureName)) ?? "pro"];
}

export function planRank(code: string | null | undefined): number {
  const normalized = getPlan(code).code;
  return PLAN_ORDER.indexOf(normalized);
}
