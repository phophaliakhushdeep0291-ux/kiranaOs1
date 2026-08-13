import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

const MONEY_EPSILON = 0.005;
export const LARGE_DISCOUNT_MIN_AMOUNT = 100;
export const LARGE_DISCOUNT_MIN_PERCENT = 10;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100 || 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function ruleApplies(rule, item, body, customerGroup, billDate) {
  const quantity = number(item.quantity);
  const unitCode = item.sellingUnitCode ?? item.selling_unit_code ?? item.enteredUnit;
  const sellingUnitId = item.sellingUnitId ?? item.selling_unit_id;
  if (!rule || rule.status !== "ACTIVE") return false;
  if (rule.productId && rule.productId !== item.productId) return false;
  if (rule.locationId && rule.locationId !== (body.locationId ?? body.location_id ?? null)) return false;
  if (rule.sellingUnitId && rule.sellingUnitId !== sellingUnitId) return false;
  if (rule.unitCode && rule.unitCode !== unitCode) return false;
  if (rule.customerId && rule.customerId !== body.customerId) return false;
  if (rule.customerGroup && rule.customerGroup !== customerGroup) return false;
  if (rule.paymentMethod && rule.paymentMethod !== body.paymentMethod) return false;
  if (rule.minQuantity != null && quantity < number(rule.minQuantity) - MONEY_EPSILON) return false;
  if (rule.maxQuantity != null && quantity > number(rule.maxQuantity) + MONEY_EPSILON) return false;
  const at = billDate.getTime();
  if (rule.validFrom && rule.validFrom.getTime() > at) return false;
  if (rule.validUntil && rule.validUntil.getTime() < at) return false;
  return true;
}

function resolveRulePrice(rule, defaultRate, productCost, minimumRate) {
  if (!rule) return null;
  let price = null;
  if (rule.fixedUnitPrice != null && number(rule.fixedUnitPrice) > 0) {
    price = roundMoney(rule.fixedUnitPrice);
  } else {
    const adjustmentValue = number(rule.adjustmentValue);
    switch (rule.adjustmentType) {
      case "FIXED_PRICE":
        price = roundMoney(adjustmentValue);
        break;
      case "FIXED_DISCOUNT":
        price = roundMoney(defaultRate - adjustmentValue);
        break;
      case "PERCENTAGE_DISCOUNT":
        price = roundMoney(defaultRate * (1 - adjustmentValue / 100));
        break;
      case "MARKUP_ON_COST":
        price = roundMoney(productCost * (1 + adjustmentValue / 100));
        break;
      case "MARGIN_ON_COST":
        price = adjustmentValue >= 100 ? null : roundMoney(productCost / (1 - adjustmentValue / 100));
        break;
      default:
        price = null;
    }
  }
  if (price == null || !Number.isFinite(price)) return null;
  return roundMoney(Math.max(minimumRate, price));
}

/**
 * Derive the approval decision from server-owned catalogue/rule records. The
 * client may describe the UI state, but it never gets to decide whether a PIN
 * is required.
 */
export async function deriveSensitiveBillActions(shopId, body, client = db) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const productIds = unique(items.map((item) => item.productId));
  const sellingUnitIds = unique(items.map((item) => item.sellingUnitId ?? item.selling_unit_id));
  const claimedRuleIds = unique(items.map((item) => item.appliedPricingRuleId ?? item.applied_pricing_rule_id));

  const [products, sellingUnits, pricingRules, customer] = await Promise.all([
    productIds.length
      ? client.product.findMany({
          where: { shopId, id: { in: productIds }, deletedAt: null },
          select: { id: true, defaultPricePerRateUnit: true, minPricePerRateUnit: true, costPerRateUnit: true },
        })
      : [],
    sellingUnitIds.length
      ? client.productSellingUnit.findMany({
          where: { shopId, id: { in: sellingUnitIds }, isActive: true },
          select: { id: true, productId: true, unitCode: true, defaultPrice: true, minimumPrice: true, costPrice: true },
        })
      : [],
    claimedRuleIds.length
      ? client.pricingRule.findMany({ where: { shopId, id: { in: claimedRuleIds }, status: "ACTIVE" } })
      : [],
    body?.customerId
      ? client.customer.findFirst({ where: { shopId, id: body.customerId, deletedAt: null }, select: { customerGroup: true } })
      : null,
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const unitById = new Map(sellingUnits.map((unit) => [unit.id, unit]));
  const ruleById = new Map(pricingRules.map((rule) => [rule.id, rule]));
  const billDate = body?.businessDate ? new Date(body.businessDate) : new Date();
  const effectiveBillDate = Number.isFinite(billDate.getTime()) ? billDate : new Date();

  let referenceSubtotal = 0;
  let approvalDiscount = Math.max(0, number(body?.discount));
  let sellsBelowMinimum = false;
  let approvalRuleApplied = false;

  for (const item of items) {
    const quantity = Math.max(0, number(item.quantity));
    const enteredRate = Math.max(0, number(item.baseRatePerRateUnit ?? item.ratePerRateUnit));
    const lineDiscount = Math.max(0, number(item.lineDiscount));
    const product = productById.get(item.productId);
    const unit = unitById.get(item.sellingUnitId ?? item.selling_unit_id);
    const minimumRate = Math.max(0, number(unit?.minimumPrice ?? product?.minPricePerRateUnit));
    const defaultRate = Math.max(0, number(unit?.defaultPrice ?? product?.defaultPricePerRateUnit ?? enteredRate));
    const ruleId = item.appliedPricingRuleId ?? item.applied_pricing_rule_id;
    const claimedRule = ruleById.get(ruleId);
    const applicableRule = ruleApplies(claimedRule, item, body, customer?.customerGroup, effectiveBillDate)
      ? claimedRule
      : null;
    const recognisedRulePrice = resolveRulePrice(
      applicableRule,
      defaultRate,
      Math.max(0, number(unit?.costPrice ?? product?.costPerRateUnit)),
      minimumRate,
    );
    const isRecognisedRuleRate = recognisedRulePrice != null
      && Math.abs(recognisedRulePrice - enteredRate) < MONEY_EPSILON;

    referenceSubtotal += roundMoney(defaultRate * quantity);
    approvalDiscount += lineDiscount;
    // A server-recognised pricing rule is an owner-configured price. A bare
    // manual markdown is a discount and counts toward the approval threshold.
    if ((!applicableRule || !isRecognisedRuleRate) && defaultRate > enteredRate) {
      approvalDiscount += roundMoney((defaultRate - enteredRate) * quantity);
    }
    if (applicableRule?.requiresOwnerApproval) approvalRuleApplied = true;

    // Line discount can make an apparently safe unit rate cross the floor.
    const effectiveRate = quantity > 0 ? roundMoney(enteredRate - lineDiscount / quantity) : enteredRate;
    if (minimumRate > 0 && effectiveRate < minimumRate - MONEY_EPSILON) sellsBelowMinimum = true;
  }

  const actions = [];
  const largeDiscountThreshold = Math.max(
    LARGE_DISCOUNT_MIN_AMOUNT,
    roundMoney(referenceSubtotal * LARGE_DISCOUNT_MIN_PERCENT / 100),
  );
  if (referenceSubtotal > 0 && approvalDiscount >= largeDiscountThreshold - MONEY_EPSILON) {
    actions.push("large_discount");
  }
  if (sellsBelowMinimum || approvalRuleApplied) actions.push("selling_below_minimum_price");
  if (number(body?.loyaltyPointsToRedeem) > 0) actions.push("loyalty_redemption");
  return unique(actions);
}

export function assertSensitiveBillReason(actions, reason) {
  if (!Array.isArray(actions) || actions.length === 0) return;
  if (typeof reason !== "string" || reason.trim().length < 3) {
    throw new AppError("Approval reason is required for a sensitive bill action", 400, "BILL_APPROVAL_REASON_REQUIRED");
  }
}

