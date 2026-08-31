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
  mergeProductAttributes,
  parseProductAttributes,
  sanitizeProductAttributes,
} from "./product-attributes.js";
import {
  getLocationQuantity,
  resolveOperationalLocation,
  setLocationInventory,
  writeLocationStockRow,
} from "../stores/location-context.service.js";
import { stockLedgerProvenance } from "../inventory/stock-ledger-provenance.js";

async function writeRequiredProductAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Product action was not saved because its audit record could not be stored",
      503,
      "PRODUCT_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

// Product codes form one shop-wide namespace even though legacy storage keeps
// them across Product.barcode, Product.sku and ProductSellingUnit. A scanner
// cannot distinguish those columns, so mutation decisions must be serialized
// across all three or two concurrent writes can make the same scan ambiguous.
const productCodeDecisionLocks = new Map();

async function withProductCodeDecisionLock(shopId, task) {
  const previous = productCodeDecisionLocks.get(shopId) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  productCodeDecisionLocks.set(shopId, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (productCodeDecisionLocks.get(shopId) === current) productCodeDecisionLocks.delete(shopId);
  }
}

async function lockProductCodeNamespace(tx, shopId) {
  if (!/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || "")) return;
  await tx.$queryRawUnsafe('SELECT "id" FROM "Shop" WHERE "id" = $1 FOR UPDATE', shopId);
}

export const SENSITIVE_PRODUCT_FIELDS = Object.freeze([
  "stockBaseQty",
  "costPerRateUnit",
  "minPricePerRateUnit",
  "defaultPricePerRateUnit",
  "retailPricePerRateUnit",
  "retailFromQuantity",
  "wholesalePricePerRateUnit",
  "wholesaleFromQuantity",
  "gstRate",
  "hsn",
  "mrp",
  "barcode",
  "sku",
  "sellingUnits",
  "variantAxes",
  "packagingMode",
  "batchTrackingEnabled",
  "drugSchedule",
  "isActive",
  "status",
]);

function productAuditSnapshot(product) {
  if (!product) return null;
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    stockBaseQty: Number(product.stockBaseQty ?? 0),
    costPerRateUnit: Number(product.costPerRateUnit ?? 0),
    minPricePerRateUnit: Number(product.minPricePerRateUnit ?? 0),
    defaultPricePerRateUnit: Number(product.defaultPricePerRateUnit ?? 0),
    retailPricePerRateUnit: product.retailPricePerRateUnit == null ? null : Number(product.retailPricePerRateUnit),
    retailFromQuantity: Number(product.retailFromQuantity ?? 1),
    wholesalePricePerRateUnit: product.wholesalePricePerRateUnit == null ? null : Number(product.wholesalePricePerRateUnit),
    wholesaleFromQuantity: Number(product.wholesaleFromQuantity ?? 10),
    gstRate: Number(product.gstRate ?? 0),
    hsn: product.hsn ?? null,
    mrp: Number(product.mrp ?? 0),
    barcode: product.barcode ?? null,
    sku: product.sku ?? null,
    packagingMode: product.packagingMode ?? "pooled",
    batchTrackingEnabled: Boolean(product.batchTrackingEnabled),
    drugSchedule: product.drugSchedule ?? null,
    isActive: product.isActive !== false,
    variantAxes: parseVariantAxes(product.variantAxesJson),
    sellingUnits: Array.isArray(product.sellingUnits)
      ? product.sellingUnits.map((unit) => ({
          id: unit.id,
          unitCode: unit.unitCode,
          barcode: unit.barcode ?? null,
          sku: unit.sku ?? null,
          conversionToBase: Number(unit.conversionToBase ?? 0),
          defaultPrice: Number(unit.defaultPrice ?? 0),
          minimumPrice: unit.minimumPrice == null ? null : Number(unit.minimumPrice),
          maximumPrice: unit.maximumPrice == null ? null : Number(unit.maximumPrice),
          costPrice: unit.costPrice == null ? null : Number(unit.costPrice),
          onHandQty: unit.onHandQty == null ? null : Number(unit.onHandQty),
          isDefault: Boolean(unit.isDefault),
          isActive: unit.isActive !== false,
        }))
      : [],
  };
}

function changedFieldsFromInput(data) {
  return Object.keys(data ?? {}).filter((field) => ![
    "baseUpdatedAt",
    "locationId",
    "ownerPin",
    "ownerPinReason",
  ].includes(field));
}

async function applyLocationInventory(shopId, products, locationId) {
  if (!locationId || products.length === 0) return products;
  const location = await resolveOperationalLocation(shopId, locationId);
  const productIds = products.map((product) => product.id);
  const rows = await db.locationStock.findMany({
    // Product-level rows only: this builds a per-product stock figure, and the
    // variant rows in the same table count in their own unit, not base units.
    where: { shopId, productId: { in: productIds }, sellingUnitId: null },
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

/**
 * Where each size physically is: one row per branch, one column per variant.
 *
 * The batched form of getVariantLocationQuantity, and it must stay batched — a
 * 6 × 6 grid across four branches is 144 answers, and asking one at a time would
 * make opening a product a hundred-query page load.
 *
 * The primary location keeps no stored row, exactly as base units work, so its
 * share is the unit's global onHandQty minus everything the branches hold. That
 * keeps one number authoritative instead of two that can disagree.
 */
export async function getVariantStockByLocation(shopId, productId) {
  const product = await db.product.findFirst({
    where: { id: productId, shopId, deletedAt: null },
    include: { sellingUnits: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
  });
  if (!product) throw new AppError("Product not found", 404);

  // Only rows that sit on an axis. A packaging row ("8-pack") is not a variant and
  // has no place in a size grid.
  const variantUnits = product.sellingUnits.filter((unit) => unit.variantValue1 || unit.variantValue2);
  if (variantUnits.length === 0) return { productId, axes: [], locations: [] };

  const [locations, rows] = await Promise.all([
    db.storeLocation.findMany({
      where: { shopId, active: true },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isPrimary: true },
    }),
    db.locationStock.findMany({
      where: { shopId, productId, sellingUnitId: { not: null } },
      select: { locationId: true, sellingUnitId: true, stockBaseQty: true },
    }),
  ]);

  const heldAt = new Map();
  const heldTotal = new Map();
  for (const row of rows) {
    const qty = Number(row.stockBaseQty || 0);
    heldAt.set(`${row.locationId}:${row.sellingUnitId}`, qty);
    heldTotal.set(row.sellingUnitId, (heldTotal.get(row.sellingUnitId) ?? 0) + qty);
  }

  return {
    productId,
    axes: parseVariantAxes(product.variantAxesJson),
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      isPrimary: location.isPrimary,
      units: variantUnits.map((unit) => ({
        sellingUnitId: unit.id,
        unitCode: unit.unitCode,
        name: unit.name,
        variantValue1: unit.variantValue1 ?? null,
        variantValue2: unit.variantValue2 ?? null,
        // In this unit's own counts (4 pairs), never base units — the same basis
        // as onHandQty, which is what it is derived from.
        qty: location.isPrimary
          ? round2(Number(unit.onHandQty ?? 0) - (heldTotal.get(unit.id) ?? 0))
          : round2(heldAt.get(`${location.id}:${unit.id}`) ?? 0),
      })),
    })),
  };
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

export async function createProduct(shopId, data, { identity = null, actor = {}, locationId = null } = {}) {
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

  const { aliases, variantAxes, sellingUnits, attributes, baseUpdatedAt: _baseUpdatedAt, ...rawRest } = data;
  const normalizedUnits = normalizeSellingUnits(rawRest, sellingUnits);
  const rest = applyDefaultSellingUnitToProduct(rawRest, normalizedUnits);
  const resolvedPackagingMode = packagingModeForAxes(variantAxes, rest.packagingMode);
  if (resolvedPackagingMode === "per_pack") {
    const unitTotal = perPackStockTotal(normalizedUnits);
    if (data.stockBaseQty !== undefined && round2(Number(data.stockBaseQty)) !== unitTotal) {
      throw new AppError(
        `Per-pack opening stock totals ${unitTotal} base units, but the product total says ${round2(Number(data.stockBaseQty))}.`,
        409,
        "PACKAGING_STOCK_TOTAL_MISMATCH",
      );
    }
    rest.stockBaseQty = unitTotal;
  }
  try {
    const product = await withProductCodeDecisionLock(shopId, () => db.$transaction(async (tx) => {
      await lockProductCodeNamespace(tx, shopId);
      await assertNoActiveProductNameConflict(shopId, data.name, null, tx);
      await assertProductCodeNamespaceAvailable(shopId, rest, normalizedUnits, null, tx);
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
          attributesJson: JSON.stringify(sanitizeProductAttributes(attributes)),
          // After ...rest on purpose: a variant grid overrides whatever packaging
          // mode was asked for, because pooled variants share one stock number.
          packagingMode: resolvedPackagingMode,
          clientProductId: productIdentity.clientProductId,
          idempotencyKey: productIdentity.idempotencyKey,
          sourceDeviceId: productIdentity.sourceDeviceId,
        },
      });
      await writeSellingUnits(tx, shopId, created.id, normalizedUnits);

      const hydrated = await tx.product.findUnique({
        where: { id: created.id },
        include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
      });

      const openingQty = round2(Number(created.stockBaseQty ?? 0));
      let openingLocation = null;
      if (openingQty !== 0) {
        openingLocation = await resolveOperationalLocation(shopId, locationId, tx);
        if (!openingLocation.isPrimary) {
          await writeLocationStockRow(tx, {
            shopId, locationId: openingLocation.id, productId: created.id, absolute: openingQty,
          });
          if (resolvedPackagingMode === "per_pack") {
            for (const unit of hydrated.sellingUnits.filter((row) => row.isActive !== false && Number(row.onHandQty ?? 0) !== 0)) {
              await writeLocationStockRow(tx, {
                shopId,
                locationId: openingLocation.id,
                productId: created.id,
                sellingUnitId: unit.id,
                // Variant rows are stored in the selling unit's own count, not
                // base units. The product-level row above remains the branch's
                // base-unit total used by ordinary stock reports.
                absolute: round2(Number(unit.onHandQty ?? 0)),
              });
            }
          }
        }
        const commonLedgerData = {
          shopId,
          locationId: openingLocation.id,
          productId: created.id,
          productName: created.name,
          action: "opening_stock",
          sourceDeviceId: actor.deviceId ?? productIdentity.sourceDeviceId ?? null,
          sourceType: "product_create",
          sourceId: created.id,
          ...stockLedgerProvenance(actor),
        };
        if (resolvedPackagingMode === "per_pack") {
          let runningTotal = 0;
          for (const unit of hydrated.sellingUnits.filter((row) => row.isActive !== false && Number(row.onHandQty ?? 0) > 0)) {
            const unitQty = round2(Number(unit.onHandQty ?? 0));
            const baseQty = round2(unitQty * Number(unit.conversionToBase ?? 0));
            const nextTotal = round2(runningTotal + baseQty);
            await tx.stockLedger.create({
              data: {
                ...commonLedgerData,
                sellingUnitId: unit.id,
                sellingUnitQty: unitQty,
                changeBaseQty: baseQty,
                oldStockBaseQty: runningTotal,
                newStockBaseQty: nextTotal,
                idempotencyKey: `product-opening:${created.id}:${unit.id}`,
                note: `Opening pack count for ${unit.unitCode}`,
              },
            });
            runningTotal = nextTotal;
          }
          if (runningTotal !== openingQty) {
            throw new AppError("Per-pack opening movements did not reconcile to the product total", 409, "PACKAGING_STOCK_RECONCILIATION_FAILED");
          }
        } else {
          await tx.stockLedger.create({
            data: {
              ...commonLedgerData,
              changeBaseQty: openingQty,
              oldStockBaseQty: 0,
              newStockBaseQty: openingQty,
              idempotencyKey: `product-opening:${created.id}`,
              note: "Opening stock recorded with product creation",
            },
          });
        }
      }
      const sensitiveFields = changedFieldsFromInput(data).filter((field) => SENSITIVE_PRODUCT_FIELDS.includes(field));
      await writeRequiredProductAudit({
        shopId,
        userId: actor.userId ?? null,
        deviceId: actor.deviceId ?? productIdentity.sourceDeviceId ?? undefined,
        action: sensitiveFields.length ? "PRODUCT_CREATED_WITH_SENSITIVE_FIELDS" : "PRODUCT_CREATED",
        entityType: "Product",
        entityId: created.id,
        before: null,
        after: productAuditSnapshot(hydrated),
        metadata: {
          sensitiveFields,
          openingStockLocationId: openingLocation?.id ?? null,
          offlineSyncEventId: actor.syncEventId ?? null,
          reason: actor.reason ?? null,
        },
        req: actor.req ?? null,
      }, tx);
      return hydrated;
    }, { isolationLevel: "Serializable" }));
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
async function applyStockCorrectionInTransaction(tx, shopId, productId, newStockBaseQty, locationId, actor = {}) {
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
      ...stockLedgerProvenance(actor),
      action: "correction",
      changeBaseQty: stockResult.difference,
      oldStockBaseQty: stockResult.oldStock,
      newStockBaseQty: stockResult.newStock,
      sourceType: "product_edit",
      sourceId: productId,
      note: "Stock set from product edit",
    },
  });
}

export async function updateProduct(shopId, id, data, { actor = {}, locationId = null } = {}) {
  if (data.batchTrackingEnabled) await requireFeatureAccess(shopId, "batch_expiry");
  const existing = await getProduct(shopId, id); // ensures it exists and belongs to shop
  if (data.name) await assertNoActiveProductNameConflict(shopId, data.name, id);

  // Stock is never written by spreading the request body. On-hand quantity is
  // authoritative state that must move through the shared inventory primitive so
  // that a StockLedger row is recorded, LocationStock stays in step, and a
  // concurrent sale cannot be silently overwritten. See docs/STABILIZATION_AUDIT.md
  // P0-3. Bulk edit legitimately sets stock here, so the field is honoured — it is
  // just no longer applied blindly.
  const { aliases, variantAxes, sellingUnits, attributes, baseUpdatedAt, stockBaseQty: requestedStockBaseQty, ...rawRest } = data;
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
  // Merged onto what is stored, never substituted for it. The form only sends the
  // fields of the shop's CURRENT trade, so a replace would wipe every detail a
  // previous trade had recorded the first time anyone re-saved the product. A key
  // set to null or "" is a deliberate clear — see mergeProductAttributes.
  if (attributes != null) {
    updateData.attributesJson = JSON.stringify(mergeProductAttributes(existing.attributesJson, attributes));
  }
  if (variantAxes !== undefined) {
    updateData.variantAxesJson = JSON.stringify(variantAxes);
    // Turning a product into a variant grid must take its packaging mode with it,
    // or the sizes silently share one stock pool. Clearing the grid leaves the
    // mode alone: the per-pack rows are still there and still hold their counts.
    updateData.packagingMode = packagingModeForAxes(variantAxes, rest.packagingMode ?? existing.packagingMode);
  }

  const updated = await withProductCodeDecisionLock(shopId, () => db.$transaction(async (tx) => {
    await lockProductCodeNamespace(tx, shopId);
    const current = await tx.product.findFirst({
      where: { id, shopId, deletedAt: null },
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
    });
    if (!current) throw new AppError("Product not found", 404);
    if (data.name) await assertNoActiveProductNameConflict(shopId, data.name, id, tx);
    await assertProductCodeNamespaceAvailable(
      shopId,
      { ...current, ...rest },
      normalizedUnits ?? current.sellingUnits,
      id,
      tx,
    );
    const targetPackagingMode = updateData.packagingMode ?? current.packagingMode ?? "pooled";
    if (targetPackagingMode !== current.packagingMode && round2(Number(current.stockBaseQty ?? 0)) !== 0) {
      throw new AppError(
        "Count stock to zero before changing how this product tracks pack-level inventory.",
        409,
        "PACKAGING_MODE_STOCK_MIGRATION_REQUIRED",
      );
    }
    const hasNonStockUpdate = Object.values(updateData).some((value) => value !== undefined);
    const changed = hasNonStockUpdate
      ? await tx.product.updateMany({
        where: { id, shopId, deletedAt: null, updatedAt: existing.updatedAt },
        data: updateData,
      })
      : { count: new Date(current.updatedAt).getTime() === new Date(existing.updatedAt).getTime() ? 1 : 0 };
    if (changed.count !== 1) {
      throw new AppError(
        `"${existing.name}" changed while this edit was being saved. Reload and try again.`,
        409,
        "PRODUCT_STALE_WRITE",
      );
    }
    if (normalizedUnits) {
      await writeSellingUnits(tx, shopId, id, normalizedUnits);
      if (targetPackagingMode === "per_pack") {
        await applyPerPackStockEditInTransaction(tx, {
          shopId,
          product: current,
          normalizedUnits,
          requestedStockBaseQty,
          locationId,
          actor,
        });
      } else if (requestedStockBaseQty !== undefined) {
        await applyStockCorrectionInTransaction(tx, shopId, id, requestedStockBaseQty, locationId, actor);
      }
    } else {
      if (requestedStockBaseQty !== undefined) {
        await applyStockCorrectionInTransaction(tx, shopId, id, requestedStockBaseQty, locationId, actor);
      }
      await syncDefaultSellingUnitPricing(tx, shopId, id, { ...existing, ...rest });
    }
    const hydrated = await tx.product.findUnique({
      where: { id },
      include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
    });
    const changedFields = changedFieldsFromInput(data);
    await writeRequiredProductAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: id,
      before: productAuditSnapshot(current),
      after: productAuditSnapshot(hydrated),
      metadata: {
        changedFields,
        sensitiveFields: changedFields.filter((field) => SENSITIVE_PRODUCT_FIELDS.includes(field)),
        locationId,
        offlineSyncEventId: actor.syncEventId ?? null,
        reason: actor.reason ?? null,
      },
      req: actor.req ?? null,
    }, tx);
    return hydrated;
  }, { isolationLevel: "Serializable" }));
  return deserializeProduct(updated);
}

export async function softDeleteProduct(shopId, id, actor = {}) {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id, shopId } });
    if (!product) throw new AppError("Product not found", 404);
    if (product.deletedAt) return deserializeProduct(product);
    const deleted = await tx.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await writeRequiredProductAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "PRODUCT_DELETED",
      entityType: "Product",
      entityId: product.id,
      before: { id: product.id, name: product.name, deletedAt: product.deletedAt },
      after: { id: deleted.id, name: deleted.name, deletedAt: deleted.deletedAt },
      metadata: { softDelete: true, offlineSyncEventId: actor.syncEventId ?? null },
      req: actor.req ?? null,
    }, tx);
    return deserializeProduct(deleted);
  });
}

function perPackStockTotal(units) {
  return round2((units ?? []).reduce((total, unit) => {
    if (unit?.isActive === false) return total;
    return total + Number(unit?.onHandQty ?? 0) * Number(unit?.conversionToBase ?? 0);
  }, 0));
}

async function applyPerPackStockEditInTransaction(tx, {
  shopId,
  product,
  normalizedUnits,
  requestedStockBaseQty,
  locationId,
  actor = {},
}) {
  const desiredTotal = perPackStockTotal(normalizedUnits);
  if (requestedStockBaseQty !== undefined && round2(Number(requestedStockBaseQty)) !== desiredTotal) {
    throw new AppError(
      `Per-pack stock totals ${desiredTotal} base units, but the product total says ${round2(Number(requestedStockBaseQty))}. Recount the pack rows and try again.`,
      409,
      "PACKAGING_STOCK_TOTAL_MISMATCH",
    );
  }

  const previousByCode = new Map((product.sellingUnits ?? []).map((unit) => [unit.unitCode, unit]));
  const incomingByCode = new Map(normalizedUnits.map((unit) => [unit.unitCode, unit]));

  /**
   * Removing a pack that still holds stock writes that stock off.
   *
   * This used to be refused outright (PACKAGING_UNIT_HAS_STOCK): the shopkeeper
   * had to count the pack to zero, save, and only then remove it — two saves and
   * a red error to stop selling a size. The refusal was protecting something
   * real, though: perPackStockTotal is computed from the INCOMING units, so a
   * removed pack silently lowers the product's stock, and without a ledger row
   * that drop has no explanation and reconciliation fails.
   *
   * So the drop is recorded rather than forbidden. A removed or disabled pack
   * becomes an explicit write-off to zero, with its own ledger row naming the
   * pack and the amount, which is what "where did ten litres go?" needs six weeks
   * later. An incoming row marked inactive is treated the same way, since
   * perPackStockTotal already excludes it from the new total.
   */
  const isDroppedFromSale = (previous) => {
    const incoming = incomingByCode.get(previous.unitCode);
    return !incoming || incoming.isActive === false;
  };

  const unitChanges = normalizedUnits.flatMap((unit) => {
    const previous = previousByCode.get(unit.unitCode);
    const oldQty = round2(Number(previous?.onHandQty ?? 0));
    // A row saved as inactive sells nothing, so its new count is zero whatever
    // the payload claims — otherwise it would be counted twice, once here and
    // once as a write-off below.
    const newQty = unit.isActive === false ? 0 : round2(Number(unit.onHandQty ?? 0));
    const deltaQty = round2(newQty - oldQty);
    const oldBaseQty = round2(
      oldQty * Number(previous?.conversionToBase ?? unit.conversionToBase ?? 0),
    );
    const newBaseQty = round2(newQty * Number(unit.conversionToBase ?? 0));
    const baseDelta = round2(newBaseQty - oldBaseQty);
    return deltaQty === 0 && baseDelta === 0
      ? []
      : [{ unit, oldQty, newQty, deltaQty, baseDelta, removed: unit.isActive === false }];
  });

  // Packs the payload dropped entirely: they have no incoming row, so the loop
  // above never sees them.
  for (const previous of product.sellingUnits ?? []) {
    if (previous.isActive === false) continue;
    if (!isDroppedFromSale(previous)) continue;
    if (incomingByCode.has(previous.unitCode)) continue; // handled above as an inactive row
    const oldQty = round2(Number(previous.onHandQty ?? 0));
    if (oldQty === 0) continue;
    const oldBaseQty = round2(oldQty * Number(previous.conversionToBase ?? 0));
    unitChanges.push({
      unit: previous,
      oldQty,
      newQty: 0,
      deltaQty: round2(-oldQty),
      baseDelta: round2(-oldBaseQty),
      removed: true,
    });
  }
  const globalDifference = round2(desiredTotal - Number(product.stockBaseQty ?? 0));
  if (!unitChanges.length && globalDifference === 0) return;

  const location = await resolveOperationalLocation(shopId, locationId, tx);
  const allocatedSecondary = await tx.locationStock.count({
    where: { shopId, productId: product.id, stockBaseQty: { not: 0 } },
  });
  if (!location.isPrimary || allocatedSecondary > 0) {
    throw new AppError(
      "Per-pack stock must be counted per branch. This product already has branch allocation, so use the branch stock-count workflow instead of a global product edit.",
      409,
      "PACKAGING_STOCK_MULTI_LOCATION_UNSUPPORTED",
    );
  }

  const changed = await tx.product.updateMany({
    where: { id: product.id, shopId, deletedAt: null, stockBaseQty: product.stockBaseQty },
    data: { stockBaseQty: desiredTotal },
  });
  if (changed.count !== 1) {
    throw new AppError("Stock changed while saving the per-pack count. Reload and try again.", 409, "CONCURRENT_STOCK_MODIFICATION_RETRY");
  }

  const storedUnits = await tx.productSellingUnit.findMany({
    where: { shopId, productId: product.id },
    select: { id: true, unitCode: true },
  });
  const storedByCode = new Map(storedUnits.map((unit) => [unit.unitCode, unit]));
  let runningTotal = round2(Number(product.stockBaseQty ?? 0));
  for (const change of unitChanges) {
    const stored = storedByCode.get(change.unit.unitCode);
    const baseDelta = change.baseDelta;
    const nextTotal = round2(runningTotal + baseDelta);
    await tx.stockLedger.create({
      data: {
        shopId,
        locationId: location.id,
        productId: product.id,
        productName: product.name,
        ...stockLedgerProvenance(actor),
        sellingUnitId: stored?.id ?? null,
        sellingUnitQty: change.deltaQty,
        action: "correction",
        changeBaseQty: baseDelta,
        oldStockBaseQty: runningTotal,
        newStockBaseQty: nextTotal,
        sourceType: "product_per_pack_edit",
        sourceId: product.id,
        note: change.removed
          ? `Pack ${change.unit.unitCode} removed from sale; ${change.oldQty} written off`
          : `Pack count changed from ${change.oldQty} to ${change.newQty} for ${change.unit.unitCode}`,
      },
    });
    runningTotal = nextTotal;
  }
  if (runningTotal !== desiredTotal) {
    throw new AppError("Per-pack stock movements did not reconcile to the product total", 409, "PACKAGING_STOCK_RECONCILIATION_FAILED");
  }
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

export async function restoreDeletedProduct(shopId, id, actor = {}) {
  return db.$transaction(async (tx) => {
    const deletedProduct = await tx.product.findFirst({ where: { id, shopId } });
    if (!deletedProduct) throw new AppError("Product not found", 404);
    if (!deletedProduct.deletedAt) return deserializeProduct(deletedProduct);
    const activeProducts = await tx.product.findMany({
      where: { shopId, deletedAt: null },
      select: { id: true, name: true, category: true, deletedAt: true },
    });
    if (hasActiveDuplicateProductName(deletedProduct, activeProducts)) {
      throw new AppError(
        `Cannot restore product because an active product named "${deletedProduct.name}" already exists`,
        409
      );
    }
    const restored = await tx.product.update({
      where: { id },
      data: { deletedAt: null },
    });
    await writeRequiredProductAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "PRODUCT_RESTORED",
      entityType: "Product",
      entityId: deletedProduct.id,
      before: { id: deletedProduct.id, name: deletedProduct.name, deletedAt: deletedProduct.deletedAt },
      after: { id: restored.id, name: restored.name, deletedAt: restored.deletedAt },
      metadata: { name: restored.name, category: restored.category, offlineSyncEventId: actor.syncEventId ?? null },
      req: actor.req ?? null,
    }, tx);
    return deserializeProduct(restored);
  });
}

export async function permanentlyDeleteProduct(shopId, id, actor = {}) {
  let deletedProduct;
  await db.$transaction(async (tx) => {
    deletedProduct = await getDeletedProduct(shopId, id, tx);
    const blockReason = await getPermanentDeleteBlockReason(id, tx);
    if (blockReason) {
      throw new AppError(
        `${blockReason}. Keep this product in recycle bin to preserve audit/history records.`,
        409
      );
    }
    // Bill items keep their own name/rate/cost snapshots, so the product link can
    // safely be removed before hard-deleting the product master record.
    await tx.billItem.updateMany({
      where: { productId: id },
      data: { productId: null },
    });

    await tx.product.delete({
      where: { id: deletedProduct.id },
    });
    await writeRequiredProductAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "PRODUCT_PERMANENTLY_DELETED",
      entityType: "Product",
      entityId: deletedProduct.id,
      before: { id: deletedProduct.id, name: deletedProduct.name, category: deletedProduct.category, deletedAt: deletedProduct.deletedAt },
      metadata: { name: deletedProduct.name, category: deletedProduct.category, hardDelete: true },
      req: actor.req ?? null,
    }, tx);
  });

  return {
    id: deletedProduct.id,
    name: deletedProduct.name,
    category: deletedProduct.category,
    deletedAt: deletedProduct.deletedAt,
  };
}

export async function emptyProductRecycleBin(shopId, actor = {}) {
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
    await writeRequiredProductAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "PRODUCT_RECYCLE_BIN_EMPTIED",
      entityType: "Product",
      metadata: {
        deletedCount: deleted.length,
        blockedCount: blocked.length,
        deleted,
        blocked,
      },
      req: actor.req ?? null,
    }, tx);
  });

  return {
    deletedCount: deleted.length,
    blockedCount: blocked.length,
    deleted,
    blocked,
  };
}

async function assertNoActiveProductNameConflict(shopId, name, excludeId = null, client = db) {
  const normalizedName = normalizeProductName(name);
  if (!normalizedName) return;

  const activeProducts = await client.product.findMany({
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

function normalizedScanCode(value) {
  return compactText(value)?.toLocaleLowerCase("en-US") ?? "";
}

function productCodeAssignments(product, sellingUnits = []) {
  const assignments = [];
  const add = (value, ownerKey, label) => {
    const code = compactText(value);
    if (code) assignments.push({ code, normalized: normalizedScanCode(code), ownerKey, label });
  };
  add(product?.barcode, "default", "product barcode");
  add(product?.sku, "default", "product SKU");
  for (const [index, unit] of (sellingUnits ?? []).entries()) {
    const ownerKey = unit?.isDefault ? "default" : `unit:${unit?.unitCode || index}`;
    const label = unit?.isDefault ? "default selling unit" : `${unit?.unitCode || unit?.name || `pack ${index + 1}`} pack`;
    add(unit?.barcode, ownerKey, `${label} barcode`);
    add(unit?.sku, ownerKey, `${label} SKU`);
  }
  return assignments;
}

function duplicateProductCodeError(code, message, details = {}) {
  const error = new AppError(message, 409, "PRODUCT_BARCODE_DUPLICATE");
  error.code = "PRODUCT_BARCODE_DUPLICATE";
  error.details = details;
  return error;
}

/**
 * Refuse a code that would make any scanner lookup ambiguous.
 *
 * The namespace spans product barcode/SKU plus every pack barcode/SKU. Comparisons are
 * case-insensitive because the till normalizes scans the same way. Soft-deleted products
 * and inactive packs keep their codes reserved so restoring them stays safe.
 */
async function assertProductCodeNamespaceAvailable(shopId, product, sellingUnits, excludeProductId = null, client = db) {
  const requested = productCodeAssignments(product, sellingUnits);
  const requestedByCode = new Map();
  for (const assignment of requested) {
    const previous = requestedByCode.get(assignment.normalized);
    if (previous && previous.ownerKey !== assignment.ownerKey) {
      throw duplicateProductCodeError(
        assignment.code,
        `Code ${assignment.code} is assigned to both ${previous.label} and ${assignment.label}`,
        { first: previous.label, second: assignment.label },
      );
    }
    if (!previous) requestedByCode.set(assignment.normalized, assignment);
  }
  if (requestedByCode.size === 0) return;

  // Keep operations on an interactive transaction strictly sequential. Prisma's
  // SQLite library engine can batch a Promise.all against the transaction's one
  // connection, panic internally and close the transaction. PostgreSQL gains
  // nothing from parallel reads here either: the shop row is deliberately held
  // until the namespace decision and write finish.
  const products = await client.product.findMany({
    where: { shopId, ...(excludeProductId ? { NOT: { id: excludeProductId } } : {}) },
    select: { id: true, name: true, barcode: true, sku: true, deletedAt: true },
  });
  const units = await client.productSellingUnit.findMany({
    where: { shopId, ...(excludeProductId ? { NOT: { productId: excludeProductId } } : {}) },
    select: { productId: true, unitCode: true, barcode: true, sku: true, product: { select: { name: true } } },
  });

  for (const owner of products) {
    const matched = [owner.barcode, owner.sku]
      .map((value) => ({ raw: compactText(value), normalized: normalizedScanCode(value) }))
      .find(({ normalized }) => normalized && requestedByCode.has(normalized));
    if (!matched) continue;
    const requestedCode = requestedByCode.get(matched.normalized)?.code ?? matched.raw;
    const where = owner.deletedAt ? " (in the recycle bin)" : "";
    throw duplicateProductCodeError(
      requestedCode,
      `Code ${requestedCode} already belongs to "${owner.name}"${where}`,
      { productId: owner.id, productName: owner.name, inRecycleBin: Boolean(owner.deletedAt) },
    );
  }

  for (const owner of units) {
    const matched = [owner.barcode, owner.sku]
      .map((value) => ({ raw: compactText(value), normalized: normalizedScanCode(value) }))
      .find(({ normalized }) => normalized && requestedByCode.has(normalized));
    if (!matched) continue;
    const requestedCode = requestedByCode.get(matched.normalized)?.code ?? matched.raw;
    throw duplicateProductCodeError(
      requestedCode,
      `Code ${requestedCode} already belongs to the ${owner.unitCode} pack of "${owner.product?.name ?? "another product"}"`,
      { productId: owner.productId, productName: owner.product?.name ?? null, unitCode: owner.unitCode },
    );
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
export async function bindProductBarcode(shopId, productId, barcode, options = {}) {
  const client = options.client ?? db;
  if (client === db) {
    return withProductCodeDecisionLock(shopId, () => db.$transaction(
      (tx) => bindProductBarcodeWithClient(shopId, productId, barcode, { ...options, client: tx }),
      { isolationLevel: "Serializable" },
    ));
  }
  return bindProductBarcodeWithClient(shopId, productId, barcode, { ...options, client });
}

async function bindProductBarcodeWithClient(shopId, productId, barcode, { identity = null, req = null, userId = null, client }) {
  const code = compactText(barcode);
  if (!code) {
    const err = new AppError("A barcode is required", 400);
    err.code = "PRODUCT_BARCODE_REQUIRED";
    throw err;
  }

  await lockProductCodeNamespace(client, shopId);
  const product = await client.product.findFirst({
    where: { id: productId, shopId, deletedAt: null },
    include: { sellingUnits: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
  });
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

  await assertProductCodeNamespaceAvailable(
    shopId,
    { ...product, barcode: code, sku: compactText(product.sku) ?? code },
    product.sellingUnits,
    productId,
    client,
  );

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

  await writeRequiredProductAudit({
    shopId,
    userId,
    req,
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
      offlineSyncEventId: identity?.syncEventId ?? null,
    },
  }, client);

  return deserializeProduct(updated);
}

async function getDeletedProduct(shopId, id, client = db) {
  const product = await client.product.findFirst({
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
    // Keep the legacy aliases while the canonical persisted fields stay explicit.
    // Older products have null tier prices and therefore inherit the default.
    retailPrice: p.retailPricePerRateUnit ?? p.defaultPricePerRateUnit,
    wholesalePrice: p.wholesalePricePerRateUnit ?? p.defaultPricePerRateUnit,
    aliases: JSON.parse(p.aliasesJson ?? "[]"),
    variantAxes: parseVariantAxes(p.variantAxesJson),
    attributes: parseProductAttributes(p.attributesJson),
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

/**
 * The unit a product is already sold in, when it has no explicit rows.
 *
 * Exported because anything ADDING a selling unit to such a product has to send
 * this one along with it. writeSellingUnits retires whatever it is not given,
 * and applyDefaultSellingUnitToProduct copies the default unit's type and price
 * onto the Product — so sending only a new pack silently rewrites rateUnit and
 * defaultPricePerRateUnit to that pack's. Deriving it twice would be the same
 * mistake in two places.
 */
export function legacySellingUnit(product) {
  const unitType = compactText(product.rateUnit) ?? compactText(product.displayUnit) ?? "piece";
  const baseUnit = compactText(product.baseUnit) ?? unitType;
  let conversionToBase = 1;
  if (["kg", "kilogram"].includes(unitType.toLowerCase()) && ["g", "gram"].includes(baseUnit.toLowerCase())) conversionToBase = 1000;
  // "ltr" is what this app actually writes — the AI command schema enumerates it
  // and the voice parsers normalise to it — so leaving it out gave an ltr/ml
  // product a loose unit converting at 1, and selling one litre took 1 ml off
  // the shelf.
  if (["litre", "liter", "ltr", "l"].includes(unitType.toLowerCase()) && baseUnit.toLowerCase() === "ml") conversionToBase = 1000;
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
  // A pack that is no longer sold holds nothing. Its stock has just been written
  // off to the product total and the ledger by applyPerPackStockEditInTransaction,
  // so leaving the count on the row would double it: once on the shelf and once on
  // a row nobody can sell from. Worse, re-enabling the pack later would resurrect
  // stock that was already written off. The write-off arithmetic is unaffected
  // because it reads the product snapshot taken before this call.
  await tx.productSellingUnit.updateMany({
    where: { shopId, productId, unitCode: { notIn: incomingCodes } },
    data: { isDefault: false, isActive: false, onHandQty: 0 },
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
      sku: unit.sku,
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
      // Same reasoning as the retirement above: a row saved inactive is emptied,
      // whatever count the payload still carries for it.
      onHandQty: unit.isActive === false ? 0 : unit.onHandQty,
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
