import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { createAuditLog } from "../audit/audit.service.js";
import { decrementLocationInventory, incrementLocationInventory, resolveOperationalLocation } from "../stores/location-context.service.js";

/**
 * Breaking bulk: one 50 kg sack becomes fifty 1 kg packets. The sack and the
 * packet are two packagings of the SAME product, so base quantity is conserved and
 * the only thing that changes is which pack holds it — plus whatever is spilled,
 * which has to be declared rather than absorbed.
 *
 * Pure so the arithmetic can be tested without a database, and because getting the
 * conversion wrong is the whole risk here: a repack that produced a fractional
 * packet would put a count on the books that cannot exist on a shelf.
 */
export function planRepack({ fromUnit, toUnit, fromQuantity, wastageBaseQty = 0 }) {
  const quantity = round2(Number(fromQuantity));
  const fromConversion = round2(Number(fromUnit?.conversionToBase));
  const toConversion = round2(Number(toUnit?.conversionToBase));
  const wastage = round2(Math.max(0, Number(wastageBaseQty) || 0));

  const consumedBaseQty = round2(quantity * fromConversion);
  const producedBaseQty = round2(consumedBaseQty - wastage);
  const wholeUnits = Math.floor(round2(producedBaseQty / toConversion));
  const remainderBaseQty = round2(producedBaseQty - wholeUnits * toConversion);

  return {
    fromQuantity: quantity,
    fromConversionToBase: fromConversion,
    toConversionToBase: toConversion,
    consumedBaseQty,
    wastageBaseQty: wastage,
    producedBaseQty,
    producedUnits: wholeUnits,
    remainderBaseQty,
    // A leftover that is neither packed nor declared as waste would quietly vanish
    // from the pack counts while staying in the pooled total, so it is refused.
    exact: remainderBaseQty < 0.005 && wholeUnits > 0 && producedBaseQty > 0,
  };
}

export async function recordRepack(shopId, data, identity = {}) {
  const { productId, fromSellingUnitId, toSellingUnitId } = data;
  if (fromSellingUnitId === toSellingUnitId) {
    throw new AppError("Choose two different packagings to repack between", 422, "REPACK_SAME_PACKAGING");
  }

  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null } });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  // A pooled product has one shared pool and its packagings are pure conversions,
  // so there is nothing to move between them — the repack would be a no-op that
  // still wrote two ledger rows implying stock had moved.
  if (product.packagingMode !== "per_pack") {
    throw new AppError(`"${product.name}" uses one shared stock pool, so its packagings hold no separate stock to repack`, 422, "REPACK_REQUIRES_PER_PACK");
  }

  const units = await db.productSellingUnit.findMany({ where: { shopId, productId, id: { in: [fromSellingUnitId, toSellingUnitId] } } });
  const fromUnit = units.find((unit) => unit.id === fromSellingUnitId);
  const toUnit = units.find((unit) => unit.id === toSellingUnitId);
  if (!fromUnit || !toUnit) throw new AppError("Packaging not found for this product", 404, "REPACK_PACKAGING_NOT_FOUND");
  if (!(Number(fromUnit.conversionToBase) > 0) || !(Number(toUnit.conversionToBase) > 0)) {
    throw new AppError("Both packagings need a conversion to the base unit before repacking", 422, "REPACK_CONVERSION_MISSING");
  }

  const plan = planRepack({ fromUnit, toUnit, fromQuantity: data.quantity, wastageBaseQty: data.wastageBaseQty });
  if (!(plan.consumedBaseQty > 0)) throw new AppError("Repack quantity must be greater than zero", 422, "REPACK_QTY_INVALID");
  if (plan.wastageBaseQty >= plan.consumedBaseQty) {
    throw new AppError("Declared wastage cannot be the whole quantity being repacked", 422, "REPACK_WASTAGE_TOO_LARGE");
  }
  if (!plan.exact) {
    const error = new AppError(
      `${plan.consumedBaseQty} ${product.baseUnit} does not divide into whole ${toUnit.name} — ${plan.remainderBaseQty} ${product.baseUnit} would be left over. Adjust the quantity or declare the remainder as wastage.`,
      422,
      "REPACK_NOT_WHOLE_UNITS",
    );
    error.publicData = { plan };
    throw error;
  }

  const location = await resolveOperationalLocation(shopId, data.locationId ?? null);
  const idempotencyKey = data.idempotencyKey || null;

  const result = await db.$transaction(async (tx) => {
    // Consume the bulk pack, then create the retail packs. Base quantity is
    // conserved apart from declared wastage, so the product total moves by exactly
    // -wastage and never by the repacked amount itself.
    const consumed = await decrementLocationInventory(tx, {
      shopId, location, product,
      quantityBase: plan.consumedBaseQty,
      packs: new Map([[fromUnit.id, { sellingUnit: fromUnit, qty: plan.fromQuantity }]]),
    });
    const produced = await incrementLocationInventory(tx, {
      shopId, location, product,
      quantityBase: plan.producedBaseQty,
      packs: new Map([[toUnit.id, { sellingUnit: toUnit, qty: plan.producedUnits }]]),
    });

    await tx.stockLedger.create({
      data: {
        shopId, locationId: location.id, productId, productName: product.name,
        action: "repack_out",
        changeBaseQty: -plan.consumedBaseQty,
        oldStockBaseQty: consumed.oldStock,
        newStockBaseQty: consumed.newStock,
        sellingUnitId: fromUnit.id,
        sellingUnitQty: plan.fromQuantity,
        note: data.note || `Repacked ${plan.fromQuantity} × ${fromUnit.name} into ${toUnit.name}`,
        ...(idempotencyKey && { idempotencyKey: `${idempotencyKey}:out`, sourceType: "repack", sourceId: productId }),
      },
    });
    await tx.stockLedger.create({
      data: {
        shopId, locationId: location.id, productId, productName: product.name,
        action: "repack_in",
        changeBaseQty: plan.producedBaseQty,
        oldStockBaseQty: produced.oldStock,
        newStockBaseQty: produced.newStock,
        sellingUnitId: toUnit.id,
        sellingUnitQty: plan.producedUnits,
        note: data.note || `Repacked from ${fromUnit.name}`,
        ...(idempotencyKey && { idempotencyKey: `${idempotencyKey}:in`, sourceType: "repack", sourceId: productId }),
      },
    });

    const fresh = await tx.product.findFirst({ where: { id: productId, shopId }, select: { stockBaseQty: true } });
    return { consumed, produced, globalStockBaseQty: round2(Number(fresh?.stockBaseQty ?? 0)) };
  });

  await createAuditLog({
    shopId, userId: identity.userId ?? null, deviceId: identity.deviceId, module: "inventory",
    action: "STOCK_REPACKED", entityType: "Product", entityId: productId,
    after: {
      locationId: location.id,
      fromSellingUnitId, toSellingUnitId,
      fromQuantity: plan.fromQuantity, producedUnits: plan.producedUnits,
      consumedBaseQty: plan.consumedBaseQty, producedBaseQty: plan.producedBaseQty, wastageBaseQty: plan.wastageBaseQty,
    },
    req: identity.req ?? null,
  });

  return {
    productId,
    productName: product.name,
    baseUnit: product.baseUnit,
    location: { id: location.id, name: location.name },
    from: { sellingUnitId: fromUnit.id, name: fromUnit.name, quantity: plan.fromQuantity },
    to: { sellingUnitId: toUnit.id, name: toUnit.name, quantity: plan.producedUnits },
    consumedBaseQty: plan.consumedBaseQty,
    producedBaseQty: plan.producedBaseQty,
    wastageBaseQty: plan.wastageBaseQty,
    globalStockBaseQty: result.globalStockBaseQty,
  };
}
