import type { BusinessType } from "@/features/core/settings/business-type-store";

export const PLAN_ORDER = ["starter", "standard", "growth", "pro"] as const;
export type PlanCode = typeof PLAN_ORDER[number];
export const PUBLIC_PLAN_ORDER = ["starter", "growth", "pro"] as const satisfies readonly PlanCode[];
export type BillingCycle = "monthly" | "yearly";

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
  | "loyalty_program"
  | "advanced_inventory"
  | "batch_expiry"
  | "gst_reports"
  | "tally_export"
  | "whatsapp_reminders"
  | "single_bill_whatsapp"
  | "owner_mobile_dashboard"
  | "cloud_bill_archive"
  | "yearly_reports"
  | "staff_performance_report"
  | "advanced_analytics"
  | "api_webhook_later"
  | "channel_settlement"
  | "premium_support"
  | "hindi_voice_billing"
  | "smart_daily_closing"
  | "customer_trust_score"
  | "smart_price_memory"
  | "no_barcode_fast_billing"
  | "offline_confidence_meter"
  | "recovery_mode"
  | "shop_type_entitlements_v1"
  | "product_variants"
  | "clothing_rentals"
  | "footwear_size_runs"
  | "vehicle_fitment"
  | "serial_imei_tracking"
  | "prescription_tracking"
  | "academic_book_lists"
  | "furniture_order_book"
  | "tester_stock"
  | "restaurant_tables"
  | "restaurant_kot"
  | "restaurant_menu"
  | "restaurant_recipe_inventory";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  price: number;
  annualPrice: number;
  maxStores: number;
  maxDevices: number;
  maxStaff: number;
  headline: string;
  features: FeatureName[];
  bullets: string[];
  highlight?: boolean;
  legacy?: boolean;
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
  "single_bill_whatsapp",
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
  "channel_settlement",
  "premium_support",
  "hindi_voice_billing",
];

export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  starter: {
    code: "starter",
    name: "Starter",
    price: 249,
    annualPrice: 2499,
    maxStores: 1,
    maxDevices: 2,
    maxStaff: 0,
    headline: "Serviced launch bundle for an owner-run shop.",
    features: [...starterFeatures, ...standardExtra],
    bullets: [
      "1 store, 2 registered devices and 1 billing counter",
      "Cash, UPI, split and udhar billing—even offline",
      "Products, stock, purchases, suppliers and low-stock alerts",
      "Customer ledger, payment history and PDF bill sharing",
      "Owner dashboard, daily summary and 30-day reports",
      "Automatic backup across devices, with recovery tools",
    ],
  },
  standard: {
    code: "standard",
    name: "Legacy Standard",
    price: 399,
    annualPrice: 4788,
    maxStores: 1,
    maxDevices: 2,
    maxStaff: 0,
    headline: "Retained for existing subscribers; no longer sold.",
    features: [...starterFeatures, ...standardExtra],
    bullets: [
      "Everything in Starter",
      "2 devices that stay updated automatically",
      "30-day reports and customer payment history",
      "Stock tracking, low-stock alerts and daily sales summary",
      "PDF bill share, owner dashboard and PIN-protected delete",
      "Better backup",
    ],
    legacy: true,
  },
  growth: {
    code: "growth",
    name: "Growth",
    price: 599,
    annualPrice: 4999,
    maxStores: 1,
    maxDevices: 5,
    maxStaff: 5,
    headline: "Staff control, advanced pricing and deeper reports.",
    features: [...starterFeatures, ...standardExtra, ...growthExtra],
    bullets: [
      "Everything in Starter",
      "1 store, 5 devices, 2 billing counters and 5 staff",
      "Advanced udhar reports, profit/loss estimate",
      "Customer-specific prices and quantity discounts",
      "Payment mode reports, monthly reports, CSV import/export",
      "Advanced recycle bin, audit logs and priority support",
    ],
    highlight: true,
  },
  pro: {
    code: "pro",
    name: "Business",
    price: 999,
    annualPrice: 8999,
    maxStores: 10,
    maxDevices: 10,
    maxStaff: 20,
    headline: "Multi-counter and multi-store retail operations.",
    features: [...starterFeatures, ...standardExtra, ...growthExtra, ...proExtra],
    bullets: [
      "Everything in Growth",
      "10 stores, 10 devices, 5 counters and 20 staff",
      "Advanced inventory with batch/expiry support",
      "GST reports, Tally export and safely archived bills",
      "Automated WhatsApp reminders and owner mobile dashboard",
      "Yearly reports, staff performance and advanced analytics",
      "Premium support and integration-ready operations",
    ],
  },
};

const BUSINESS_TYPE_PRICES: Record<BusinessType, Record<Exclude<PlanCode, "standard">, [number, number]>> = {
  kirana:      { starter: [249, 2499], growth: [599, 4999], pro: [999, 8999] },
  stationery:  { starter: [249, 2499], growth: [599, 4999], pro: [999, 8999] },
  other:       { starter: [249, 2499], growth: [599, 4999], pro: [999, 8999] },
  clothing:    { starter: [349, 3499], growth: [699, 5999], pro: [1099, 9999] },
  footwear:    { starter: [349, 3499], growth: [699, 5999], pro: [1099, 9999] },
  cosmetics:   { starter: [349, 3499], growth: [699, 5999], pro: [1099, 9999] },
  auto_parts:  { starter: [399, 3999], growth: [799, 6999], pro: [1199, 10999] },
  electronics: { starter: [399, 3999], growth: [799, 6999], pro: [1199, 10999] },
  furniture:   { starter: [399, 3999], growth: [799, 6999], pro: [1199, 10999] },
  pharmacy:    { starter: [499, 4999], growth: [899, 7999], pro: [1299, 11999] },
  restaurant:  { starter: [599, 5999], growth: [999, 8999], pro: [1499, 13999] },
};

export const SHOP_TYPE_ENTITLEMENTS_V1: FeatureName = "shop_type_entitlements_v1";

interface BusinessTypePlanEntitlements {
  starter: FeatureName[];
  growth: FeatureName[];
  starterBullets: string[];
  growthBullets: string[];
}

const BUSINESS_TYPE_PLAN_ENTITLEMENTS: Record<BusinessType, BusinessTypePlanEntitlements> = {
  kirana: {
    starter: ["batch_expiry"],
    growth: ["advanced_inventory"],
    starterBullets: ["Loose-item and pack-size billing with udhar", "Batch, expiry, low-stock and daily closing"],
    growthBullets: ["Advanced inventory control with staff roles", "Customer pricing, quantity pricing and monthly profit reports"],
  },
  clothing: {
    starter: ["product_variants"],
    growth: ["clothing_rentals", "loyalty_program"],
    starterBullets: ["Size and colour variants for everyday sales", "Exchanges and regular stock control"],
    growthBullets: ["Rental bookings and loyalty", "Staff roles, advanced pricing and monthly reports"],
  },
  footwear: {
    starter: ["product_variants", "footwear_size_runs"],
    growth: ["loyalty_program"],
    starterBullets: ["UK, US and EU size runs with pair-level stock", "Size-aware selling and exchanges"],
    growthBullets: ["Loyalty, staff roles and advanced pricing", "Monthly profit and payment-mode reporting"],
  },
  auto_parts: {
    starter: ["vehicle_fitment"],
    growth: ["advanced_inventory"],
    starterBullets: ["Vehicle fitment and alternative-part lookup", "Part-number stock, purchases and quotations"],
    growthBullets: ["Advanced inventory and wholesale pricing", "Staff controls, audit logs and deeper reports"],
  },
  electronics: {
    starter: ["serial_imei_tracking"],
    growth: ["advanced_inventory"],
    starterBullets: ["IMEI and serial-number unit register", "Warranty-linked sales, returns and service history"],
    growthBullets: ["Repair and open-box operations with advanced inventory", "Staff controls, audit logs and profit reporting"],
  },
  pharmacy: {
    starter: ["batch_expiry", "prescription_tracking"],
    growth: ["advanced_inventory"],
    starterBullets: ["Prescription register for controlled dispensing", "Batch, expiry and medicine stock control"],
    growthBullets: ["Advanced inventory and staff roles", "Deeper purchase, payment and profit reporting"],
  },
  stationery: {
    starter: ["academic_book_lists"],
    growth: [],
    starterBullets: ["Academic book lists that open directly in billing", "ISBN-ready catalog and loose stationery sales"],
    growthBullets: ["Bulk and customer-specific pricing", "Staff roles, CSV workflows and monthly reports"],
  },
  furniture: {
    starter: ["product_variants", "furniture_order_book"],
    growth: ["advanced_inventory"],
    starterBullets: ["Quotation and custom-order book", "Advances, stock reservations and delivery tracking"],
    growthBullets: ["Advanced inventory and staff roles", "Customer pricing, audit logs and profit reporting"],
  },
  cosmetics: {
    starter: ["product_variants", "batch_expiry", "tester_stock"],
    growth: ["loyalty_program"],
    starterBullets: ["Shade variants with batch and expiry control", "Tester stock and its real product cost"],
    growthBullets: ["Loyalty and customer-specific pricing", "Staff controls, audit logs and monthly reports"],
  },
  restaurant: {
    starter: ["batch_expiry", "restaurant_tables", "restaurant_kot", "restaurant_menu"],
    growth: ["restaurant_recipe_inventory", "advanced_inventory"],
    starterBullets: ["Menu, tables, KOT and kitchen display", "Split billing plus batch/expiry for perishable stock"],
    growthBullets: ["Recipe-level ingredient and kitchen-stock control", "Staff roles, audit logs and advanced reports"],
  },
  other: {
    starter: [],
    growth: [],
    starterBullets: ["Billing, inventory, purchases and supplier records", "Customer credit, reports and automatic backup"],
    growthBullets: ["Staff roles and customer-specific pricing", "CSV workflows, audit logs and monthly reports"],
  },
};

function uniqueFeatures(...groups: FeatureName[][]): FeatureName[] {
  return [...new Set(groups.flat())];
}

function shopTypeFeatures(code: PlanCode, businessType: BusinessType): FeatureName[] {
  const base = PLAN_DEFINITIONS[code].features;
  if (code === "standard") return base;
  const profile = BUSINESS_TYPE_PLAN_ENTITLEMENTS[businessType] ?? BUSINESS_TYPE_PLAN_ENTITLEMENTS.other;
  const growth = code === "growth" || code === "pro" ? profile.growth : [];
  return uniqueFeatures(base, [SHOP_TYPE_ENTITLEMENTS_V1], profile.starter, growth);
}

function shopTypeBullets(code: PlanCode, businessType: BusinessType): string[] {
  const base = PLAN_DEFINITIONS[code].bullets;
  if (code === "standard") return base;
  const profile = BUSINESS_TYPE_PLAN_ENTITLEMENTS[businessType] ?? BUSINESS_TYPE_PLAN_ENTITLEMENTS.other;
  if (code === "starter") return [base[0], ...profile.starterBullets, ...base.slice(1)];
  if (code === "growth") return [base[0], ...profile.growthBullets, ...base.slice(1)];
  return [base[0], `All ${businessType.replaceAll("_", " ")} Starter and Growth workflows`, ...base.slice(1)];
}

export function getPlanForBusinessType(code: PlanCode, businessType: BusinessType): PlanDefinition {
  const base = PLAN_DEFINITIONS[code];
  if (code === "standard") return base;
  const [price, annualPrice] = BUSINESS_TYPE_PRICES[businessType]?.[code] ?? BUSINESS_TYPE_PRICES.other[code];
  return {
    ...base,
    price,
    annualPrice,
    features: shopTypeFeatures(code, businessType),
    bullets: shopTypeBullets(code, businessType),
  };
}

/**
 * Existing subscriptions predate shop-type plan gates, so every vertical page
 * they could already open remains available. Generic plan features still come
 * from their original plan; only the newly introduced vertical gates are
 * grandfathered here.
 */
export function getPlanForEntitlementSnapshot(
  code: PlanCode,
  businessType: BusinessType,
  entitledFeatures: readonly string[] | null,
): PlanDefinition {
  if (entitledFeatures?.includes(SHOP_TYPE_ENTITLEMENTS_V1)) return getPlanForBusinessType(code, businessType);
  const base = PLAN_DEFINITIONS[code];
  const vertical = BUSINESS_TYPE_PLAN_ENTITLEMENTS[businessType] ?? BUSINESS_TYPE_PLAN_ENTITLEMENTS.other;
  const grandfatheredVerticalFeatures = [...vertical.starter, ...vertical.growth].filter((feature) =>
    feature !== "batch_expiry" && feature !== "advanced_inventory" && feature !== "loyalty_program",
  );
  return { ...base, features: uniqueFeatures(base.features, grandfatheredVerticalFeatures) };
}

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
  automatic_two_way_sync: "Keeps every device updated",
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
  dynamic_customer_pricing: "Different prices for customers",
  quantity_based_pricing: "Quantity discounts",
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
  loyalty_program: "Loyalty points and rewards ledger",
  advanced_inventory: "Advanced inventory",
  batch_expiry: "Batch/expiry support",
  gst_reports: "GST reports",
  tally_export: "Tally export",
  whatsapp_reminders: "Automated WhatsApp reminders",
  single_bill_whatsapp: "Send individual bills on WhatsApp",
  owner_mobile_dashboard: "Owner mobile dashboard",
  cloud_bill_archive: "Bills safely backed up",
  yearly_reports: "Yearly reports",
  staff_performance_report: "Staff performance report",
  advanced_analytics: "Advanced analytics",
  api_webhook_later: "Business integrations",
  channel_settlement: "Channel order and payout reconciliation",
  premium_support: "Premium support",
  hindi_voice_billing: "Hindi/Hinglish voice billing",
  smart_daily_closing: "Smart daily closing",
  customer_trust_score: "Customer trust score",
  smart_price_memory: "Smart price memory",
  no_barcode_fast_billing: "No-barcode fast billing",
  offline_confidence_meter: "Offline confidence meter",
  recovery_mode: "Restore and recover data",
  shop_type_entitlements_v1: "Shop-type plan access",
  product_variants: "Size, colour and product variants",
  clothing_rentals: "Clothing rental bookings",
  footwear_size_runs: "Footwear size-run stock",
  vehicle_fitment: "Vehicle fitment and alternative parts",
  serial_imei_tracking: "Serial number and IMEI tracking",
  prescription_tracking: "Prescription register",
  academic_book_lists: "Academic book lists",
  furniture_order_book: "Furniture quotations and order book",
  tester_stock: "Tester stock control",
  restaurant_tables: "Restaurant table management",
  restaurant_kot: "Kitchen order tickets and display",
  restaurant_menu: "Restaurant menu management",
  restaurant_recipe_inventory: "Recipe and ingredient inventory",
};

export function getPlan(code: string | null | undefined): PlanDefinition {
  const normalized = String(code ?? "starter").toLowerCase();
  if (normalized === "299" || normalized === "349") return PLAN_DEFINITIONS.starter;
  if (normalized === "399") return PLAN_DEFINITIONS.standard;
  if (normalized === "499" || normalized === "599") return PLAN_DEFINITIONS.growth;
  if (normalized === "699" || normalized === "999" || normalized === "business") return PLAN_DEFINITIONS.pro;
  return PLAN_DEFINITIONS[(PLAN_ORDER as readonly string[]).includes(normalized) ? normalized as PlanCode : "starter"];
}

export function getRequiredPlanForFeature(featureName: FeatureName, businessType: BusinessType = "other"): PlanDefinition {
  return getPlanForBusinessType(
    (["starter", "growth", "pro"] as const).find((code) => getPlanForBusinessType(code, businessType).features.includes(featureName)) ?? "pro",
    businessType,
  );
}

export function isKnownFeatureName(value: string): value is FeatureName {
  return Object.hasOwn(FEATURE_LABELS, value);
}

export function planRank(code: string | null | undefined): number {
  const normalized = getPlan(code).code;
  return PLAN_ORDER.indexOf(normalized);
}
