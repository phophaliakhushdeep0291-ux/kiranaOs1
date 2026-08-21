import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { evaluatePricing, RULE_TYPE_PRIORITY } from "./pricing-engine.js";
import { sellingUnitCostPrice, sellingUnitMaxPrice } from "../products/selling-unit-pricing.js";
import { moneyShadows } from "../../utils/money.js";
import { assertLocationCapability } from "../stores/location-access.service.js";

async function writeRequiredPricingAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Pricing action was not saved because its audit record could not be stored",
      503,
      "PRICING_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function normalizeActor(actor = {}) {
  return {
    userId: actor.userId ?? null,
    role: actor.role,
    deviceId: actor.deviceId ?? undefined,
    req: actor.req ?? null,
  };
}

function ruleAuditSnapshot(rule) {
  return {
    id: rule.id,
    name: rule.name,
    ruleType: rule.ruleType,
    status: rule.status,
    priority: rule.priority,
    productId: rule.productId,
    locationId: rule.locationId,
    sellingUnitId: rule.sellingUnitId,
    unitCode: rule.unitCode,
    customerId: rule.customerId,
    customerGroup: rule.customerGroup,
    minQuantity: rule.minQuantity,
    maxQuantity: rule.maxQuantity,
    fixedUnitPrice: rule.fixedUnitPrice,
    adjustmentType: rule.adjustmentType,
    adjustmentValue: rule.adjustmentValue,
    paymentMethod: rule.paymentMethod,
    validFrom: rule.validFrom,
    validUntil: rule.validUntil,
    requiresOwnerApproval: rule.requiresOwnerApproval,
  };
}

function sellingUnitAuditSnapshot(unit) {
  return {
    id: unit.id,
    productId: unit.productId,
    name: unit.name,
    unitType: unit.unitType,
    unitCode: unit.unitCode,
    conversionToBase: unit.conversionToBase,
    barcode: unit.barcode,
    defaultPrice: unit.defaultPrice,
    minimumPrice: unit.minimumPrice,
    maximumPrice: unit.maximumPrice,
    costPrice: unit.costPrice,
    isDefault: unit.isDefault,
    isActive: unit.isActive,
  };
}

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
  actor = normalizeActor(actor);
  return db.$transaction(async (tx) => {
    const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true, updatedAt: true } });
    if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
    let parsed = {};
    try { parsed = JSON.parse(shop.settingsJson ?? "{}") ?? {}; } catch { parsed = {}; }
    const before = { ...DEFAULT_PRICING_SETTINGS, ...(parsed.pricing ?? {}) };
    const next = { ...before, ...patch };
    parsed.pricing = next;
    const changed = await tx.shop.updateMany({
      where: { id: shopId, updatedAt: shop.updatedAt },
      data: { settingsJson: JSON.stringify(parsed) },
    });
    if (changed.count !== 1) throw new AppError("Pricing settings changed while saving; retry", 409, "PRICING_SETTINGS_CONCURRENT_CHANGE");
    await writeRequiredPricingAudit({
      shopId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      req: actor.req,
      action: "SMART_PRICING_SETTINGS_UPDATED",
      entityType: "PricingSettings",
      entityId: shopId,
      before,
      after: next,
      metadata: { changed: Object.keys(patch) },
    }, tx);
    return next;
  });
}

function toEngineRule(row) {
  return {
    id: row.id,
    ruleType: row.ruleType,
    priority: row.priority,
    productId: row.productId ?? undefined,
    locationId: row.locationId ?? undefined,
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
  // The product MRP belongs to the default pack, so an alternate pack without its
  // own MRP has to have it scaled to its size before it can act as a ceiling.
  const defaultSellingUnit = sellingUnit?.isDefault === false
    ? await db.productSellingUnit.findFirst({
      where: { shopId, productId: product.id, isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    })
    : sellingUnit;
  const rows = await db.pricingRule.findMany({
    where: {
      shopId,
      status: "ACTIVE",
      AND: [
        { OR: [{ productId: product.id }, { productId: null }] },
        { OR: [{ locationId: body.locationId ?? null }, { locationId: null }] },
      ],
    },
    orderBy: { priority: "asc" },
  });

  const ctx = {
    shopId,
    locationId: body.locationId,
    productId: product.id,
    sellingUnitId: sellingUnit?.id,
    unitCode,
    unitLabel: sellingUnit?.name || product.displayUnit || unitCode,
    customerId: body.customerId,
    customerGroup,
    quantity: Number(body.quantity ?? 1),
    billDate: body.billDate || new Date().toISOString(),
    paymentMethod: body.paymentMethod,
    productCost: sellingUnitCostPrice(sellingUnit, product, defaultSellingUnit),
    defaultPrice: Number(sellingUnit?.defaultPrice ?? product.defaultPricePerRateUnit ?? 0),
    minimumSellingPrice: Number(sellingUnit?.minimumPrice ?? product.minPricePerRateUnit ?? 0),
    maximumRetailPrice: sellingUnitMaxPrice(sellingUnit, product, defaultSellingUnit),
    source: body.source || "BILLING",
  };
  const settings = await getPricingSettings(shopId);
  const applicableRows = sellingUnit?.isDefault === false
    ? rows.filter((row) => row.productId !== product.id || Boolean(row.sellingUnitId || row.unitCode))
    : rows;
  const result = evaluatePricing(ctx, applicableRows.map(toEngineRule), settings);
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

/** Price a public catalog in one rules query so storefront prices stay identical to checkout. */
export async function priceCatalogProducts(shopId, products, locationId, quantitiesByProductId = {}) {
  if (!Array.isArray(products) || products.length === 0) return [];
  const rows = await db.pricingRule.findMany({
    where: {
      shopId,
      status: "ACTIVE",
      AND: [{ OR: [{ locationId }, { locationId: null }] }],
    },
    orderBy: { priority: "asc" },
  });
  const settings = await getPricingSettings(shopId);
  const now = new Date().toISOString();
  return products.map((product) => {
    const unitCode = product.rateUnit || product.displayUnit || "piece";
    const result = evaluatePricing({
      shopId,
      locationId,
      productId: product.id,
      unitCode,
      unitLabel: product.displayUnit || unitCode,
      quantity: Number(quantitiesByProductId[product.id] ?? 1),
      billDate: now,
      productCost: Number(product.costPerRateUnit ?? 0),
      defaultPrice: Number(product.defaultPricePerRateUnit ?? 0),
      minimumSellingPrice: Number(product.minPricePerRateUnit ?? 0),
      maximumRetailPrice: Number(product.mrp ?? 0),
      source: "CUSTOMER_ORDER",
    }, rows.filter((row) => !row.productId || row.productId === product.id).map(toEngineRule), settings);
    return { ...product, storefrontPrice: result.recommendedUnitPrice };
  });
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

async function assertRuleReferences(shopId, input, excludeRuleId = null, client = db) {
  if (input.locationId) {
    const location = await client.storeLocation.findFirst({ where: { id: input.locationId, shopId, active: true }, select: { id: true } });
    if (!location) throw new AppError("Store location not found for this shop", 400, "INVALID_STORE_LOCATION");
  }
  if (input.productId) {
    const product = await client.product.findFirst({ where: { id: input.productId, shopId, deletedAt: null }, select: { id: true } });
    if (!product) throw new AppError("Product not found for this shop", 400);
  }
  if (input.customerId) {
    const customer = await client.customer.findFirst({ where: { id: input.customerId, shopId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new AppError("Customer not found for this shop", 400);
  }
  if (input.sellingUnitId) {
    const unit = await client.productSellingUnit.findFirst({ where: { id: input.sellingUnitId, shopId, isActive: true } });
    if (!unit || (input.productId && unit.productId !== input.productId)) {
      throw new AppError("Selling unit does not belong to the selected product", 400);
    }
  }

  const isQuantityRule = ["CUSTOMER_QUANTITY_PRICE", "CUSTOMER_GROUP_QUANTITY_PRICE", "PRODUCT_QUANTITY_PRICE"].includes(input.ruleType);
  if (!isQuantityRule || input.status === "ARCHIVED" || input.status === "PAUSED") return;
  const min = Number(input.minQuantity ?? 0);
  const max = input.maxQuantity == null ? Number.POSITIVE_INFINITY : Number(input.maxQuantity);
  const peers = await client.pricingRule.findMany({
    where: {
      shopId,
      ruleType: input.ruleType,
      status: "ACTIVE",
      locationId: input.locationId ?? null,
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

export async function listRules(shopId, { status, productId, customerId, locationId } = {}) {
  const where = { shopId, status: { not: "ARCHIVED" } };
  if (status && RULE_STATUSES.includes(status)) where.status = status;
  if (productId) where.productId = productId;
  if (customerId) where.customerId = customerId;
  if (locationId) where.AND = [{ OR: [{ locationId }, { locationId: null }] }];
  const rules = await db.pricingRule.findMany({ where, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 500 });
  return { rules };
}

export async function createRule(shopId, input, actor = {}) {
  actor = normalizeActor(actor);
  validateRuleInput(input);
  const priority = input.priority ?? RULE_TYPE_PRIORITY[input.ruleType] ?? 0;
  return db.$transaction(async (tx) => {
    if (input.locationId) await assertLocationCapability({ shopId, userId: actor.userId, role: actor.role, locationId: input.locationId, capability: "inventory", client: tx });
    await assertRuleReferences(shopId, input, null, tx);
    const rule = await tx.pricingRule.create({
      data: {
        shopId,
        name: String(input.name).trim(),
        description: input.description ?? null,
        ruleType: input.ruleType,
        status: RULE_STATUSES.includes(input.status) ? input.status : "ACTIVE",
        priority,
        productId: input.productId ?? null,
        locationId: input.locationId ?? null,
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
        createdByUserId: actor.userId,
      },
    });
    await writeRequiredPricingAudit({
      shopId, userId: actor.userId, deviceId: actor.deviceId, req: actor.req,
      action: "PRICING_RULE_CREATED", entityType: "PricingRule", entityId: rule.id,
      after: ruleAuditSnapshot(rule), metadata: { ruleType: rule.ruleType, name: rule.name },
    }, tx);
    return rule;
  }, { isolationLevel: "Serializable" });
}

export async function updateRule(shopId, ruleId, input, actor = {}) {
  actor = normalizeActor(actor);
  return db.$transaction(async (tx) => {
    const existing = await tx.pricingRule.findFirst({ where: { id: ruleId, shopId } });
    if (!existing) throw new AppError("Pricing rule not found", 404);
    const merged = { ...existing, ...input, ruleType: input.ruleType ?? existing.ruleType };
    validateRuleInput(merged);
    if (merged.locationId) await assertLocationCapability({ shopId, userId: actor.userId, role: actor.role, locationId: merged.locationId, capability: "inventory", client: tx });
    await assertRuleReferences(shopId, merged, ruleId, tx);
    const data = {};
    for (const key of ["name", "description", "ruleType", "status", "priority", "productId", "locationId", "sellingUnitId", "unitCode", "customerId", "customerGroup", "minQuantity", "maxQuantity", "fixedUnitPrice", "adjustmentType", "adjustmentValue", "minimumMarginPercent", "paymentMethod", "combinePolicy", "requiresOwnerApproval"]) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.validFrom !== undefined) data.validFrom = input.validFrom ? new Date(input.validFrom) : null;
    if (input.validUntil !== undefined) data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
    const changed = await tx.pricingRule.updateMany({ where: { id: ruleId, shopId, updatedAt: existing.updatedAt }, data });
    if (changed.count !== 1) throw new AppError("Pricing rule changed while saving; retry", 409, "PRICING_RULE_CONCURRENT_CHANGE");
    const rule = await tx.pricingRule.findUniqueOrThrow({ where: { id: ruleId } });
    await writeRequiredPricingAudit({
      shopId, userId: actor.userId, deviceId: actor.deviceId, req: actor.req,
      action: "PRICING_RULE_UPDATED", entityType: "PricingRule", entityId: rule.id,
      before: ruleAuditSnapshot(existing), after: ruleAuditSnapshot(rule), metadata: { changed: Object.keys(data) },
    }, tx);
    return rule;
  }, { isolationLevel: "Serializable" });
}

/** Soft delete — archive (never hard-delete; historical bills reference rule ids). */
export async function archiveRule(shopId, ruleId, actor = {}) {
  actor = normalizeActor(actor);
  return db.$transaction(async (tx) => {
    const existing = await tx.pricingRule.findFirst({ where: { id: ruleId, shopId } });
    if (!existing) throw new AppError("Pricing rule not found", 404);
    if (existing.locationId) await assertLocationCapability({ shopId, userId: actor.userId, role: actor.role, locationId: existing.locationId, capability: "inventory", client: tx });
    const changed = await tx.pricingRule.updateMany({ where: { id: ruleId, shopId, status: existing.status, updatedAt: existing.updatedAt }, data: { status: "ARCHIVED" } });
    if (changed.count !== 1) throw new AppError("Pricing rule changed while archiving; retry", 409, "PRICING_RULE_CONCURRENT_CHANGE");
    const rule = await tx.pricingRule.findUniqueOrThrow({ where: { id: ruleId } });
    await writeRequiredPricingAudit({
      shopId, userId: actor.userId, deviceId: actor.deviceId, req: actor.req,
      action: "PRICING_RULE_DELETED", entityType: "PricingRule", entityId: rule.id,
      before: ruleAuditSnapshot(existing), after: ruleAuditSnapshot(rule), metadata: { name: rule.name },
    }, tx);
    return { id: rule.id, status: rule.status };
  });
}

/** Product pricing configuration (default triple + the rules that touch it). */
export async function getProductPricing(shopId, productId, locationId = null) {
  const product = await db.product.findFirst({ where: { id: productId, shopId } });
  if (!product) throw new AppError("Product not found", 404);
  const rules = await db.pricingRule.findMany({
    where: {
      shopId,
      status: { not: "ARCHIVED" },
      AND: [
        { OR: [{ productId }, { productId: null }] },
        ...(locationId ? [{ OR: [{ locationId }, { locationId: null }] }] : [{ locationId: null }]),
      ],
    },
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
    sku: input.sku ? String(input.sku).trim().toUpperCase() : null,
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
  actor = normalizeActor(actor);
  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null }, select: { id: true } });
  if (!product) throw new AppError("Product not found", 404);
  const normalized = normalizeSellingUnitInput(input);
  const unit = await db.$transaction(async (tx) => {
    if (normalized.isDefault) await tx.productSellingUnit.updateMany({ where: { shopId, productId }, data: { isDefault: false } });
    const created = await tx.productSellingUnit.create({ data: { shopId, productId, ...sellingUnitData(normalized) } });
    await touchProductFromDefaultUnit(tx, productId, created);
    await writeRequiredPricingAudit({
      shopId, userId: actor.userId, deviceId: actor.deviceId, req: actor.req,
      action: "PRODUCT_SELLING_UNIT_CREATED", entityType: "ProductSellingUnit", entityId: created.id,
      after: sellingUnitAuditSnapshot(created), metadata: { productId, unitCode: created.unitCode },
    }, tx);
    return created;
  });
  return unit;
}

export async function updateSellingUnit(shopId, productId, unitId, input, actor = {}) {
  actor = normalizeActor(actor);
  const unit = await db.$transaction(async (tx) => {
    const existing = await tx.productSellingUnit.findFirst({ where: { id: unitId, shopId, productId } });
    if (!existing) throw new AppError("Selling unit not found", 404);
    const normalized = normalizeSellingUnitInput(input, existing);
    if (normalized.isDefault) await tx.productSellingUnit.updateMany({ where: { shopId, productId, NOT: { id: unitId } }, data: { isDefault: false } });
    const changed = await tx.productSellingUnit.updateMany({
      where: { id: unitId, shopId, productId, updatedAt: existing.updatedAt },
      data: sellingUnitData(normalized),
    });
    if (changed.count !== 1) throw new AppError("Selling unit changed while saving; retry", 409, "SELLING_UNIT_CONCURRENT_CHANGE");
    const updated = await tx.productSellingUnit.findUniqueOrThrow({ where: { id: unitId } });
    await touchProductFromDefaultUnit(tx, productId, updated);
    await writeRequiredPricingAudit({
      shopId, userId: actor.userId, deviceId: actor.deviceId, req: actor.req,
      action: "PRODUCT_SELLING_UNIT_UPDATED", entityType: "ProductSellingUnit", entityId: updated.id,
      before: sellingUnitAuditSnapshot(existing), after: sellingUnitAuditSnapshot(updated), metadata: { productId, changed: Object.keys(input) },
    }, tx);
    return updated;
  });
  return unit;
}

export async function archiveSellingUnit(shopId, productId, unitId, actor = {}) {
  actor = normalizeActor(actor);
  const unit = await db.$transaction(async (tx) => {
    const existing = await tx.productSellingUnit.findFirst({ where: { id: unitId, shopId, productId } });
    if (!existing) throw new AppError("Selling unit not found", 404);
    if (existing.isDefault) throw new AppError("Choose another default unit before disabling this one", 409);
    const changed = await tx.productSellingUnit.updateMany({
      where: { id: unitId, shopId, productId, isActive: existing.isActive, updatedAt: existing.updatedAt },
      data: { isActive: false },
    });
    if (changed.count !== 1) throw new AppError("Selling unit changed while archiving; retry", 409, "SELLING_UNIT_CONCURRENT_CHANGE");
    const updated = await tx.productSellingUnit.findUniqueOrThrow({ where: { id: unitId } });
    await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
    await writeRequiredPricingAudit({
      shopId, userId: actor.userId, deviceId: actor.deviceId, req: actor.req,
      action: "PRODUCT_SELLING_UNIT_ARCHIVED", entityType: "ProductSellingUnit", entityId: updated.id,
      before: sellingUnitAuditSnapshot(existing), after: sellingUnitAuditSnapshot(updated), metadata: { productId },
    }, tx);
    return updated;
  });
  return { id: unit.id, isActive: unit.isActive };
}
