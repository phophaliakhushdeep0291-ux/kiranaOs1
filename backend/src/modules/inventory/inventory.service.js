import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, multiplyMoney, round2, weightedAvgCost } from "../../utils/money.js";
import { toBaseQty, rateUnitToBase } from "../../utils/units.js";
import { rangeEndInclusive, rangeStart } from "../../utils/dateRange.js";
import {
  decrementLocationInventory,
  getLocationQuantity,
  incrementLocationInventory,
  resolveOperationalLocation,
  setLocationInventory,
} from "../stores/location-context.service.js";

// Operation-level idempotency for replayed offline stock adjustments. The StockLedger row
// carries a durable idempotencyKey (unique per shop), so a retried/replayed ADJUST_STOCK
// — e.g. an event that committed but failed to mark SYNCED and then re-ran — returns the
// prior result instead of mutating stock a second time. The online HTTP path passes no
// identity, so the fast-path is skipped and behaviour is unchanged.
function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

function stockAdjustmentReplay(existing) {
  return {
    productId: existing.productId,
    productName: existing.productName,
    oldStock: existing.oldStockBaseQty,
    newStock: existing.newStockBaseQty,
    oldStockBaseQty: existing.oldStockBaseQty,
    newStockBaseQty: existing.newStockBaseQty,
    changeBaseQty: existing.changeBaseQty,
    note: existing.note,
    idempotentReplay: true,
  };
}

// A replayed purchase converges on the StockLedger row written the first time. Skipping the
// whole operation also avoids a duplicate PurchaseHistory row (which would double the supplier
// due) and a second weighted-average cost recalculation. newCost is read from the product as it
// stands after the original purchase.
async function purchaseReplay(client, shopId, existing) {
  const product = await client.product.findFirst({ where: { id: existing.productId, shopId } });
  return {
    productId: existing.productId,
    qtyAdded: existing.changeBaseQty,
    newStock: existing.newStockBaseQty,
    newCost: product?.costPerRateUnit ?? null,
    pricePerRateUnit: existing.calculatedBuyRate,
    stockLedgerId: existing.id,
    purchaseHistoryId: null,
    invoiceNumber: existing.invoiceNumber ?? null,
    purchaseBillNo: existing.invoiceNumber ?? null,
    supplierBillNo: existing.invoiceNumber ?? null,
    purchasePaymentStatus: existing.purchasePaymentStatus ?? null,
    purchasePaymentMode: existing.purchasePaymentMode ?? null,
    purchasePaidAmount: existing.purchasePaidAmount ?? null,
    purchaseDueAmount: existing.purchaseDueAmount ?? null,
    purchaseDueDate: existing.purchaseDueDate ? existing.purchaseDueDate.toISOString().slice(0, 10) : null,
    idempotentReplay: true,
  };
}

export async function getInventory(shopId, requestedLocationId = null) {
  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const products = await db.product.findMany({
    where: { shopId, deletedAt: null },
    orderBy: { name: "asc" },
    include: { sellingUnits: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] } },
  });
  return Promise.all(products.map(async (p) => {
    const stockBaseQty = await getLocationQuantity(db, shopId, location, p);
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      brand: p.brand,
      barcode: p.barcode,
      sku: p.sku,
      aliases: JSON.parse(p.aliasesJson ?? "[]"),
      imageUrl: p.imageUrl,
      stockBaseQty,
      locationId: location.id,
      locationName: location.name,
      unit: p.rateUnit,
      baseUnit: p.baseUnit,
      displayUnit: p.displayUnit,
      rateUnit: p.rateUnit,
      sellingUnits: p.sellingUnits,
      costPerRateUnit: p.costPerRateUnit,
      costPrice: p.costPerRateUnit,
      averageCostPrice: p.costPerRateUnit,
      minPricePerRateUnit: p.minPricePerRateUnit,
      minimumSellingPrice: p.minPricePerRateUnit,
      defaultPricePerRateUnit: p.defaultPricePerRateUnit,
      sellingPrice: p.defaultPricePerRateUnit,
      mrp: p.mrp,
      gstRate: p.gstRate,
      hsn: p.hsn,
      reorderLevel: p.reorderLevel,
      description: p.description,
      isLooseItem: p.isLooseItem,
      batchTrackingEnabled: p.batchTrackingEnabled,
      lowStockThreshold: p.lowStockThreshold,
      stockTrackingEnabled: true,
      trackStock: true,
      isLowStock: p.lowStockThreshold > 0 && stockBaseQty <= p.lowStockThreshold,
    };
  }));
}

export async function getLowStock(shopId, requestedLocationId = null) {
  const all = await getInventory(shopId, requestedLocationId);
  return all.filter((p) => p.isLowStock);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizePaymentMode(mode, paidAmount) {
  if (paidAmount <= 0) return null;
  const normalized = String(mode || "cash").toLowerCase();
  // Parity with the sync replay path: bank is a first-class tender, card folds into bank.
  return normalized === "card" ? "bank" : normalized;
}

function parsePurchaseDueDate(value, dueAmount) {
  if (dueAmount <= 0 || !value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizePurchasePayment(data) {
  const invoiceNumber = firstText(data.invoiceNumber, data.purchaseBillNo, data.supplierBillNo);
  const explicitPaid = data.purchasePaidAmount;
  const explicitDue = data.purchaseDueAmount;
  const status = data.purchasePaymentStatus ||
    (explicitDue > 0 ? (explicitPaid > 0 ? "partial" : "due") : "paid");
  const purchasePaidAmount = round2(explicitPaid ?? (
    status === "due" ? 0 :
      explicitDue !== undefined ? Math.max(0, data.billAmount - explicitDue) :
        data.billAmount
  ));
  const purchaseDueAmount = round2(explicitDue ?? Math.max(0, data.billAmount - purchasePaidAmount));
  const purchasePaymentStatus = purchaseDueAmount <= 0 ? "paid" : purchasePaidAmount > 0 ? "partial" : "due";
  const purchasePaymentMode = normalizePaymentMode(data.purchasePaymentMode, purchasePaidAmount);
  const purchaseDueDate = parsePurchaseDueDate(data.purchaseDueDate, purchaseDueAmount);

  return {
    invoiceNumber,
    purchasePaymentStatus,
    purchasePaymentMode,
    purchasePaidAmount,
    purchaseDueAmount,
    purchaseDueDate,
  };
}

function sameReplayNumber(actual, expected) {
  if (expected === undefined) return true;
  return Math.abs(Number(actual ?? 0) - Number(expected)) <= 0.000001;
}

function assertCompatibleInventoryReplay(existing, expected) {
  const mismatch =
    existing.action !== expected.action ||
    existing.productId !== expected.productId ||
    (expected.locationId !== undefined && existing.locationId !== expected.locationId) ||
    !sameReplayNumber(existing.changeBaseQty, expected.changeBaseQty) ||
    !sameReplayNumber(existing.newStockBaseQty, expected.newStockBaseQty) ||
    !sameReplayNumber(existing.purchaseBillAmount, expected.purchaseBillAmount) ||
    !sameReplayNumber(existing.purchasePaidAmount, expected.purchasePaidAmount) ||
    !sameReplayNumber(existing.purchaseDueAmount, expected.purchaseDueAmount) ||
    (expected.purchasePaymentMode !== undefined &&
      (existing.purchasePaymentMode ?? null) !== (expected.purchasePaymentMode ?? null));

  if (mismatch) {
    throw new AppError(
      "Idempotency key was already used for a different inventory movement",
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
}

async function replayQuantityInBase(client, shopId, productId, quantity, enteredUnit) {
  const product = await client.product.findFirst({ where: { id: productId, shopId } });
  return product ? toBaseQty(quantity, enteredUnit, product.baseUnit) : undefined;
}

async function assertCompatiblePurchaseReplay(client, shopId, existing, data, locationId) {
  const purchasePayment = normalizePurchasePayment(data);
  assertCompatibleInventoryReplay(existing, {
    action: "purchase",
    productId: data.productId,
    locationId,
    changeBaseQty: await replayQuantityInBase(
      client,
      shopId,
      data.productId,
      data.quantity,
      data.enteredUnit
    ),
    purchaseBillAmount: data.billAmount,
    purchasePaidAmount: purchasePayment.purchasePaidAmount,
    purchaseDueAmount: purchasePayment.purchaseDueAmount,
    purchasePaymentMode: purchasePayment.purchasePaymentMode,
  });
}

async function assertCompatibleDamageReplay(client, shopId, existing, data, locationId) {
  const quantityInBase = await replayQuantityInBase(
    client,
    shopId,
    data.productId,
    data.quantity,
    data.enteredUnit
  );
  assertCompatibleInventoryReplay(existing, {
    action: "damage",
    productId: data.productId,
    locationId,
    changeBaseQty: quantityInBase === undefined ? undefined : -quantityInBase,
  });
}

export async function recordPurchase(shopId, data, identity = {}, client = db) {
  const {
    productId, supplierId, supplierName,
    quantity, enteredUnit, billAmount,
    note, updateCost, updateMinPrice,
  } = data;
  const { idempotencyKey = null, clientMovementId = null, sourceDeviceId = null } = identity;

  const execute = async (tx) => {
    const location = await resolveOperationalLocation(shopId, data.locationId ?? identity.locationId ?? null, tx);
    if (idempotencyKey) {
      const existing = await tx.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) {
        await assertCompatiblePurchaseReplay(tx, shopId, existing, data, location.id);
        return purchaseReplay(tx, shopId, existing);
      }
    }

    const product = await tx.product.findFirst({
      where: { id: productId, shopId, deletedAt: null },
    });
    if (!product) throw new AppError("Product not found", 404);

    // Receiving against a specific packaging ("12 boxes of the 8-pack"): `quantity`
    // counts that pack, so the base quantity comes from the pack's own conversion.
    // Resolved against this product so a stale or mistyped id cannot post stock
    // onto another product's packaging.
    const receivedSellingUnit = data.sellingUnitId
      ? await tx.productSellingUnit.findFirst({ where: { id: data.sellingUnitId, shopId, productId: product.id } })
      : null;
    if (data.sellingUnitId && !receivedSellingUnit) {
      throw new AppError("That packaging does not belong to this product", 400, "SELLING_UNIT_PRODUCT_MISMATCH");
    }

    const qtyInBase = receivedSellingUnit
      ? round2(quantity * Number(receivedSellingUnit.conversionToBase))
      : toBaseQty(quantity, enteredUnit, product.baseUnit);
    const factor = Number(data.conversionToBase ?? data.conversion_to_base ?? 0) > 0
      ? Number(data.conversionToBase ?? data.conversion_to_base)
      : rateUnitToBase(product.rateUnit, product.baseUnit);
    const qtyInRateUnit = qtyInBase / factor;
    const pricePerRateUnit = round2(billAmount / qtyInRateUnit);
    const totalCost = multiplyMoney(pricePerRateUnit, qtyInRateUnit);
    const purchasePayment = normalizePurchasePayment(data);
    const purchasePaymentShadows = moneyShadows({
      purchasePaidAmount: purchasePayment.purchasePaidAmount,
      purchaseDueAmount: purchasePayment.purchaseDueAmount,
    });
    const newCost = weightedAvgCost(
      product.stockBaseQty, product.costPerRateUnit,
      qtyInBase, pricePerRateUnit
    );

    const stockResult = await incrementLocationInventory(tx, {
      shopId,
      location,
      product,
      quantityBase: qtyInBase,
      expectedGlobalStockBaseQty: product.stockBaseQty,
      productData: {
        ...(updateCost && { costPerRateUnit: newCost, ...moneyShadows({ costPerRateUnit: newCost }) }),
        ...(updateMinPrice && { minPricePerRateUnit: pricePerRateUnit, ...moneyShadows({ minPricePerRateUnit: pricePerRateUnit }) }),
      },
      packs: receivedSellingUnit
        ? new Map([[receivedSellingUnit.id, { sellingUnit: receivedSellingUnit, qty: round2(quantity) }]])
        : null,
    });

    // The purchase row is written FIRST so the stock movement can point at it.
    // sourceId must identify the SOURCE DOCUMENT (same convention as
    // sourceType "purchase_receipt" -> receipt.id). It previously held the productId,
    // which matched nothing: the assurance context looks for
    // { sourceType: "purchase", sourceId: history.id }, and its fallback arm only
    // accepts sourceId === null — so every purchase looked like it moved no stock and
    // raised a false HIGH "Purchase did not increase stock" finding.
    const purchaseHistory = await tx.purchaseHistory.create({
      data: {
        shopId, locationId: location.id, productId,
        supplierId: supplierId ?? null,
        supplierName,
        qtyBase: qtyInBase,
        pricePerRateUnit,
        totalCost,
        billAmount,
        ...purchasePayment,
        ...moneyShadows({ pricePerRateUnit, totalCost, billAmount }),
        ...purchasePaymentShadows,
        note: note ?? "",
      },
    });

    const stockLedger = await tx.stockLedger.create({
      data: {
        shopId, locationId: location.id, productId,
        productName: product.name,
        action: "purchase",
        changeBaseQty: qtyInBase,
        oldStockBaseQty: stockResult.oldStock,
        newStockBaseQty: stockResult.newStock,
        // Which packaging this receipt was counted in, so a per-size history can be
        // reconstructed later without re-deriving it from base units (which cannot
        // distinguish 8 single packets from one 8-pack).
        sellingUnitId: receivedSellingUnit?.id ?? null,
        sellingUnitQty: receivedSellingUnit ? round2(quantity) : null,
        purchaseBillAmount: billAmount,
        calculatedBuyRate: pricePerRateUnit,
        ...purchasePayment,
        ...moneyShadows({ purchaseBillAmount: billAmount, calculatedBuyRate: pricePerRateUnit }),
        ...purchasePaymentShadows,
        supplierName,
        note: note ?? "",
        idempotencyKey,
        clientMovementId,
        sourceDeviceId,
        sourceType: idempotencyKey ? "purchase" : null,
        sourceId: idempotencyKey ? purchaseHistory.id : null,
      },
    });

    return {
      productId,
      qtyAdded: qtyInBase,
      newStock: stockResult.newStock,
      locationId: location.id,
      newCost,
      pricePerRateUnit,
      stockLedgerId: stockLedger.id,
      purchaseHistoryId: purchaseHistory.id,
      invoiceNumber: purchasePayment.invoiceNumber,
      purchaseBillNo: purchasePayment.invoiceNumber,
      supplierBillNo: purchasePayment.invoiceNumber,
      purchasePaymentStatus: purchasePayment.purchasePaymentStatus,
      purchasePaymentMode: purchasePayment.purchasePaymentMode,
      purchasePaidAmount: purchasePayment.purchasePaidAmount,
      purchaseDueAmount: purchasePayment.purchaseDueAmount,
      purchaseDueDate: purchasePayment.purchaseDueDate?.toISOString?.().slice(0, 10) ?? null,
    };
  };
  try {
    return client === db ? await db.$transaction(execute) : await execute(client);
  } catch (error) {
    if (isUniqueConstraintError(error) && idempotencyKey) {
      const existing = await db.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) {
        await assertCompatiblePurchaseReplay(
          db,
          shopId,
          existing,
          data,
          data.locationId ?? identity.locationId ?? existing.locationId
        );
        return purchaseReplay(db, shopId, existing);
      }
    }
    throw error;
  }
}

export async function recordDamage(shopId, data, identity = {}) {
  const { productId, quantity, enteredUnit, note, locationId } = data;
  const { idempotencyKey = null, clientMovementId = null, sourceDeviceId = null } = identity;
  try {
    return await db.$transaction(async (tx) => {
      const location = await resolveOperationalLocation(shopId, locationId ?? identity.locationId ?? null, tx);
      if (idempotencyKey) {
        const existing = await tx.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
        if (existing) {
          await assertCompatibleDamageReplay(tx, shopId, existing, data, location.id);
          return stockAdjustmentReplay(existing);
        }
      }

      const product = await tx.product.findFirst({
        where: { id: productId, shopId, deletedAt: null },
      });
      if (!product) throw new AppError("Product not found", 404);

      const qtyInBase = toBaseQty(quantity, enteredUnit, product.baseUnit);
      const factor = Number(data.conversionToBase ?? data.conversion_to_base ?? 0) > 0
        ? Number(data.conversionToBase ?? data.conversion_to_base)
        : rateUnitToBase(product.rateUnit, product.baseUnit);
      const qtyInRateUnit = qtyInBase / factor;
      const damageLossValue = multiplyMoney(product.costPerRateUnit, qtyInRateUnit);

      const stockResult = await decrementLocationInventory(tx, { shopId, location, product, quantityBase: qtyInBase, allowShortfall: false });

      await tx.stockLedger.create({
        data: {
          shopId, locationId: location.id, productId,
          productName: product.name,
          action: "damage",
          changeBaseQty: -qtyInBase,
          oldStockBaseQty: stockResult.oldStock,
          newStockBaseQty: stockResult.newStock,
          damageLossValue,
          ...moneyShadows({ damageLossValue }),
          note: note ?? "Damage/loss",
          idempotencyKey,
          clientMovementId,
          sourceDeviceId,
          sourceType: idempotencyKey ? "adjustment" : null,
          sourceId: idempotencyKey ? productId : null,
        },
      });

      return {
        productId,
        productName: product.name,
        quantity,
        enteredUnit,
        qtyRemoved: qtyInBase,
        changeBaseQty: -qtyInBase,
        locationId: location.id,
        oldStock: stockResult.oldStock,
        newStock: stockResult.newStock,
        oldStockBaseQty: stockResult.oldStock,
        newStockBaseQty: stockResult.newStock,
        damageLossValue,
        note: note ?? "Damage/loss",
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error) && idempotencyKey) {
      const existing = await db.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) {
        await assertCompatibleDamageReplay(
          db,
          shopId,
          existing,
          data,
          locationId ?? identity.locationId ?? existing.locationId
        );
        return stockAdjustmentReplay(existing);
      }
    }
    throw error;
  }
}

export async function correctStock(shopId, { productId, newStockBaseQty, note, locationId }, identity = {}) {
  const { idempotencyKey = null, clientMovementId = null, sourceDeviceId = null } = identity;
  try {
    return await db.$transaction(async (tx) => {
      const location = await resolveOperationalLocation(shopId, locationId ?? identity.locationId ?? null, tx);
      if (idempotencyKey) {
        const existing = await tx.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
        if (existing) {
          assertCompatibleInventoryReplay(existing, {
            action: "correction",
            productId,
            locationId: location.id,
            newStockBaseQty,
          });
          return stockAdjustmentReplay(existing);
        }
      }

      const product = await tx.product.findFirst({
        where: { id: productId, shopId, deletedAt: null },
      });
      if (!product) throw new AppError("Product not found", 404);

      const stockResult = await setLocationInventory(tx, { shopId, location, product, newStockBaseQty });
      const diff = stockResult.difference;

      await tx.stockLedger.create({
        data: {
          shopId, locationId: location.id, productId,
          productName: product.name,
          action: "correction",
          changeBaseQty: diff,
          oldStockBaseQty: stockResult.oldStock,
          newStockBaseQty: stockResult.newStock,
          note: note ?? "Manual stock correction",
          idempotencyKey,
          clientMovementId,
          sourceDeviceId,
          sourceType: idempotencyKey ? "adjustment" : null,
          sourceId: idempotencyKey ? productId : null,
        },
      });

      return {
        productId,
        productName: product.name,
        locationId: location.id,
        oldStock: stockResult.oldStock,
        newStock: stockResult.newStock,
        oldStockBaseQty: stockResult.oldStock,
        newStockBaseQty: stockResult.newStock,
        changeBaseQty: diff,
        diff,
        note: note ?? "Manual stock correction",
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error) && idempotencyKey) {
      const existing = await db.stockLedger.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) {
        assertCompatibleInventoryReplay(existing, {
          action: "correction",
          productId,
          locationId: locationId ?? identity.locationId ?? existing.locationId,
          newStockBaseQty,
        });
        return stockAdjustmentReplay(existing);
      }
    }
    throw error;
  }
}

export async function getLedger(shopId, { productId, action, locationId, from, to, page, limit }) {
  const where = {
    shopId,
    ...(productId && { productId }),
    ...(action && { action }),
    ...(locationId && { locationId }),
    ...(from && to && {
      createdAt: { gte: rangeStart(from), lte: rangeEndInclusive(to) },
    }),
  };

  const [entries, total] = await Promise.all([
    db.stockLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.stockLedger.count({ where }),
  ]);

  return { entries, total, page, limit };
}
