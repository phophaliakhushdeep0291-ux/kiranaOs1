import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { evaluatePricing, RULE_TYPE_PRIORITY } from "./pricing-engine.js";
import { moneyShadows } from "../../utils/money.js";

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
    sellingUnitId: row.sellingUnitId ?? undefined,
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
  const product = await db.product.findFirst({ where: { id: body.productId, shopId, deletedAt: null } });
  if (!product) throw new AppError("Product not found", 404);

  let customerGroup = body.customerGroup;
  if (!customerGroup && body.customerId) {
    const customer = await db.customer.findFirst({ where: { id: body.customerId, shopId }, select: { customerGroup: true } });
    customerGroup = customer?.customerGroup ?? undefined;
  }

  let sellingUnit = null;
  if (body.sellingUnitId) {
    sellingUnit = await db.productSellingUnit.findFirst({
      where: { id: body.sellingUnitId, shopId, productId: product.id, isActive: true },
    });
    if (!sellingUnit) throw new AppError("Selling unit is inactive or does not belong to this product", 400);
  } else if (body.unitCode) {
    sellingUnit = await db.productSellingUnit.findFirst({
      where: { shopId, productId: product.id, unitCode: body.unitCode, isActive: true },
    });
  } else {
    sellingUnit = await db.productSellingUnit.findFirst({
      where: { shopId, productId: product.id, isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  const unitCode = sellingUnit?.unitCode || body.unitCode || product.rateUnit || product.displayUnit || "piece";
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
    sellingUnitId: sellingUnit?.id,
    unitCode,
    unitLabel: sellingUnit?.name || product.displayUnit || unitCode,
    customerId: body.customerId,
    customerGroup,
    quantity: Number(body.quantity ?? 1),
    billDate: body.billDate || new Date().toISOString(),
    paymentMethod: body.paymentMethod,
    productCost: Number(sellingUnit?.costPrice ?? product.costPerRateUnit ?? 0),
    defaultPrice: Number(sellingUnit?.defaultPrice ?? product.defaultPricePerRateUnit ?? 0),
    minimumSellingPrice: Number(sellingUnit?.minimumPrice ?? product.minPricePerRateUnit ?? 0),
    maximumRetailPrice: Number(sellingUnit?.maximumPrice ?? product.mrp ?? 0),
    source: body.source || "BILLING",
  };
  const settings = await getPricingSettings(shopId);
  const result = evaluatePricing(ctx, rows.map(toEngineRule), settings);
  return {
    ...result,
    sellingUnit: sellingUnit ? {
      id: sellingUnit.id,
      unitCode: sellingUnit.unitCode,
      name: sellingUnit.name,
      unitType: sellingUnit.unitType,
      packSizeValue: sellingUnit.packSizeValue,
      packSizeUnit: sellingUnit.packSizeUnit,
      conversionToBase: sellingUnit.conversionToBase,
    } : null,
  };
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

async function assertRuleReferences(shopId, input, excludeRuleId = null) {
  if (input.productId) {
    const product = await db.product.findFirst({ where: { id: input.productId, shopId, deletedAt: null }, select: { id: true } });
    if (!product) throw new AppError("Product not found for this shop", 400);
  }
  if (input.customerId) {
    const customer = await db.customer.findFirst({ where: { id: input.customerId, shopId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new AppError("Customer not found for this shop", 400);
  }
  if (input.sellingUnitId) {
    const unit = await db.productSellingUnit.findFirst({ where: { id: input.sellingUnitId, shopId, isActive: true } });
    if (!unit || (input.productId && unit.productId !== input.productId)) {
      throw new AppError("Selling unit does not belong to the selected product", 400);
    }
  }

  const isQuantityRule = ["CUSTOMER_QUANTITY_PRICE", "CUSTOMER_GROUP_QUANTITY_PRICE", "PRODUCT_QUANTITY_PRICE"].includes(input.ruleType);
  if (!isQuantityRule || input.status === "ARCHIVED" || input.status === "PAUSED") return;
  const min = Number(input.minQuantity ?? 0);
  const max = input.maxQuantity == null ? Number.POSITIVE_INFINITY : Number(input.maxQuantity);
  const peers = await db.pricingRule.findMany({
    where: {
      shopId,
      ruleType: input.ruleType,
      status: "ACTIVE",
      productId: input.productId ?? null,
      sellingUnitId: input.sellingUnitId ?? null,
      customerId: input.customerId ?? null,
      customerGroup: input.customerGroup ?? null,
      ...(excludeRuleId ? { NOT: { id: excludeRuleId } } : {}),
    },
    select: { id: true, minQuantity: true, maxQuantity: true },
  });
  const overlap = peers.find((row) => {
    const rowMin = Number(row.minQuantity ?? 0);
    const rowMax = row.maxQuantity == null ? Number.POSITIVE_INFINITY : Number(row.maxQuantity);
    return min <= rowMax && rowMin <= max;
  });
  if (overlap) throw new AppError("Quantity ranges cannot overlap for the same product, unit, and customer scope", 409);
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
  await assertRuleReferences(shopId, input);
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
      sellingUnitId: input.sellingUnitId ?? null,
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
  await assertRuleReferences(shopId, merged, ruleId);
  const data = {};
  for (const key of ["name", "description", "ruleType", "status", "priority", "productId", "sellingUnitId", "unitCode", "customerId", "customerGroup", "minQuantity", "maxQuantity", "fixedUnitPrice", "adjustmentType", "adjustmentValue", "minimumMarginPercent", "paymentMethod", "combinePolicy", "requiresOwnerApproval"]) {
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
  const sellingUnits = await db.productSellingUnit.findMany({
    where: { shopId, productId },
    orderBy: [{ isDefault: "desc" }, { isActive: "desc" }, { name: "asc" }],
  });
  return {
    product: {
      id: product.id, name: product.name, rateUnit: product.rateUnit,
      defaultPrice: product.defaultPricePerRateUnit, minimumPrice: product.minPricePerRateUnit,
      cost: product.costPerRateUnit, mrp: product.mrp,
    },
    sellingUnits,
    rules,
  };
}

function normalizeSellingUnitInput(input, current = {}) {
  const next = { ...current, ...input };
  const unitType = String(next.unitType ?? "").trim().toLowerCase();
  if (["packet", "pack", "pouch"].includes(unitType) && (!(Number(next.packSizeValue) > 0) || !String(next.packSizeUnit ?? "").trim())) {
    throw new AppError("Packet and pouch units require a pack size and measurement unit", 400);
  }
  if (!(Number(next.conversionToBase) > 0)) throw new AppError("Base conversion must be greater than zero", 400);
  if (!(Number(next.defaultPrice) > 0)) throw new AppError("Selling price must be greater than zero", 400);
  if (next.minimumPrice != null && next.maximumPrice != null && Number(next.minimumPrice) > Number(next.maximumPrice)) {
    throw new AppError("Minimum price cannot exceed maximum price", 400);
  }
  return next;
}

function sellingUnitData(input) {
  return {
    name: String(input.name).trim(),
    unitType: String(input.unitType).trim(),
    unitCode: String(input.unitCode).trim().toLowerCase(),
    packSizeValue: input.packSizeValue == null ? null : Number(input.packSizeValue),
    packSizeUnit: input.packSizeUnit ? String(input.packSizeUnit).trim() : null,
    conversionToBase: Number(input.conversionToBase),
    barcode: input.barcode ? String(input.barcode).trim() : null,
    defaultPrice: Number(input.defaultPrice),
    minimumPrice: input.minimumPrice == null ? null : Number(input.minimumPrice),
    maximumPrice: input.maximumPrice == null ? null : Number(input.maximumPrice),
    costPrice: input.costPrice == null ? null : Number(input.costPrice),
    isDefault: input.isDefault === true,
    isActive: input.isActive !== false,
    ...moneyShadows({
      defaultPrice: Number(input.defaultPrice),
      minimumPrice: input.minimumPrice == null ? null : Number(input.minimumPrice),
      maximumPrice: input.maximumPrice == null ? null : Number(input.maximumPrice),
      costPrice: input.costPrice == null ? null : Number(input.costPrice),
    }),
  };
}

async function touchProductFromDefaultUnit(tx, productId, unit) {
  if (!unit.isDefault) {
    await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
    return;
  }
  await tx.product.update({
    where: { id: productId },
    data: {
      displayUnit: unit.name,
      rateUnit: unit.unitType,
      defaultPricePerRateUnit: unit.defaultPrice,
      minPricePerRateUnit: unit.minimumPrice ?? 0,
      costPerRateUnit: unit.costPrice ?? 0,
      mrp: unit.maximumPrice ?? 0,
      barcode: unit.barcode ?? undefined,
      ...moneyShadows({
        defaultPricePerRateUnit: unit.defaultPrice,
        minPricePerRateUnit: unit.minimumPrice ?? 0,
        costPerRateUnit: unit.costPrice ?? 0,
      }),
    },
  });
}

export async function listSellingUnits(shopId, productId) {
  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null }, select: { id: true } });
  if (!product) throw new AppError("Product not found", 404);
  return db.productSellingUnit.findMany({ where: { shopId, productId }, orderBy: [{ isDefault: "desc" }, { isActive: "desc" }, { name: "asc" }] });
}

export async function createSellingUnit(shopId, productId, input, actor = {}) {
  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null }, select: { id: true } });
  if (!product) throw new AppError("Product not found", 404);
  const normalized = normalizeSellingUnitInput(input);
  const unit = await db.$transaction(async (tx) => {
    if (normalized.isDefault) await tx.productSellingUnit.updateMany({ where: { shopId, productId }, data: { isDefault: false } });
    const created = await tx.productSellingUnit.create({ data: { shopId, productId, ...sellingUnitData(normalized) } });
    await touchProductFromDefaultUnit(tx, productId, created);
    return created;
  });
  await createAuditLog({ shopId, userId: actor.userId, action: "PRODUCT_SELLING_UNIT_CREATED", entityType: "ProductSellingUnit", entityId: unit.id, metadata: { productId, unitCode: unit.unitCode } });
  return unit;
}

export async function updateSellingUnit(shopId, productId, unitId, input, actor = {}) {
  const existing = await db.productSellingUnit.findFirst({ where: { id: unitId, shopId, productId } });
  if (!existing) throw new AppError("Selling unit not found", 404);
  const normalized = normalizeSellingUnitInput(input, existing);
  const unit = await db.$transaction(async (tx) => {
    if (normalized.isDefault) await tx.productSellingUnit.updateMany({ where: { shopId, productId, NOT: { id: unitId } }, data: { isDefault: false } });
    const updated = await tx.productSellingUnit.update({ where: { id: unitId }, data: sellingUnitData(normalized) });
    await touchProductFromDefaultUnit(tx, productId, updated);
    return updated;
  });
  await createAuditLog({ shopId, userId: actor.userId, action: "PRODUCT_SELLING_UNIT_UPDATED", entityType: "ProductSellingUnit", entityId: unit.id, metadata: { productId, changed: Object.keys(input) } });
  return unit;
}

export async function archiveSellingUnit(shopId, productId, unitId, actor = {}) {
  const existing = await db.productSellingUnit.findFirst({ where: { id: unitId, shopId, productId } });
  if (!existing) throw new AppError("Selling unit not found", 404);
  if (existing.isDefault) throw new AppError("Choose another default unit before disabling this one", 409);
  const unit = await db.$transaction(async (tx) => {
    const updated = await tx.productSellingUnit.update({ where: { id: unitId }, data: { isActive: false } });
    await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
    return updated;
  });
  await createAuditLog({ shopId, userId: actor.userId, action: "PRODUCT_SELLING_UNIT_ARCHIVED", entityType: "ProductSellingUnit", entityId: unit.id, metadata: { productId } });
  return { id: unit.id, isActive: unit.isActive };
}
