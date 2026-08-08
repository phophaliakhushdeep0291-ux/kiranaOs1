import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { requireFeatureAccess } from "../feature-gates/featureGate.service.js";
import {
  getProductPermanentDeleteBlockReason,
  hasActiveDuplicateProductName,
  normalizeProductName,
} from "../../utils/productRecycleRules.js";
import { moneyShadows, round2 } from "../../utils/money.js";
import {
  getLocationQuantity,
  resolveOperationalLocation,
  setLocationInventory,
} from "../stores/location-context.service.js";

async function applyLocationInventory(shopId, products, locationId) {
  if (!locationId || products.length === 0) return products;
  const location = await resolveOperationalLocation(shopId, locationId);
  const productIds = products.map((product) => product.id);
  const rows = await db.locationStock.findMany({
    where: { shopId, productId: { in: productIds } },
    select: { locationId: true, productId: true, stockBaseQty: true, lowStockThreshold: true },
  });
  const selected = new Map(
    rows.filter((row) => row.locationId === location.id).map((row) => [row.productId, row]),
  );
  const allocated = new Map();
  if (location.isPrimary) {
    for (const row of rows) {
      allocated.set(row.productId, (allocated.get(row.productId) ?? 0) + Number(row.stockBaseQty || 0));
    }
  }
  return products.map((product) => {
    const row = selected.get(product.id);
    const stockBaseQty = location.isPrimary
      ? Number(product.stockBaseQty || 0) - (allocated.get(product.id) ?? 0)
      : Number(row?.stockBaseQty || 0);
    return {
      ...product,
      stockBaseQty: Number(stockBaseQty.toFixed(2)),
      lowStockThreshold: row?.lowStockThreshold ?? product.lowStockThreshold,
      inventoryLocationId: location.id,
      inventoryLocationName: location.name,
      inventoryLocationCode: location.code,
    };
  });
}

export async function listProducts(shopId, { category, search, lowStock, locationId } = {}) {
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
  const parsed = await applyLocationInventory(shopId, products.map(deserializeProduct), locationId);

  if (lowStock) {
    return parsed.filter(
      (p) => p.lowStockThreshold > 0 && p.stockBaseQty <= p.lowStockThreshold
    );
  }

  return parsed;
}

export async function getProduct(shopId, id, { locationId } = {}) {
  const product = await db.product.findFirst({
    where: { id, shopId, deletedAt: null },
    include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
  });
  if (!product) throw new AppError("Product not found", 404);
  const [scoped] = await applyLocationInventory(shopId, [deserializeProduct(product)], locationId);
  return scoped;
}

// Per-packaging stock was refused outright until the paths that move stock actually
// maintained ProductSellingUnit.onHandQty — otherwise the counts would sit frozen
// while real stock moved through the shared pool, which is worse than not having the
// feature. Sale, cancellation, sale return and stock-in now all maintain them.
//
// The paths that still cannot (purchase-order receipt, damage, stock counts,
// absolute stock edits, supplier returns) are not silently permitted: they refuse
// with PACKAGING_STOCK_PATH_UNSUPPORTED at the movement choke point in
// location-context.service.js, so an unwired path fails loudly instead of drifting.

export async function createProduct(shopId, data, { identity = null } = {}) {
  if (data.batchTrackingEnabled) await requireFeatureAccess(shopId, "batch_expiry");
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

  const { aliases, variantAxes, sellingUnits, baseUpdatedAt: _baseUpdatedAt, ...rawRest } = data;
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
          variantAxesJson: JSON.stringify(variantAxes ?? []),
          // After ...rest on purpose: a variant grid overrides whatever packaging
          // mode was asked for, because pooled variants share one stock number.
          packagingMode: packagingModeForAxes(variantAxes, rest.packagingMode),
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

/**
 * Apply a stock quantity supplied on a product edit as a real, recorded movement.
 *
 * Mirrors inventory.service.correctStock: the same setLocationInventory primitive
 * (which is atomic and rejects a concurrent change with 409) plus an explicit
 * StockLedger row, so "current stock == sum of recorded movements" continues to
 * hold. A no-op change writes nothing rather than logging a zero-quantity row.
 */
async function applyStockCorrectionInTransaction(tx, shopId, productId, newStockBaseQty, locationId) {
  const requested = Number(newStockBaseQty);
  if (!Number.isFinite(requested)) return;

  const location = await resolveOperationalLocation(shopId, locationId, tx);
  const product = await tx.product.findFirst({ where: { id: productId, shopId, deletedAt: null } });
  if (!product) return;

  const currentQty = await getLocationQuantity(tx, shopId, location, product);
  if (round2(currentQty) === round2(requested)) return;

  const stockResult = await setLocationInventory(tx, { shopId, location, product, newStockBaseQty: requested });

  await tx.stockLedger.create({
    data: {
      shopId,
      locationId: location.id,
      productId,
      productName: product.name,
      action: "correction",
      changeBaseQty: stockResult.difference,
      oldStockBaseQty: stockResult.oldStock,
      newStockBaseQty: stockResult.newStock,
      note: "Stock set from product edit",
    },
  });
}

export async function updateProduct(shopId, id, data) {
  if (data.batchTrackingEnabled) await requireFeatureAccess(shopId, "batch_expiry");
  const existing = await getProduct(shopId, id); // ensures it exists and belongs to shop
  if (data.name) await assertNoActiveProductNameConflict(shopId, data.name, id);

  // Stock is never written by spreading the request body. On-hand quantity is
  // authoritative state that must move through the shared inventory primitive so
  // that a StockLedger row is recorded, LocationStock stays in step, and a
  // concurrent sale cannot be silently overwritten. See docs/STABILIZATION_AUDIT.md
  // P0-3. Bulk edit legitimately sets stock here, so the field is honoured — it is
  // just no longer applied blindly.
  const { aliases, variantAxes, sellingUnits, baseUpdatedAt, stockBaseQty: requestedStockBaseQty, ...rawRest } = data;
  const reconciledUnits = sellingUnits === undefined
    ? undefined
    : carryPriceEditIntoUntouchedDefaultUnit(sellingUnits, rawRest, existing);
  const normalizedUnits = reconciledUnits === undefined ? undefined : normalizeSellingUnits({ ...existing, ...rawRest }, reconciledUnits);
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
  if (variantAxes !== undefined) {
    updateData.variantAxesJson = JSON.stringify(variantAxes);
    // Turning a product into a variant grid must take its packaging mode with it,
    // or the sizes silently share one stock pool. Clearing the grid leaves the
    // mode alone: the per-pack rows are still there and still hold their counts.
    updateData.packagingMode = packagingModeForAxes(variantAxes, rest.packagingMode ?? existing.packagingMode);
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: updateData,
    });
    if (requestedStockBaseQty !== undefined) {
      await applyStockCorrectionInTransaction(tx, shopId, id, requestedStockBaseQty, data.locationId ?? null);
    }
    if (normalizedUnits) await writeSellingUnits(tx, shopId, id, normalizedUnits);
    else await syncDefaultSellingUnitPricing(tx, shopId, id, { ...existing, ...rest });
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

/**
 * Refuse a barcode that any product in this shop already answers to.
 *
 * Wider than the database constraint on purpose. `Product_shopId_barcode_key` covers
 * Product.barcode only, but a scan resolves against three columns — resolveScanMatch()
 * on the till matches Product.barcode OR Product.sku, and per-pack codes live on
 * ProductSellingUnit.barcode. Binding a code that already sits in one of the other two
 * would pass the constraint and still make the next scan of it ambiguous, which is the
 * exact failure this feature exists to prevent.
 */
async function assertBarcodeAvailable(shopId, code, excludeProductId = null, client = db) {
  const exclude = excludeProductId ? { NOT: { id: excludeProductId } } : {};
  // Soft-deleted products are included: they hold their code until they are purged,
  // because restoring one from the recycle bin would otherwise create a real duplicate.
  const owner = await client.product.findFirst({
    where: { shopId, ...exclude, OR: [{ barcode: code }, { sku: code }] },
    select: { id: true, name: true, deletedAt: true },
  });
  if (owner) {
    const where = owner.deletedAt ? " (in the recycle bin)" : "";
    const err = new AppError(`Barcode ${code} already belongs to "${owner.name}"${where}`, 409);
    err.code = "PRODUCT_BARCODE_DUPLICATE";
    err.details = { productId: owner.id, productName: owner.name, inRecycleBin: Boolean(owner.deletedAt) };
    throw err;
  }

  const unitOwner = await client.productSellingUnit.findFirst({
    where: { shopId, barcode: code, ...(excludeProductId ? { NOT: { productId: excludeProductId } } : {}) },
    select: { productId: true, unitCode: true, product: { select: { name: true } } },
  });
  if (unitOwner) {
    const err = new AppError(
      `Barcode ${code} already belongs to the ${unitOwner.unitCode} pack of "${unitOwner.product?.name ?? "another product"}"`,
      409,
    );
    err.code = "PRODUCT_BARCODE_DUPLICATE";
    err.details = { productId: unitOwner.productId, productName: unitOwner.product?.name ?? null, unitCode: unitOwner.unitCode };
    throw err;
  }
}

/**
 * Bind a scanned code to a product that does not have one yet — capture-on-first-scan.
 *
 * Three rules, all of them correctness rather than polish:
 *
 *  - It never REBINDS. A product that already answers to a code keeps it; changing a
 *    barcode is an explicit action from the product screen, not something a cashier can
 *    do by scanning the wrong packet during a queue.
 *  - Re-binding the SAME code is a success, not an error. An offline bind replays
 *    through the outbox whenever a push is retried, and a retry that 409s would strand
 *    the operation in the queue forever.
 *  - Uniqueness is checked against every column a scan can match, then enforced again by
 *    the database, so two devices binding the same code concurrently cannot both win.
 *
 * `client` exists so a transaction (or a test) can supply its own Prisma client, the same
 * way createAuditLog does. It defaults to the shared one.
 */
export async function bindProductBarcode(shopId, productId, barcode, { identity = null, req = null, userId = null, client = db } = {}) {
  const code = compactText(barcode);
  if (!code) {
    const err = new AppError("A barcode is required", 400);
    err.code = "PRODUCT_BARCODE_REQUIRED";
    throw err;
  }

  const product = await client.product.findFirst({ where: { id: productId, shopId, deletedAt: null } });
  if (!product) throw new AppError("Product not found", 404);

  const current = compactText(product.barcode);
  // Idempotent replay: the same device (or another) already landed this exact bind.
  if (current === code) return deserializeProduct(product);
  if (current) {
    const err = new AppError(
      `"${product.name}" already has barcode ${current}. Change it from the product screen.`,
      409,
    );
    err.code = "PRODUCT_BARCODE_ALREADY_SET";
    err.details = { productId: product.id, productName: product.name, currentBarcode: current };
    throw err;
  }

  await assertBarcodeAvailable(shopId, code, productId, client);

  let updated;
  try {
    updated = await client.product.update({
      where: { id: product.id },
      // sku mirrors barcode the same way the create path does, so a scan resolves
      // whichever column the till happens to match on.
      data: { barcode: code, ...(compactText(product.sku) ? {} : { sku: code }) },
    });
  } catch (error) {
    // The unique index is the real arbiter. Two devices that both passed the read
    // above race here, and exactly one loses — deterministically, at the database.
    if (error?.code === "P2002") {
      const err = new AppError(`Barcode ${code} was just bound to another product`, 409);
      err.code = "PRODUCT_BARCODE_DUPLICATE";
      throw err;
    }
    throw error;
  }

  await createAuditLog({
    shopId,
    userId,
    req,
    client,
    // A bind that arrived over sync has no request to read the device from, so the
    // originating till is carried in the event itself. `undefined` (not null) keeps the
    // online path falling back to the request header.
    deviceId: identity?.sourceDeviceId ?? undefined,
    action: "product_barcode_bound",
    entityType: "product",
    entityId: product.id,
    before: { barcode: product.barcode, sku: product.sku },
    after: { barcode: updated.barcode, sku: updated.sku },
    metadata: {
      productName: product.name,
      barcode: code,
      source: identity?.sourceDeviceId ? "sync" : "online",
      clientProductId: identity?.clientProductId ?? null,
    },
  });

  return deserializeProduct(updated);
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
    variantAxes: parseVariantAxes(p.variantAxesJson),
    sellingUnits: Array.isArray(p.sellingUnits) ? p.sellingUnits : undefined,
  };
}

/**
 * A grid the client can render even if the stored JSON is damaged. A product
 * whose axes fail to parse is an ordinary product, not a 500 on the catalogue.
 */
function parseVariantAxes(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * A product with a variant grid holds stock per row, never pooled — see the
 * variantAxesJson comment in schema.prisma. Declaring axes is therefore enough
 * to choose the packaging mode; the shopkeeper never has to know the term.
 */
function packagingModeForAxes(axes, fallback) {
  return Array.isArray(axes) && axes.length > 0 ? "per_pack" : fallback;
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
      // Per-packaging stock. Carried through explicitly: anything this function
      // does not name is dropped, so omitting these silently discarded the
      // quantities the shopkeeper typed per pack.
      onHandQty: unit.onHandQty == null ? null : Number(unit.onHandQty),
      lowStockThreshold: unit.lowStockThreshold == null ? null : Number(unit.lowStockThreshold),
      reorderLevel: unit.reorderLevel == null ? null : Number(unit.reorderLevel),
      // Same reason as the stock fields above: unnamed keys are dropped, so
      // leaving these out would silently discard which size and colour the row is.
      variantValue1: compactText(unit.variantValue1),
      variantValue2: compactText(unit.variantValue2),
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

const UNIT_PRICE_FIELDS = ["defaultPrice", "minimumPrice", "maximumPrice", "costPrice"];
const PRODUCT_TO_UNIT_PRICE = {
  defaultPricePerRateUnit: "defaultPrice",
  minPricePerRateUnit: "minimumPrice",
  mrp: "maximumPrice",
  costPerRateUnit: "costPrice",
};

const samePrice = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

/**
 * A client that edits the price on the product form but re-sends the product's
 * existing sellingUnits unchanged (the shape the offline product editor builds)
 * would otherwise have its edit silently reverted: applyDefaultSellingUnitToProduct
 * copies the stale unit back over the product and the request still returns 200.
 *
 * If the incoming default unit's pricing is untouched relative to what is stored,
 * an explicit product-level price change is the real intent — carry it into the
 * unit. A unit the client actually edited still wins, so direct unit pricing
 * (pack/dozen/bag rates) keeps working.
 */
function carryPriceEditIntoUntouchedDefaultUnit(units, incomingProduct, existing) {
  if (!Array.isArray(units) || !units.length) return units;
  const storedDefault = (existing?.sellingUnits ?? []).find((unit) => unit.isDefault);
  if (!storedDefault) return units;

  const incomingDefaultIndex = units.findIndex((unit) => unit.isDefault === true);
  const index = incomingDefaultIndex === -1 ? 0 : incomingDefaultIndex;
  const incomingDefault = units[index];
  if (!incomingDefault) return units;

  const unitUntouched = UNIT_PRICE_FIELDS.every((field) => samePrice(incomingDefault[field], storedDefault[field]));
  if (!unitUntouched) return units;

  const overrides = {};
  for (const [productField, unitField] of Object.entries(PRODUCT_TO_UNIT_PRICE)) {
    const value = incomingProduct[productField];
    if (value === undefined) continue;
    if (samePrice(value, storedDefault[unitField])) continue;
    overrides[unitField] = Number(value);
  }
  if (!Object.keys(overrides).length) return units;

  const next = [...units];
  next[index] = { ...incomingDefault, ...overrides };
  return next;
}

/**
 * A product's default selling unit is derived from the product's own price
 * fields (see legacySellingUnit). Billing then reads its ceiling and cost from
 * that unit, not from the product row — so an edit that changes price/MRP/cost
 * without sending sellingUnits has to move the default unit too. Leaving it
 * stale makes the item unsellable at its own new price
 * ("exceeds the configured maximum of Rs <old MRP>"), and prices it against a
 * stale cost. Only the default unit mirrors the product; alternate units
 * (pack, dozen, bag) carry their own pricing and are left alone.
 */
async function syncDefaultSellingUnitPricing(tx, shopId, productId, product) {
  const unit = await tx.productSellingUnit.findFirst({
    where: { shopId, productId, isDefault: true },
  });
  if (!unit) return;

  const defaultPrice = Number(product.defaultPricePerRateUnit ?? unit.defaultPrice ?? 0);
  const minimumPrice = Number(product.minPricePerRateUnit ?? 0) || null;
  const maximumPrice = Number(product.mrp ?? 0) || null;
  const costPrice = Number(product.costPerRateUnit ?? 0) || null;

  await tx.productSellingUnit.update({
    where: { id: unit.id },
    data: {
      defaultPrice,
      minimumPrice,
      maximumPrice,
      costPrice,
      ...moneyShadows({ defaultPrice, minimumPrice, maximumPrice, costPrice }),
    },
  });
}

async function writeSellingUnits(tx, shopId, productId, units) {
  const existingUnits = await tx.productSellingUnit.findMany({
    where: { shopId, productId },
    select: { id: true, unitCode: true },
  });
  const incomingCodes = units.map((unit) => unit.unitCode);
  await tx.productSellingUnit.updateMany({
    where: { shopId, productId, unitCode: { notIn: incomingCodes } },
    data: { isDefault: false, isActive: false },
  });
  await tx.productSellingUnit.updateMany({
    where: { shopId, productId, unitCode: { in: incomingCodes } },
    data: { isDefault: false },
  });
  for (const unit of units) {
    const idBelongsToDifferentCode = unit.id && existingUnits.some((existing) => existing.id === unit.id && existing.unitCode !== unit.unitCode);
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
      onHandQty: unit.onHandQty,
      lowStockThreshold: unit.lowStockThreshold,
      reorderLevel: unit.reorderLevel,
      variantValue1: unit.variantValue1,
      variantValue2: unit.variantValue2,
      isDefault: unit.isDefault,
      isActive: unit.isActive,
    };
    await tx.productSellingUnit.upsert({
      where: { shopId_productId_unitCode: { shopId, productId, unitCode: unit.unitCode } },
      update: data,
      create: { ...(unit.id && !idBelongsToDifferentCode ? { id: unit.id } : {}), shopId, productId, unitCode: unit.unitCode, ...data },
    });
  }
}
