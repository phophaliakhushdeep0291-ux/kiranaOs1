import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import {
  getProductPermanentDeleteBlockReason,
  hasActiveDuplicateProductName,
  normalizeProductName,
} from "../../utils/productRecycleRules.js";
import { moneyShadows } from "../../utils/money.js";

export async function listProducts(shopId, { category, search, lowStock } = {}) {
  const where = {
    shopId,
    deletedAt: null,
    ...(category && { category }),
    ...(search && {
      OR: [
        { name: { contains: search } },
        { aliasesJson: { contains: search } },
      ],
    }),
  };

  const products = await db.product.findMany({
    where,
    orderBy: { name: "asc" },
    include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
  });

  // Parse aliasesJson back to array for response
  const parsed = products.map(deserializeProduct);

  if (lowStock) {
    return parsed.filter(
      (p) => p.lowStockThreshold > 0 && p.stockBaseQty <= p.lowStockThreshold
    );
  }

  return parsed;
}

export async function getProduct(shopId, id) {
  const product = await db.product.findFirst({
    where: { id, shopId, deletedAt: null },
    include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
  });
  if (!product) throw new AppError("Product not found", 404);
  return deserializeProduct(product);
}

export async function createProduct(shopId, data, { identity = null } = {}) {
  const productIdentity = normalizeProductIdentity(shopId, identity);

  // Idempotency must win before the name-conflict check: a retried offline create
  // (lost ack, or the same product re-pushed under a new event id) carries the same
  // client identity and must converge on the existing product instead of failing with
  // "name already exists" or creating a duplicate. The online path passes no identity,
  // so it keeps the original create-and-validate behaviour.
  if (hasProductIdentity(productIdentity)) {
    const existing = await findExistingProductByIdentity(db, shopId, productIdentity);
    if (existing) return deserializeProduct(existing);
  }

  await assertNoActiveProductNameConflict(shopId, data.name);

  const { aliases, sellingUnits, baseUpdatedAt: _baseUpdatedAt, ...rawRest } = data;
  const normalizedUnits = normalizeSellingUnits(rawRest, sellingUnits);
  const rest = applyDefaultSellingUnitToProduct(rawRest, normalizedUnits);
  try {
    const product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...rest,
          ...moneyShadows({
            costPerRateUnit: rest.costPerRateUnit,
            minPricePerRateUnit: rest.minPricePerRateUnit,
            defaultPricePerRateUnit: rest.defaultPricePerRateUnit,
          }),
          shopId,
          aliasesJson: JSON.stringify(aliases ?? []),
          clientProductId: productIdentity.clientProductId,
          idempotencyKey: productIdentity.idempotencyKey,
          sourceDeviceId: productIdentity.sourceDeviceId,
        },
      });
      await writeSellingUnits(tx, shopId, created.id, normalizedUnits);
      return tx.product.findUnique({
        where: { id: created.id },
        include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
      });
    });
    return deserializeProduct(product);
  } catch (error) {
    // Race backstop: two concurrent creates with the same client identity collide on the
    // unique index; the loser resolves to the winner instead of surfacing a 500.
    if (isUniqueConstraintError(error) && hasProductIdentity(productIdentity)) {
      const existing = await findExistingProductByIdentity(db, shopId, productIdentity);
      if (existing) return deserializeProduct(existing);
    }
    throw error;
  }
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

function normalizeProductIdentity(shopId, identity) {
  const clientProductId = pickString(identity?.clientProductId, identity?.localProductId, identity?.localId);
  const sourceDeviceId = pickString(identity?.sourceDeviceId);
  const explicitKey = pickString(identity?.idempotencyKey);
  const derivedKey = !explicitKey && sourceDeviceId && clientProductId
    ? `create-product:${shopId}:${sourceDeviceId}:${clientProductId}`
    : null;
  return { clientProductId, idempotencyKey: explicitKey ?? derivedKey, sourceDeviceId };
}

function hasProductIdentity(identity) {
  // clientProductId alone is enough to converge a sequential retry (it is the client's
  // unique local product id). A device id, when present, additionally derives an
  // idempotencyKey that the unique index enforces against concurrent races.
  return Boolean(identity?.idempotencyKey || identity?.clientProductId);
}

async function findExistingProductByIdentity(client, shopId, identity) {
  if (!hasProductIdentity(identity)) return null;
  if (identity.idempotencyKey) {
    const byKey = await client.product.findFirst({
      where: { shopId, idempotencyKey: identity.idempotencyKey },
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
    });
    if (byKey) return byKey;
  }
  if (identity.sourceDeviceId && identity.clientProductId) {
    const byDevice = await client.product.findFirst({
      where: { shopId, sourceDeviceId: identity.sourceDeviceId, clientProductId: identity.clientProductId },
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
    });
    if (byDevice) return byDevice;
  }
  if (identity.clientProductId) {
    return client.product.findFirst({
      where: { shopId, clientProductId: identity.clientProductId },
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
    });
  }
  return null;
}

export async function updateProduct(shopId, id, data) {
  const existing = await getProduct(shopId, id); // ensures it exists and belongs to shop
  if (data.name) await assertNoActiveProductNameConflict(shopId, data.name, id);

  const { aliases, sellingUnits, baseUpdatedAt, ...rawRest } = data;
  const normalizedUnits = sellingUnits === undefined ? undefined : normalizeSellingUnits({ ...existing, ...rawRest }, sellingUnits);
  const rest = normalizedUnits ? applyDefaultSellingUnitToProduct(rawRest, normalizedUnits) : rawRest;

  // Optimistic concurrency: reject if the server moved past the version this edit
  // was based on (another device changed it first). A 1s tolerance avoids
  // sub-second false positives; a missing baseUpdatedAt keeps legacy last-write-wins.
  if (baseUpdatedAt) {
    const serverTs = new Date(existing.updatedAt).getTime();
    const baseTs = new Date(baseUpdatedAt).getTime();
    if (Number.isFinite(serverTs) && Number.isFinite(baseTs) && serverTs > baseTs + 1000) {
      const err = new AppError(`"${existing.name}" was changed on another device — reload to see the latest before editing.`, 409);
      err.code = "PRODUCT_STALE_WRITE";
      throw err;
    }
  }
  const updateData = {
    ...rest,
    ...moneyShadows({
      costPerRateUnit: rest.costPerRateUnit,
      minPricePerRateUnit: rest.minPricePerRateUnit,
      defaultPricePerRateUnit: rest.defaultPricePerRateUnit,
    }),
  };
  if (aliases !== undefined) updateData.aliasesJson = JSON.stringify(aliases);

  const updated = await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: updateData,
    });
    if (normalizedUnits) await writeSellingUnits(tx, shopId, id, normalizedUnits);
    return tx.product.findUnique({
      where: { id },
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
    });
  });
  return deserializeProduct(updated);
}

export async function softDeleteProduct(shopId, id) {
  await getProduct(shopId, id);

  const deleted = await db.product.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return deserializeProduct(deleted);
}

export async function listDeletedProducts(shopId, { search } = {}) {
  const products = await db.product.findMany({
    where: {
      shopId,
      deletedAt: { not: null },
      ...(search && {
        OR: [
          { name: { contains: search } },
          { aliasesJson: { contains: search } },
        ],
      }),
    },
    orderBy: { deletedAt: "desc" },
  });

  return products.map(deserializeProduct);
}

export async function restoreDeletedProduct(shopId, id) {
  const deletedProduct = await getDeletedProduct(shopId, id);

  const activeProducts = await db.product.findMany({
    where: { shopId, deletedAt: null },
    select: { id: true, name: true, category: true, deletedAt: true },
  });

  if (hasActiveDuplicateProductName(deletedProduct, activeProducts)) {
    throw new AppError(
      `Cannot restore product because an active product named "${deletedProduct.name}" already exists`,
      409
    );
  }

  const restored = await db.product.update({
    where: { id },
    data: { deletedAt: null },
  });

  return deserializeProduct(restored);
}

export async function permanentlyDeleteProduct(shopId, id) {
  const deletedProduct = await getDeletedProduct(shopId, id);
  const blockReason = await getPermanentDeleteBlockReason(id);

  if (blockReason) {
    throw new AppError(
      `${blockReason}. Keep this product in recycle bin to preserve audit/history records.`,
      409
    );
  }

  await db.$transaction(async (tx) => {
    // Bill items keep their own name/rate/cost snapshots, so the product link can
    // safely be removed before hard-deleting the product master record.
    await tx.billItem.updateMany({
      where: { productId: id },
      data: { productId: null },
    });

    await tx.product.delete({
      where: { id: deletedProduct.id },
    });
  });

  return {
    id: deletedProduct.id,
    name: deletedProduct.name,
    category: deletedProduct.category,
    deletedAt: deletedProduct.deletedAt,
  };
}

export async function emptyProductRecycleBin(shopId) {
  const deletedProducts = await db.product.findMany({
    where: { shopId, deletedAt: { not: null } },
    select: { id: true, name: true, category: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });

  const deleted = [];
  const blocked = [];

  await db.$transaction(async (tx) => {
    for (const product of deletedProducts) {
      const blockReason = await getPermanentDeleteBlockReason(product.id, tx);

      if (blockReason) {
        blocked.push({ id: product.id, name: product.name, category: product.category, reason: blockReason });
        continue;
      }

      await tx.billItem.updateMany({
        where: { productId: product.id },
        data: { productId: null },
      });

      await tx.product.delete({ where: { id: product.id } });
      deleted.push({ id: product.id, name: product.name, category: product.category, deletedAt: product.deletedAt });
    }
  });

  return {
    deletedCount: deleted.length,
    blockedCount: blocked.length,
    deleted,
    blocked,
  };
}

async function assertNoActiveProductNameConflict(shopId, name, excludeId = null) {
  const normalizedName = normalizeProductName(name);
  if (!normalizedName) return;

  const activeProducts = await db.product.findMany({
    where: { shopId, deletedAt: null, ...(excludeId && { NOT: { id: excludeId } }) },
    select: { id: true, name: true },
  });

  const duplicate = activeProducts.find((product) => normalizeProductName(product.name) === normalizedName);
  if (duplicate) {
    const err = new AppError(`Product named "${name}" already exists`, 409);
    err.code = "PRODUCT_NAME_DUPLICATE";
    throw err;
  }
}

async function getDeletedProduct(shopId, id) {
  const product = await db.product.findFirst({
    where: { id, shopId, deletedAt: { not: null } },
  });

  if (!product) throw new AppError("Deleted product not found in recycle bin", 404);
  return product;
}

async function getPermanentDeleteBlockReason(productId, client = db) {
  const stockLedgerCount = await client.stockLedger.count({ where: { productId } });
  const purchaseHistoryCount = await client.purchaseHistory.count({ where: { productId } });

  return getProductPermanentDeleteBlockReason({
    stockLedgerCount,
    purchaseHistoryCount,
  });
}

// ── Internal helper ───────────────────────────────────────────
export function deserializeProduct(p) {
  return {
    ...p,
    aliases: JSON.parse(p.aliasesJson ?? "[]"),
    sellingUnits: Array.isArray(p.sellingUnits) ? p.sellingUnits : undefined,
  };
}

function compactText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unitCodeFor(unit, index) {
  const explicit = compactText(unit?.unitCode);
  if (explicit) return explicit.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const type = compactText(unit?.unitType) ?? "unit";
  const size = Number(unit?.packSizeValue ?? 0) > 0 ? String(Number(unit.packSizeValue)) : String(index + 1);
  const measure = compactText(unit?.packSizeUnit) ?? "count";
  return `${type}-${size}-${measure}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function legacySellingUnit(product) {
  const unitType = compactText(product.rateUnit) ?? compactText(product.displayUnit) ?? "piece";
  const baseUnit = compactText(product.baseUnit) ?? unitType;
  let conversionToBase = 1;
  if (["kg", "kilogram"].includes(unitType.toLowerCase()) && ["g", "gram"].includes(baseUnit.toLowerCase())) conversionToBase = 1000;
  if (["litre", "liter", "l"].includes(unitType.toLowerCase()) && baseUnit.toLowerCase() === "ml") conversionToBase = 1000;
  if (unitType.toLowerCase() === "dozen" && baseUnit.toLowerCase() === "piece") conversionToBase = 12;
  return {
    name: unitType,
    unitType,
    unitCode: unitType,
    packSizeValue: null,
    packSizeUnit: null,
    conversionToBase,
    barcode: compactText(product.barcode),
    defaultPrice: Number(product.defaultPricePerRateUnit ?? 0),
    minimumPrice: Number(product.minPricePerRateUnit ?? 0) || null,
    maximumPrice: Number(product.mrp ?? 0) || null,
    costPrice: Number(product.costPerRateUnit ?? 0) || null,
    isDefault: true,
    isActive: true,
  };
}

function normalizeSellingUnits(product, units) {
  const source = Array.isArray(units) && units.length ? units : [legacySellingUnit(product)];
  const seen = new Set();
  let defaultAssigned = false;
  return source.map((unit, index) => {
    const unitCode = unitCodeFor(unit, index);
    if (!unitCode || seen.has(unitCode)) throw new AppError("Selling-unit codes must be unique for this product", 400);
    seen.add(unitCode);
    const unitType = compactText(unit.unitType) ?? "piece";
    const packSizeValue = unit.packSizeValue == null ? null : Number(unit.packSizeValue);
    const packSizeUnit = compactText(unit.packSizeUnit);
    if (["packet", "pack", "pouch"].includes(unitType.toLowerCase()) && (!(packSizeValue > 0) || !packSizeUnit)) {
      throw new AppError("Packet and pouch units require a pack size and measurement unit", 400);
    }
    const isDefault = !defaultAssigned && (unit.isDefault === true || !source.some((row) => row.isDefault === true));
    if (isDefault) defaultAssigned = true;
    return {
      id: compactText(unit.id),
      name: compactText(unit.name) ?? [unitType, packSizeValue, packSizeUnit].filter(Boolean).join(" "),
      unitType,
      unitCode,
      packSizeValue,
      packSizeUnit,
      conversionToBase: Number(unit.conversionToBase),
      barcode: compactText(unit.barcode),
      defaultPrice: Number(unit.defaultPrice),
      minimumPrice: unit.minimumPrice == null ? null : Number(unit.minimumPrice),
      maximumPrice: unit.maximumPrice == null ? null : Number(unit.maximumPrice),
      costPrice: unit.costPrice == null ? null : Number(unit.costPrice),
      isDefault,
      isActive: unit.isActive !== false,
    };
  });
}

function applyDefaultSellingUnitToProduct(product, units) {
  const unit = units.find((row) => row.isDefault) ?? units[0];
  if (!unit) return product;
  return {
    ...product,
    displayUnit: unit.name,
    rateUnit: unit.unitType,
    barcode: unit.barcode ?? product.barcode,
    costPerRateUnit: unit.costPrice ?? product.costPerRateUnit ?? 0,
    minPricePerRateUnit: unit.minimumPrice ?? product.minPricePerRateUnit ?? 0,
    defaultPricePerRateUnit: unit.defaultPrice,
    mrp: unit.maximumPrice ?? product.mrp ?? 0,
  };
}

async function writeSellingUnits(tx, shopId, productId, units) {
  await tx.productSellingUnit.updateMany({ where: { shopId, productId }, data: { isDefault: false } });
  for (const unit of units) {
    const data = {
      name: unit.name,
      unitType: unit.unitType,
      packSizeValue: unit.packSizeValue,
      packSizeUnit: unit.packSizeUnit,
      conversionToBase: unit.conversionToBase,
      barcode: unit.barcode,
      defaultPrice: unit.defaultPrice,
      ...moneyShadows({
        defaultPrice: unit.defaultPrice,
        minimumPrice: unit.minimumPrice,
        maximumPrice: unit.maximumPrice,
        costPrice: unit.costPrice,
      }),
      minimumPrice: unit.minimumPrice,
      maximumPrice: unit.maximumPrice,
      costPrice: unit.costPrice,
      isDefault: unit.isDefault,
      isActive: unit.isActive,
    };
    await tx.productSellingUnit.upsert({
      where: { shopId_productId_unitCode: { shopId, productId, unitCode: unit.unitCode } },
      update: data,
      create: { ...(unit.id ? { id: unit.id } : {}), shopId, productId, unitCode: unit.unitCode, ...data },
    });
  }
}
