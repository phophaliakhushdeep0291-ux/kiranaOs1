// ─────────────────────────────────────────────────────────────────────────────
// Smart Adaptive Pricing Engine — canonical types.
//
// Adapted to Artha's ACTUAL model (not the generic spec):
//   • Money is rupees rounded to paise via @/lib/money.roundMoney (the repo has NO
//     Prisma Decimal — it uses Float columns + integer-paise reconciliation).
//   • Products use a single base-unit model (displayUnit/baseUnit/rateUnit +
//     defaultPricePerRateUnit / minPricePerRateUnit / costPerRateUnit + mrp),
//     NOT a per-selling-unit table. `unitCode` here is the rateUnit string.
//   • "Customer group" does not exist yet as a table — `customerGroup` is the
//     Customer.type string ("regular" | "udhar" | future owner groups).
//
// This module is PURE (only imports roundMoney, itself pure) so the same
// deterministic result can be produced offline and — once mirrored — on the
// backend. It never calls the network, DB, or React.
// ─────────────────────────────────────────────────────────────────────────────

export const PRICING_CALCULATION_VERSION = "pricing-v1";

/** Precedence — LOWER number wins (Priority 1 is strongest), matching the spec. */
export enum PricingRuleType {
  CUSTOMER_FIXED_PRICE = "CUSTOMER_FIXED_PRICE",
  CUSTOMER_QUANTITY_PRICE = "CUSTOMER_QUANTITY_PRICE",
  CUSTOMER_GROUP_PRICE = "CUSTOMER_GROUP_PRICE",
  CUSTOMER_GROUP_QUANTITY_PRICE = "CUSTOMER_GROUP_QUANTITY_PRICE",
  PRODUCT_QUANTITY_PRICE = "PRODUCT_QUANTITY_PRICE",
  SELLING_UNIT_PRICE = "SELLING_UNIT_PRICE",
  PROMOTIONAL_PRICE = "PROMOTIONAL_PRICE",
  PAYMENT_METHOD_PRICE = "PAYMENT_METHOD_PRICE",
  LEARNED_RECOMMENDATION = "LEARNED_RECOMMENDATION",
  DEFAULT_PRICE = "DEFAULT_PRICE",
}

/**
 * Canonical precedence map — the single source of truth for rule ordering
 * (LOWER wins). Note the intentional "+quantity beats its base within the same
 * scope" ordering: a customer+quantity rule only MATCHES inside its band, and
 * when it does it is the more specific price, so it must beat the customer's
 * flat fixed price (spec: "...unless a more specific customer quantity rule
 * exists"). Same for group+quantity vs group. Customer scope always beats group
 * scope; group beats general.
 */
export const RULE_TYPE_PRIORITY: Record<PricingRuleType, number> = {
  [PricingRuleType.CUSTOMER_QUANTITY_PRICE]: 1,
  [PricingRuleType.CUSTOMER_FIXED_PRICE]: 2,
  [PricingRuleType.CUSTOMER_GROUP_QUANTITY_PRICE]: 3,
  [PricingRuleType.CUSTOMER_GROUP_PRICE]: 4,
  [PricingRuleType.PRODUCT_QUANTITY_PRICE]: 5,
  [PricingRuleType.SELLING_UNIT_PRICE]: 6,
  [PricingRuleType.PROMOTIONAL_PRICE]: 7,
  [PricingRuleType.LEARNED_RECOMMENDATION]: 8,
  [PricingRuleType.PAYMENT_METHOD_PRICE]: 9,
  [PricingRuleType.DEFAULT_PRICE]: 100,
};

export type PriceAdjustmentType =
  | "FIXED_PRICE"
  | "FIXED_DISCOUNT"
  | "PERCENTAGE_DISCOUNT"
  | "MARKUP_ON_COST"
  | "MARGIN_ON_COST";

export type PromotionCombinePolicy =
  | "CANNOT_COMBINE"
  | "CAN_COMBINE"
  | "BEST_PRICE_WINS"
  | "CUSTOMER_CONTRACT_WINS"
  | "PROMOTION_WINS";

/**
 * A normalized, in-memory pricing rule. Rules may originate from the existing
 * product fields (retail/wholesale/quantity thresholds), from a future
 * PricingRule table, or from a learned recommendation — the engine treats them
 * uniformly. All money is rupees-per-rateUnit.
 */
export interface PricingRule {
  id: string;
  ruleType: PricingRuleType;
  /** Explicit override for precedence; defaults to RULE_TYPE_PRIORITY[ruleType]. */
  priority?: number;

  // Match predicates — undefined means "matches anything".
  productId?: string;
  locationId?: string;
  sellingUnitId?: string;
  unitCode?: string;
  customerId?: string;
  customerGroup?: string;
  paymentMethod?: string;
  minQuantity?: number;
  maxQuantity?: number;
  validFrom?: string | null;
  validUntil?: string | null;

  // Price resolution — either a fixed unit price OR an adjustment.
  fixedUnitPrice?: number;
  adjustmentType?: PriceAdjustmentType;
  adjustmentValue?: number;

  // Safeguards carried by the rule itself.
  minimumMarginPercent?: number;

  // Promotion behaviour (only meaningful for PROMOTIONAL_PRICE rules).
  combinePolicy?: PromotionCombinePolicy;

  /** Human phrase used to build the explanation, e.g. "Wholesale price". */
  label?: string;
  /** 0..1 — deterministic rules are 1; learned rules carry their score. */
  confidence?: number;
  requiresOwnerApproval?: boolean;
}

export type PricingSource = "BILLING" | "ESTIMATE" | "ORDER" | "OFFLINE_BILLING" | "BILL_EDIT" | "RETURN";

export interface PricingContext {
  shopId: string;
  locationId?: string;
  productId: string;
  /** Durable product selling-unit identity (packet 500 g, packet 1 kg, box, etc.). */
  sellingUnitId?: string;
  unitCode: string;
  unitLabel?: string;

  customerId?: string;
  customerGroup?: string;

  quantity: number;
  billDate: string; // ISO
  paymentMethod?: string;

  /** Per-rateUnit money from the product master. */
  productCost?: number;
  defaultPrice: number;
  minimumSellingPrice?: number;
  maximumRetailPrice?: number; // mrp; 0/undefined = no cap
  minimumMarginPercent?: number;

  staffUserId?: string;
  deviceId?: string;
  source: PricingSource;
}

export interface PricingRuleTrace {
  ruleId: string;
  ruleType: PricingRuleType;
  matched: boolean;
  reason: string;
}

export interface PricingResult {
  recommendedUnitPrice: number;
  originalUnitPrice: number;
  minimumAllowedPrice: number;
  maximumAllowedPrice: number | null;
  appliedRuleId: string | null;
  appliedRuleType: PricingRuleType;
  explanation: string;
  confidence: number;
  requiresApproval: boolean;
  /** Distinct candidate prices (other matched rules), for "alternative price" chips. */
  alternativePrices: number[];
  calculationVersion: string;
  /** Debug/support only — never shown to customers. */
  trace: {
    consideredRules: PricingRuleTrace[];
    selectedRuleId: string | null;
    finalPrice: number;
    belowMinimum: boolean;
    aboveMaximum: boolean;
  };
}

export interface PricingSettings {
  smartPricingEnabled: boolean;
  recommendationOnly: boolean;
  autoFillThreshold: number; // 0..1
  autoApplyThreshold: number | null; // null = never auto-apply
  minObservations: number;
  requireApprovalBelowMinMargin: boolean;
  allowStaffOverride: boolean;
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  smartPricingEnabled: true,
  recommendationOnly: true,
  autoFillThreshold: 0.8,
  autoApplyThreshold: null,
  minObservations: 5,
  requireApprovalBelowMinMargin: true,
  allowStaffOverride: true,
};
