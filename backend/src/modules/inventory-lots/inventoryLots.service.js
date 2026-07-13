import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, round2 } from "../../utils/money.js";
import { requireFeatureAccess } from "../feature-gates/featureGate.service.js";

function parseDay(value, field) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new AppError(`${field} is invalid`, 422, "INVENTORY_LOT_DATE_INVALID");
  return parsed;
}

export async function listInventoryLots(shopId, { locationId, productId, status = "active", expiringWithinDays, limit = 200 } = {}) {
  const expiryLimit = expiringWithinDays !== undefined ? new Date(Date.now() + Number(expiringWithinDays) * 86_400_000) : null;
  return db.inventoryLot.findMany({
    where: {
      shopId,
      ...(locationId && { locationId }),
      ...(productId && { productId }),
      ...(status !== "all" && { status }),
      ...(expiryLimit && { expiresOn: { lte: expiryLimit } }),
    },
    include: { product: { select: { id: true, name: true, baseUnit: true, rateUnit: true } }, location: { select: { id: true, name: true, code: true } } },
    orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(Number(limit) || 200, 1), 500),
  });
}

export async function setProductBatchTracking(shopId, productId, enabled) {
  await requireFeatureAccess(shopId, "batch_expiry");
  const changed = await db.product.updateMany({ where: { id: productId, shopId, deletedAt: null }, data: { batchTrackingEnabled: Boolean(enabled) } });
  if (changed.count !== 1) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  return db.product.findFirst({ where: { id: productId, shopId } });
}

export async function changeLotStatus(shopId, lotId, status, note) {
  const lot = await db.inventoryLot.findFirst({ where: { id: lotId, shopId } });
  if (!lot) throw new AppError("Inventory batch not found", 404, "INVENTORY_LOT_NOT_FOUND");
  if (!["active", "quarantined", "recalled"].includes(status)) throw new AppError("Invalid batch status", 422, "INVENTORY_LOT_STATUS_INVALID");
  return db.inventoryLot.update({ where: { id: lot.id }, data: { status: status === "active" && lot.availableBaseQty <= 0 ? "depleted" : status, note: note || lot.note } });
}

export async function recordReceiptLot(tx, { shopId, locationId, product, receiptItemId, quantityBaseQty, actualRate, batchNumber, manufacturedOn, expiresOn, note }) {
  if (!product.batchTrackingEnabled && !batchNumber && !expiresOn) return null;
  await requireFeatureAccess(shopId, "batch_expiry");
  if (!product.batchTrackingEnabled) throw new AppError(`${product.name} does not have batch tracking enabled`, 409, "BATCH_TRACKING_NOT_ENABLED");
  if (!batchNumber || !expiresOn) throw new AppError(`${product.name} requires batch number and expiry date`, 422, "BATCH_DETAILS_REQUIRED");
  const expiry = parseDay(expiresOn, "Expiry date");
  const manufactured = parseDay(manufacturedOn, "Manufacturing date");
  if (manufactured && manufactured >= expiry) throw new AppError("Expiry date must be after manufacturing date", 422, "INVENTORY_LOT_DATE_INVALID");
  const quantity = round2(quantityBaseQty);
  const existing = await tx.inventoryLot.findFirst({ where: { shopId, locationId, productId: product.id, batchNumber, expiresOn: expiry } });
  if (existing) {
    return tx.inventoryLot.update({
      where: { id: existing.id },
      data: { receivedBaseQty: { increment: quantity }, availableBaseQty: { increment: quantity }, status: existing.status === "depleted" ? "active" : existing.status, note: note || existing.note },
    });
  }
  return tx.inventoryLot.create({
    data: { shopId, locationId, productId: product.id, purchaseReceiptItemId: receiptItemId, batchNumber, manufacturedOn: manufactured, expiresOn: expiry, receivedBaseQty: quantity, availableBaseQty: quantity, costPerRateUnit: actualRate, ...moneyShadows({ costPerRateUnit: actualRate }), note: note || null },
  });
}

export async function allocateLotsForBill(tx, { shopId, locationId, bill }) {
  const byProduct = new Map();
  for (const item of bill.items ?? []) {
    if (!item.productId) continue;
    const row = byProduct.get(item.productId) ?? { quantity: 0, billItemId: item.id };
    row.quantity = round2(row.quantity + Math.abs(Number(item.quantityInBaseUnit || 0)));
    byProduct.set(item.productId, row);
  }
  const tracked = await tx.product.findMany({ where: { shopId, id: { in: [...byProduct.keys()] }, batchTrackingEnabled: true }, select: { id: true, name: true, baseUnit: true } });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (const product of tracked) {
    const requested = byProduct.get(product.id);
    const lots = await tx.inventoryLot.findMany({ where: { shopId, locationId, productId: product.id, status: "active", availableBaseQty: { gt: 0 }, expiresOn: { gte: today } }, orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }] });
    const available = round2(lots.reduce((sum, lot) => sum + Number(lot.availableBaseQty), 0));
    if (available + 0.000001 < requested.quantity) {
      const error = new AppError(`${product.name} has only ${available} ${product.baseUnit} in saleable, unexpired batches`, 409, "BATCH_STOCK_INSUFFICIENT");
      error.publicData = { productId: product.id, requestedBaseQty: requested.quantity, availableBaseQty: available };
      throw error;
    }
    let remaining = requested.quantity;
    for (const lot of lots) {
      if (remaining <= 0.000001) break;
      const quantity = round2(Math.min(remaining, Number(lot.availableBaseQty)));
      const changed = await tx.inventoryLot.updateMany({ where: { id: lot.id, status: "active", availableBaseQty: { gte: quantity } }, data: { availableBaseQty: { decrement: quantity } } });
      if (changed.count !== 1) throw new AppError("Batch stock changed during checkout; retry", 409, "CONCURRENT_BATCH_STOCK_CHANGE");
      const updated = await tx.inventoryLot.findUnique({ where: { id: lot.id } });
      if (updated.availableBaseQty <= 0.000001) await tx.inventoryLot.update({ where: { id: lot.id }, data: { status: "depleted", availableBaseQty: 0 } });
      await tx.billItemLotAllocation.create({ data: { billItemId: requested.billItemId, inventoryLotId: lot.id, quantityBaseQty: quantity } });
      remaining = round2(remaining - quantity);
    }
  }
}

export async function restoreBillLotAllocations(tx, billId) {
  const allocations = await tx.billItemLotAllocation.findMany({ where: { billItem: { billId }, quantityBaseQty: { gt: 0 } }, include: { inventoryLot: true } });
  for (const allocation of allocations) {
    const status = ["quarantined", "recalled"].includes(allocation.inventoryLot.status) ? allocation.inventoryLot.status : "active";
    await tx.inventoryLot.update({ where: { id: allocation.inventoryLotId }, data: { availableBaseQty: { increment: allocation.quantityBaseQty }, status } });
  }
}

export async function reapplyBillLotAllocations(tx, billId) {
  const allocations = await tx.billItemLotAllocation.findMany({ where: { billItem: { billId }, quantityBaseQty: { gt: 0 } } });
  for (const allocation of allocations) {
    const changed = await tx.inventoryLot.updateMany({ where: { id: allocation.inventoryLotId, status: { in: ["active", "depleted"] }, availableBaseQty: { gte: allocation.quantityBaseQty } }, data: { availableBaseQty: { decrement: allocation.quantityBaseQty } } });
    if (changed.count !== 1) throw new AppError("Original batch stock is no longer available", 409, "BATCH_STOCK_INSUFFICIENT");
    const updated = await tx.inventoryLot.findUnique({ where: { id: allocation.inventoryLotId } });
    if (updated.availableBaseQty <= 0.000001) await tx.inventoryLot.update({ where: { id: updated.id }, data: { status: "depleted", availableBaseQty: 0 } });
  }
}

export async function restoreLotsForSaleReturn(tx, { originalBillId, returnBill }) {
  if (!originalBillId) return;
  const original = await tx.billItemLotAllocation.findMany({ where: { billItem: { billId: originalBillId }, quantityBaseQty: { gt: 0 } }, include: { billItem: true, inventoryLot: true }, orderBy: { createdAt: "asc" } });
  const previousRestores = await tx.billItemLotAllocation.findMany({ where: { billItem: { bill: { returnOfBillId: originalBillId } }, quantityBaseQty: { lt: 0 } } });
  const restoredByLot = new Map();
  for (const row of previousRestores) restoredByLot.set(row.inventoryLotId, round2((restoredByLot.get(row.inventoryLotId) ?? 0) + Math.abs(row.quantityBaseQty)));
  const requestedByProduct = new Map();
  for (const item of returnBill.items ?? []) if (item.productId) requestedByProduct.set(item.productId, { billItemId: item.id, quantity: round2((requestedByProduct.get(item.productId)?.quantity ?? 0) + Math.abs(item.quantityInBaseUnit)) });
  for (const [productId, request] of requestedByProduct.entries()) {
    let remaining = request.quantity;
    for (const allocation of original.filter((row) => row.billItem.productId === productId)) {
      if (remaining <= 0.000001) break;
      const restorable = Math.max(0, round2(allocation.quantityBaseQty - (restoredByLot.get(allocation.inventoryLotId) ?? 0)));
      const quantity = round2(Math.min(remaining, restorable));
      if (quantity <= 0) continue;
      const status = ["quarantined", "recalled"].includes(allocation.inventoryLot.status) ? allocation.inventoryLot.status : "active";
      await tx.inventoryLot.update({ where: { id: allocation.inventoryLotId }, data: { availableBaseQty: { increment: quantity }, status } });
      await tx.billItemLotAllocation.create({ data: { billItemId: request.billItemId, inventoryLotId: allocation.inventoryLotId, quantityBaseQty: -quantity } });
      remaining = round2(remaining - quantity);
    }
  }
}
