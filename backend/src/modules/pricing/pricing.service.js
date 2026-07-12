import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { evaluatePricing, RULE_TYPE_PRIORITY } from "./pricing-engine.js";

const RULE_TYPES = [
  "CUSTOMER_FIXED_PRICE", "CUSTOMER_QUANTITY_PRICE", "CUSTOMER_GROUP_PRICE",
  "CUSTOMER_GROUP_QUANTITY_PRICE", "PRODUCT_QUANTITY_PRICE", "SELLING_UNIT_PRICE",
  "PROMOTIONAL_PRICE", "PAYMENT_METHOD_PRICE",
];
const RULE_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "EXPIRED", "ARCHIVED"];

export const DEFAULT_PRICING_SETTINGS = {
  smartPricingEnabled: true,
  recommendationOnly: true,
  autoFillThreshold: 0.8,
  autoApplyThreshold: null,
  minObservations: 5,
  requireApprovalBelowMinMargin: true,
  allowStaffOverride: true,
};

// ── Settings live in shop.settingsJson.pricing (same low-risk pattern as
//    customerOrdering) — no new table for a small owner-config blob.
export async function getPricingSettings(shopId) {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
  let parsed = {};
  try { parsed = JSON.parse(shop?.settingsJson ?? "{}") ?? {}; } catch { parsed = {}; }
  return { ...DEFAULT_PRICING_SETTINGS, ...(parsed.pricing ?? {}) };
}

export async function updatePricingSettings(shopId, patch, actor = {}) {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
  let parsed = {};
  try { parsed = JSON.parse(shop?.settingsJson ?? "{}") ?? {}; } catch { parsed = {}; }
  const next = { ...DEFAULT_PRICING_SETTINGS, ...(parsed.pricing ?? {}), ...patch };
  parsed.pricing = next;
  await db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(parsed) } });
  await createAuditLog({ shopId, userId: actor.userId, action: "SMART_PRICING_SETTINGS_UPDATED", entityType: "PricingSettings", entityId: shopId, metadata: { patch } });
  return next;
}

function toEngineRule(row) {
  return {
    id: row.id,
    ruleType: row.ruleType,
    priority: row.priority,
    productId: row.productId ?? undefined,
    unitCode: row.unitCode ?? undefined,
    customerId: row.customerId ?? undefined,
    customerGroup: row.customerGroup ?? undefined,
    paymentMethod: row.paymentMethod ?? undefined,
    minQuantity: row.minQuantity ?? undefined,
    maxQuantity: row.maxQuantity ?? undefined,
    fixedUnitPrice: row.fixedUnitPrice ?? undefined,
    adjustmentType: row.adjustmentType ?? undefined,
    adjustmentValue: row.adjustmentValue ?? undefined,
    minimumMarginPercent: row.minimumMarginPercent ?? undefined,
    combinePolicy: row.combinePolicy ?? undefined,
    validFrom: row.validFrom ? row.validFrom.toISOString() : undefined,
    validUntil: row.validUntil ? row.validUntil.toISOString() : undefined,
    requiresOwnerApproval: row.requiresOwnerApproval,
    label: row.name,
    confidence: 1,
  };
}

/** The canonical evaluate endpoint — backend source of truth for a price. */
export async function evaluate(shopId, body = {}) {
  const product = await db.product.findFirst({ where: { id: body.productId, shopId } });
  if (!product) throw new AppError("Product not found", 404);

  let customerGroup = body.customerGroup;
  if (!customerGroup && body.customerId) {
    const customer = await db.customer.findFirst({ where: { id: body.customerId, shopId }, select: { customerGroup: true } });
    customerGroup = customer?.customerGroup ?? undefined;
  }

  const unitCode = body.unitCode || product.rateUnit || product.displayUnit || "piece";
  const rows = await db.pricingRule.findMany({
    where: {
      shopId,
      status: "ACTIVE",
      OR: [{ productId: product.id }, { productId: null }],
    },
    orderBy: { priority: "asc" },
  });

  const ctx = {
    shopId,
    productId: product.id,
    unitCode,
    customerId: body.customerId,
    customerGroup,
    quantity: Number(body.quantity ?? 1),
    billDate: body.billDate || new Date().toISOString(),
    paymentMethod: body.paymentMethod,
    productCost: Number(product.costPerRateUnit ?? 0),
    defaultPrice: Number(product.defaultPricePerRateUnit ?? 0),
    minimumSellingPrice: Number(product.minPricePerRateUnit ?? 0),
    maximumRetailPrice: Number(product.mrp ?? 0),
    source: body.source || "BILLING",
  };
  const settings = await getPricingSettings(shopId);
  return evaluatePricing(ctx, rows.map(toEngineRule), settings);
}

// ── Rule CRUD ────────────────────────────────────────────────────────────────
function validateRuleInput(input) {
  if (!input?.name || String(input.name).trim().length < 1) throw new AppError("Rule name is required", 400);
  if (!RULE_TYPES.includes(input.ruleType)) throw new AppError("Invalid rule type", 400);
  const hasPrice = input.fixedUnitPrice != null || (input.adjustmentType && input.adjustmentValue != null);
  if (!hasPrice) throw new AppError("A rule needs a fixed price or an adjustment", 400);
  if (input.minQuantity != null && input.maxQuantity != null && Number(input.minQuantity) > Number(input.maxQuantity)) {
    throw new AppError("Minimum quantity cannot exceed maximum quantity", 400);
  }
}

export async function listRules(shopId, { status, productId, customerId } = {}) {
  const where = { shopId, status: { not: "ARCHIVED" } };
  if (status && RULE_STATUSES.includes(status)) where.status = status;
  if (productId) where.productId = productId;
  if (customerId) where.customerId = customerId;
  const rules = await db.pricingRule.findMany({ where, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 500 });
  return { rules };
}

export async function createRule(shopId, input, actor = {}) {
  validateRuleInput(input);
  const priority = input.priority ?? RULE_TYPE_PRIORITY[input.ruleType] ?? 0;
  const rule = await db.pricingRule.create({
    data: {
      shopId,
      name: String(input.name).trim(),
      description: input.description ?? null,
      ruleType: input.ruleType,
      status: RULE_STATUSES.includes(input.status) ? input.status : "ACTIVE",
      priority,
      productId: input.productId ?? null,
      unitCode: input.unitCode ?? null,
      customerId: input.customerId ?? null,
      customerGroup: input.customerGroup ?? null,
      minQuantity: input.minQuantity ?? null,
      maxQuantity: input.maxQuantity ?? null,
      fixedUnitPrice: input.fixedUnitPrice ?? null,
      adjustmentType: input.adjustmentType ?? null,
      adjustmentValue: input.adjustmentValue ?? null,
      minimumMarginPercent: input.minimumMarginPercent ?? null,
      paymentMethod: input.paymentMethod ?? null,
      combinePolicy: input.combinePolicy ?? null,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      requiresOwnerApproval: input.requiresOwnerApproval === true,
      createdByUserId: actor.userId ?? null,
    },
  });
  await createAuditLog({ shopId, userId: actor.userId, action: "PRICING_RULE_CREATED", entityType: "PricingRule", entityId: rule.id, metadata: { ruleType: rule.ruleType, name: rule.name } });
  return rule;
}

export async function updateRule(shopId, ruleId, input, actor = {}) {
  const existing = await db.pricingRule.findFirst({ where: { id: ruleId, shopId } });
  if (!existing) throw new AppError("Pricing rule not found", 404);
  const merged = { ...existing, ...input, ruleType: input.ruleType ?? existing.ruleType };
  validateRuleInput(merged);
  const data = {};
  for (const key of ["name", "description", "ruleType", "status", "priority", "productId", "unitCode", "customerId", "customerGroup", "minQuantity", "maxQuantity", "fixedUnitPrice", "adjustmentType", "adjustmentValue", "minimumMarginPercent", "paymentMethod", "combinePolicy", "requiresOwnerApproval"]) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.validFrom !== undefined) data.validFrom = input.validFrom ? new Date(input.validFrom) : null;
  if (input.validUntil !== undefined) data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
  const rule = await db.pricingRule.update({ where: { id: ruleId }, data });
  await createAuditLog({ shopId, userId: actor.userId, action: "PRICING_RULE_UPDATED", entityType: "PricingRule", entityId: rule.id, metadata: { changed: Object.keys(data) } });
  return rule;
}

/** Soft delete — archive (never hard-delete; historical bills reference rule ids). */
export async function archiveRule(shopId, ruleId, actor = {}) {
  const existing = await db.pricingRule.findFirst({ where: { id: ruleId, shopId } });
  if (!existing) throw new AppError("Pricing rule not found", 404);
  const rule = await db.pricingRule.update({ where: { id: ruleId }, data: { status: "ARCHIVED" } });
  await createAuditLog({ shopId, userId: actor.userId, action: "PRICING_RULE_DELETED", entityType: "PricingRule", entityId: rule.id, metadata: { name: rule.name } });
  return { id: rule.id, status: rule.status };
}

/** Product pricing configuration (default triple + the rules that touch it). */
export async function getProductPricing(shopId, productId) {
  const product = await db.product.findFirst({ where: { id: productId, shopId } });
  if (!product) throw new AppError("Product not found", 404);
  const rules = await db.pricingRule.findMany({
    where: { shopId, status: { not: "ARCHIVED" }, OR: [{ productId }, { productId: null }] },
    orderBy: { priority: "asc" },
  });
  return {
    product: {
      id: product.id, name: product.name, rateUnit: product.rateUnit,
      defaultPrice: product.defaultPricePerRateUnit, minimumPrice: product.minPricePerRateUnit,
      cost: product.costPerRateUnit, mrp: product.mrp,
    },
    rules,
  };
}
