// ─────────────────────────────────────────────────────────────────────────────
// Smart Adaptive Pricing Engine — the canonical deterministic pipeline.
//
// evaluatePricing() is a PURE function: same (context, rules, settings) → same
// result, forever, for a given calculationVersion. No network, DB, React, or
// Date.now() (the caller passes billDate). This is the single price authority
// the spec demands — offline billing and (once mirrored) the backend both call
// exactly this. It intentionally reuses roundMoney (the one money rounder in the
// app) rather than introducing a second money mechanism.
// ─────────────────────────────────────────────────────────────────────────────

import { roundMoney } from "@/lib/money";
import {
  PRICING_CALCULATION_VERSION,
  PricingRuleType,
  RULE_TYPE_PRIORITY,
  type PricingContext,
  type PricingResult,
  type PricingRule,
  type PricingRuleTrace,
  type PricingSettings,
} from "./types";

const EPSILON = 0.005; // half a paisa — money is compared at paise granularity

function effectivePriority(rule: PricingRule): number {
  return rule.priority ?? RULE_TYPE_PRIORITY[rule.ruleType] ?? 100;
}

/** How specific a rule is — used only to break priority ties deterministically. */
function specificity(rule: PricingRule): number {
  let score = 0;
  if (rule.locationId) score += 16;
  if (rule.customerId) score += 8;
  if (rule.customerGroup) score += 4;
  if (rule.sellingUnitId) score += 3;
  if (rule.unitCode) score += 2;
  if (rule.minQuantity != null || rule.maxQuantity != null) score += 1;
  return score;
}

function withinDate(rule: PricingRule, billDate: string): boolean {
  const t = new Date(billDate).getTime();
  if (!Number.isFinite(t)) return true;
  if (rule.validFrom && new Date(rule.validFrom).getTime() > t) return false;
  if (rule.validUntil && new Date(rule.validUntil).getTime() < t) return false;
  return true;
}

/** Resolve a rule's unit price for the given context. Returns null if it can't price. */
function resolveRulePrice(rule: PricingRule, ctx: PricingContext): number | null {
  if (rule.fixedUnitPrice != null && rule.fixedUnitPrice > 0) return roundMoney(rule.fixedUnitPrice);
  const base = ctx.defaultPrice;
  const cost = ctx.productCost ?? 0;
  const v = rule.adjustmentValue ?? 0;
  switch (rule.adjustmentType) {
    case "FIXED_PRICE": return roundMoney(v);
    case "FIXED_DISCOUNT": return roundMoney(base - v);
    case "PERCENTAGE_DISCOUNT": return roundMoney(base * (1 - v / 100));
    case "MARKUP_ON_COST": return roundMoney(cost * (1 + v / 100));
    case "MARGIN_ON_COST": return v >= 100 ? null : roundMoney(cost / (1 - v / 100));
    default: return null;
  }
}

/** Returns [matched, reason] for the trace. */
function matchRule(rule: PricingRule, ctx: PricingContext): [boolean, string] {
  if (rule.locationId && rule.locationId !== ctx.locationId) return [false, "Different store location"];
  if (rule.productId && rule.productId !== ctx.productId) return [false, "Different product"];
  if (rule.sellingUnitId && rule.sellingUnitId !== ctx.sellingUnitId) return [false, "Different selling unit or pack size"];
  if (rule.unitCode && rule.unitCode !== ctx.unitCode) return [false, `Applies to unit ${rule.unitCode}`];
  if (rule.customerId && rule.customerId !== ctx.customerId) return [false, "Different customer"];
  if (rule.customerGroup && rule.customerGroup !== ctx.customerGroup) return [false, `Applies to ${rule.customerGroup} group`];
  if (rule.paymentMethod && rule.paymentMethod !== ctx.paymentMethod) return [false, `Applies to ${rule.paymentMethod} payments`];
  if (rule.minQuantity != null && ctx.quantity < rule.minQuantity - EPSILON) return [false, `Minimum quantity is ${rule.minQuantity}`];
  if (rule.maxQuantity != null && ctx.quantity > rule.maxQuantity + EPSILON) return [false, `Maximum quantity is ${rule.maxQuantity}`];
  if (!withinDate(rule, ctx.billDate)) return [false, "Rule not valid on this date"];
  if (resolveRulePrice(rule, ctx) == null) return [false, "Rule could not resolve a price"];
  return [true, "Matched"];
}

function defaultExplanation(rule: PricingRule, ctx: PricingContext): string {
  if (rule.label) return rule.label;
  switch (rule.ruleType) {
    case PricingRuleType.CUSTOMER_FIXED_PRICE: return "Customer price applied";
    case PricingRuleType.CUSTOMER_QUANTITY_PRICE: return `Customer bulk price for ${ctx.quantity}+ ${ctx.unitLabel ?? ctx.unitCode}`;
    case PricingRuleType.CUSTOMER_GROUP_PRICE: return `${ctx.customerGroup ?? "Group"} customer price applied`;
    case PricingRuleType.CUSTOMER_GROUP_QUANTITY_PRICE: return `${ctx.customerGroup ?? "Group"} bulk price applied`;
    case PricingRuleType.PRODUCT_QUANTITY_PRICE: return `Quantity price applied: ${rule.minQuantity ?? ""}+ ${ctx.unitLabel ?? ctx.unitCode}`;
    case PricingRuleType.SELLING_UNIT_PRICE: return `Price for ${ctx.unitLabel ?? ctx.unitCode}`;
    case PricingRuleType.PROMOTIONAL_PRICE: return rule.label ?? "Promotional price applied";
    case PricingRuleType.PAYMENT_METHOD_PRICE: return `${ctx.paymentMethod ?? "Payment"} price applied`;
    case PricingRuleType.LEARNED_RECOMMENDATION: return "Suggested from past accepted sales";
    default: return "Default product price applied";
  }
}

/**
 * The canonical deterministic pricing evaluation. Rules are pre-fetched (the
 * caller decides where from — product fields today, a PricingRule table later).
 */
export function evaluatePricing(
  ctx: PricingContext,
  rules: PricingRule[],
  settings?: PricingSettings,
): PricingResult {
  const originalUnitPrice = roundMoney(ctx.defaultPrice);
  const configuredMinimumPrice = roundMoney(ctx.minimumSellingPrice ?? 0);
  const maximumAllowedPrice = ctx.maximumRetailPrice && ctx.maximumRetailPrice > 0 ? roundMoney(ctx.maximumRetailPrice) : null;

  const considered: PricingRuleTrace[] = [];
  const matched: Array<{ rule: PricingRule; price: number }> = [];

  for (const rule of rules) {
    const [ok, reason] = matchRule(rule, ctx);
    considered.push({ ruleId: rule.id, ruleType: rule.ruleType, matched: ok, reason });
    if (ok) matched.push({ rule, price: resolveRulePrice(rule, ctx)! });
  }

  // Priority resolution: strongest priority (lowest number) wins; tie → most
  // specific; still tied → best (lowest) price for the customer; still tied → id.
  matched.sort((a, b) => {
    const pa = effectivePriority(a.rule), pb = effectivePriority(b.rule);
    if (pa !== pb) return pa - pb;
    const sa = specificity(a.rule), sb = specificity(b.rule);
    if (sa !== sb) return sb - sa;
    if (Math.abs(a.price - b.price) > EPSILON) return a.price - b.price;
    return a.rule.id.localeCompare(b.rule.id);
  });

  const winner = matched[0];
  const rawPrice = winner ? winner.price : originalUnitPrice;
  const marginPercent = winner?.rule.minimumMarginPercent ?? ctx.minimumMarginPercent;
  const marginFloor = ctx.productCost && marginPercent != null && marginPercent > 0 && marginPercent < 100
    ? roundMoney(ctx.productCost / (1 - marginPercent / 100))
    : 0;
  const minimumAllowedPrice = roundMoney(Math.max(configuredMinimumPrice, marginFloor));

  // Enforce boundaries. Below-minimum is floored to the minimum and flagged for
  // approval (never silently sold under margin); above-MRP is capped.
  let finalPrice = rawPrice;
  let belowMinimum = false;
  let aboveMaximum = false;
  if (minimumAllowedPrice > 0 && finalPrice < minimumAllowedPrice - EPSILON) {
    belowMinimum = true;
    finalPrice = minimumAllowedPrice;
  }
  if (maximumAllowedPrice != null && finalPrice > maximumAllowedPrice + EPSILON) {
    aboveMaximum = true;
    finalPrice = maximumAllowedPrice;
  }
  finalPrice = roundMoney(finalPrice);

  const appliedRuleType = winner ? winner.rule.ruleType : PricingRuleType.DEFAULT_PRICE;
  const appliedRuleId = winner ? winner.rule.id : null;
  const confidence = winner ? winner.rule.confidence ?? 1 : 1;

  const requireApprovalBelowMargin = settings?.requireApprovalBelowMinMargin ?? true;
  const requiresApproval =
    (belowMinimum && requireApprovalBelowMargin) ||
    Boolean(winner?.rule.requiresOwnerApproval);

  const explanation = belowMinimum
    ? `Price is below the minimum of ₹${minimumAllowedPrice}. Owner approval required.`
    : winner
      ? defaultExplanation(winner.rule, ctx)
      : "Default product price applied";

  const alternativePrices = Array.from(
    new Set(matched.map((m) => m.price).filter((p) => Math.abs(p - finalPrice) > EPSILON)),
  ).slice(0, 3);

  return {
    recommendedUnitPrice: finalPrice,
    originalUnitPrice,
    minimumAllowedPrice,
    maximumAllowedPrice,
    appliedRuleId,
    appliedRuleType,
    explanation,
    confidence,
    requiresApproval,
    alternativePrices,
    calculationVersion: PRICING_CALCULATION_VERSION,
    trace: {
      consideredRules: considered,
      selectedRuleId: appliedRuleId,
      finalPrice,
      belowMinimum,
      aboveMaximum,
    },
  };
}
