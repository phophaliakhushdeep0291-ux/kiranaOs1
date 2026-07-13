// ─────────────────────────────────────────────────────────────────────────────
// Backend port of the canonical deterministic pricing engine.
//
// This is a FAITHFUL mirror of frontend/src/features/pricing/engine/engine.ts.
// The repo has no monorepo/workspace, so the pure module can't be literally
// shared between the Vite frontend (.ts) and the Node backend (.js). Parity is
// guaranteed instead by a shared JSON fixture set that BOTH sides run through
// evaluatePricing and assert identical output (tests/pricing-engine-parity).
// If you change one engine, change the other and re-run the parity fixtures.
// roundMoney matches frontend/src/lib/money.ts exactly (paise, EPSILON, -0→0).
// ─────────────────────────────────────────────────────────────────────────────

export const PRICING_CALCULATION_VERSION = "pricing-v1";
const EPSILON = 0.005;

export const RULE_TYPE_PRIORITY = {
  CUSTOMER_QUANTITY_PRICE: 1,
  CUSTOMER_FIXED_PRICE: 2,
  CUSTOMER_GROUP_QUANTITY_PRICE: 3,
  CUSTOMER_GROUP_PRICE: 4,
  PRODUCT_QUANTITY_PRICE: 5,
  SELLING_UNIT_PRICE: 6,
  PROMOTIONAL_PRICE: 7,
  LEARNED_RECOMMENDATION: 8,
  PAYMENT_METHOD_PRICE: 9,
  DEFAULT_PRICE: 100,
};

export function roundMoney(value) {
  const n = Number(value) || 0;
  return Math.round((n + Number.EPSILON) * 100) / 100 || 0;
}

function effectivePriority(rule) {
  return rule.priority ?? RULE_TYPE_PRIORITY[rule.ruleType] ?? 100;
}

function specificity(rule) {
  let s = 0;
  if (rule.locationId) s += 16;
  if (rule.customerId) s += 8;
  if (rule.customerGroup) s += 4;
  if (rule.sellingUnitId) s += 3;
  if (rule.unitCode) s += 2;
  if (rule.minQuantity != null || rule.maxQuantity != null) s += 1;
  return s;
}

function withinDate(rule, billDate) {
  const t = new Date(billDate).getTime();
  if (!Number.isFinite(t)) return true;
  if (rule.validFrom && new Date(rule.validFrom).getTime() > t) return false;
  if (rule.validUntil && new Date(rule.validUntil).getTime() < t) return false;
  return true;
}

function resolveRulePrice(rule, ctx) {
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

function matchRule(rule, ctx) {
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

function defaultExplanation(rule, ctx) {
  if (rule.label) return rule.label;
  switch (rule.ruleType) {
    case "CUSTOMER_FIXED_PRICE": return "Customer price applied";
    case "CUSTOMER_QUANTITY_PRICE": return `Customer bulk price for ${ctx.quantity}+ ${ctx.unitLabel ?? ctx.unitCode}`;
    case "CUSTOMER_GROUP_PRICE": return `${ctx.customerGroup ?? "Group"} customer price applied`;
    case "CUSTOMER_GROUP_QUANTITY_PRICE": return `${ctx.customerGroup ?? "Group"} bulk price applied`;
    case "PRODUCT_QUANTITY_PRICE": return `Quantity price applied: ${rule.minQuantity ?? ""}+ ${ctx.unitLabel ?? ctx.unitCode}`;
    case "SELLING_UNIT_PRICE": return `Price for ${ctx.unitLabel ?? ctx.unitCode}`;
    case "PROMOTIONAL_PRICE": return rule.label ?? "Promotional price applied";
    case "PAYMENT_METHOD_PRICE": return `${ctx.paymentMethod ?? "Payment"} price applied`;
    case "LEARNED_RECOMMENDATION": return "Suggested from past accepted sales";
    default: return "Default product price applied";
  }
}

export function evaluatePricing(ctx, rules, settings) {
  const originalUnitPrice = roundMoney(ctx.defaultPrice);
  const configuredMinimumPrice = roundMoney(ctx.minimumSellingPrice ?? 0);
  const maximumAllowedPrice = ctx.maximumRetailPrice && ctx.maximumRetailPrice > 0 ? roundMoney(ctx.maximumRetailPrice) : null;

  const considered = [];
  const matched = [];
  for (const rule of rules ?? []) {
    const [ok, reason] = matchRule(rule, ctx);
    considered.push({ ruleId: rule.id, ruleType: rule.ruleType, matched: ok, reason });
    if (ok) matched.push({ rule, price: resolveRulePrice(rule, ctx) });
  }

  matched.sort((a, b) => {
    const pa = effectivePriority(a.rule), pb = effectivePriority(b.rule);
    if (pa !== pb) return pa - pb;
    const sa = specificity(a.rule), sb = specificity(b.rule);
    if (sa !== sb) return sb - sa;
    if (Math.abs(a.price - b.price) > EPSILON) return a.price - b.price;
    return a.rule.id.localeCompare(b.rule.id);
  });

  const winner = matched[0];
  const marginPercent = winner?.rule.minimumMarginPercent ?? ctx.minimumMarginPercent;
  const marginFloor = ctx.productCost && marginPercent != null && marginPercent > 0 && marginPercent < 100
    ? roundMoney(ctx.productCost / (1 - marginPercent / 100))
    : 0;
  const minimumAllowedPrice = roundMoney(Math.max(configuredMinimumPrice, marginFloor));
  let finalPrice = winner ? winner.price : originalUnitPrice;
  let belowMinimum = false;
  let aboveMaximum = false;
  if (minimumAllowedPrice > 0 && finalPrice < minimumAllowedPrice - EPSILON) { belowMinimum = true; finalPrice = minimumAllowedPrice; }
  if (maximumAllowedPrice != null && finalPrice > maximumAllowedPrice + EPSILON) { aboveMaximum = true; finalPrice = maximumAllowedPrice; }
  finalPrice = roundMoney(finalPrice);

  const appliedRuleType = winner ? winner.rule.ruleType : "DEFAULT_PRICE";
  const appliedRuleId = winner ? winner.rule.id : null;
  const confidence = winner ? winner.rule.confidence ?? 1 : 1;
  const requireApprovalBelowMargin = settings?.requireApprovalBelowMinMargin ?? true;
  const requiresApproval = (belowMinimum && requireApprovalBelowMargin) || Boolean(winner?.rule.requiresOwnerApproval);

  const explanation = belowMinimum
    ? `Price is below the minimum of ₹${minimumAllowedPrice}. Owner approval required.`
    : winner ? defaultExplanation(winner.rule, ctx) : "Default product price applied";

  const alternativePrices = [...new Set(matched.map((m) => m.price).filter((p) => Math.abs(p - finalPrice) > EPSILON))].slice(0, 3);

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
    trace: { consideredRules: considered, selectedRuleId: appliedRuleId, finalPrice, belowMinimum, aboveMaximum },
  };
}
