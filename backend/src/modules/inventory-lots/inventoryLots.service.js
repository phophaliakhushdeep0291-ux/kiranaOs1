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
  if (status === "active" && lot.expiresOn < new Date()) throw new AppError("An expired batch cannot be released for sale", 409, "BATCH_EXPIRED");
  return db.inventoryLot.update({ where: { id: lot.id }, data: { status: status === "active" && lot.availableBaseQty <= 0 ? "depleted" : status, note: note || lot.note } });
}

export async function recordReceiptLot(tx, { shopId, locationId, product, receiptItemId, quantityBaseQty, actualRate, batchNumber, manufacturedOn, expiresOn, mrp, note }) {
  if (!product.batchTrackingEnabled && !batchNumber && !expiresOn) return null;
  await requireFeatureAccess(shopId, "batch_expiry");
  if (!product.batchTrackingEnabled) throw new AppError(`${product.name} does not have batch tracking enabled`, 409, "BATCH_TRACKING_NOT_ENABLED");
  if (!batchNumber || !expiresOn) throw new AppError(`${product.name} requires batch number and expiry date`, 422, "BATCH_DETAILS_REQUIRED");
  const expiry = parseDay(expiresOn, "Expiry date");
  const manufactured = parseDay(manufacturedOn, "Manufacturing date");
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (expiry < today) throw new AppError("Expired stock cannot be received into saleable inventory", 422, "BATCH_ALREADY_EXPIRED");
  if (manufactured && manufactured >= expiry) throw new AppError("Expiry date must be after manufacturing date", 422, "INVENTORY_LOT_DATE_INVALID");
  const batchMrp = mrp === undefined || mrp === null || mrp === "" ? null : round2(Number(mrp));
  if (batchMrp !== null && !(batchMrp > 0)) throw new AppError("Batch MRP must be greater than zero", 422, "BATCH_MRP_INVALID");
  const quantity = round2(quantityBaseQty);
  const existing = await tx.inventoryLot.findFirst({ where: { shopId, locationId, productId: product.id, batchNumber, expiresOn: expiry } });
  if (existing) {
    // A repeat receipt of the same batch may carry a corrected printed price; an
    // omitted one must not wipe the price already recorded for that batch.
    const mrpUpdate = batchMrp === null ? {} : { mrp: batchMrp, ...moneyShadows({ mrp: batchMrp }) };
    return tx.inventoryLot.update({
      where: { id: existing.id },
      data: { receivedBaseQty: { increment: quantity }, availableBaseQty: { increment: quantity }, status: existing.status === "depleted" ? "active" : existing.status, note: note || existing.note, ...mrpUpdate },
    });
  }
  return tx.inventoryLot.create({
    data: {
      shopId, locationId, productId: product.id, purchaseReceiptItemId: receiptItemId, batchNumber,
      manufacturedOn: manufactured, expiresOn: expiry, receivedBaseQty: quantity, availableBaseQty: quantity,
      costPerRateUnit: actualRate, ...moneyShadows({ costPerRateUnit: actualRate }),
      ...(batchMrp === null ? {} : { mrp: batchMrp, ...moneyShadows({ mrp: batchMrp }) }),
      note: note || null,
    },
  });
}

/**
 * The batches a counter may dispense from right now, newest expiry last.
 *
 * FEFO order, so the batch the till would pick on its own is the first row — a
 * picker that lists them in any other order invites the operator to fight the
 * default for no reason.
 */
export async function listSellableBatches(shopId, { locationId, productId }) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return db.inventoryLot.findMany({
    where: { shopId, locationId, productId, status: "active", availableBaseQty: { gt: 0 }, expiresOn: { gte: today } },
    select: { id: true, batchNumber: true, expiresOn: true, availableBaseQty: true, mrp: true },
    orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }],
    take: 50,
  });
}

/**
 * The MRP each batch-tracked product must be billed under, keyed by productId.
 *
 * Resolved BEFORE pricing and from the same FEFO order the allocation will use,
 * so the ceiling belongs to the stock actually handed over rather than to the
 * product record. Two shapes:
 *
 *   - the operator named a batch  → that batch's printed MRP, full stop;
 *   - nobody named one           → the LOWEST MRP among the batches FEFO would
 *     consume for this quantity, because a line billed at one rate cannot exceed
 *     the cheapest strip it spans.
 *
 * A batch with no printed price of its own contributes no ceiling — those fall
 * back to Product.mrp, which is exactly the pre-batch behaviour.
 */
export async function batchMrpCeilings(tx, { shopId, locationId, requests }) {
  const ceilings = new Map();
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);

  for (const request of requests) {
    const lots = await tx.inventoryLot.findMany({
      where: { shopId, locationId, productId: request.productId, status: "active", availableBaseQty: { gt: 0 }, expiresOn: { gte: today } },
      orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }],
    });

    if (request.inventoryLotId) {
      const chosen = lots.find((lot) => lot.id === request.inventoryLotId);
      if (!chosen) throw new AppError("The selected batch is no longer saleable at this branch", 409, "BATCH_NOT_SELLABLE");
      if (Number(chosen.availableBaseQty) + 0.000001 < request.quantityBaseQty) {
        const error = new AppError(`Batch ${chosen.batchNumber} has only ${chosen.availableBaseQty} left`, 409, "BATCH_STOCK_INSUFFICIENT");
        error.publicData = { productId: request.productId, inventoryLotId: chosen.id, availableBaseQty: Number(chosen.availableBaseQty) };
        throw error;
      }
      if (chosen.mrp > 0) ceilings.set(request.productId, round2(Number(chosen.mrp)));
      continue;
    }

    let remaining = request.quantityBaseQty;
    let lowest = 0;
    for (const lot of lots) {
      if (remaining <= 0.000001) break;
      if (lot.mrp > 0) lowest = lowest > 0 ? Math.min(lowest, Number(lot.mrp)) : Number(lot.mrp);
      remaining = round2(remaining - Math.min(remaining, Number(lot.availableBaseQty)));
    }
    if (lowest > 0) ceilings.set(request.productId, round2(lowest));
  }

  return ceilings;
}

/**
 * `chosenLotByProduct` carries the operator's batch pick, keyed by productId. It
 * arrives alongside the bill rather than on it because BillItem stores no lot
 * column — what got dispensed is recorded in BillItemLotAllocation once this
 * runs, and the pick itself only needs to survive as far as here. The same map
 * produced the price ceiling in bills.service, so honouring it is what keeps the
 * billed price and the dispensed strip talking about the same batch.
 */
export async function allocateLotsForBill(tx, { shopId, locationId, bill, chosenLotByProduct = new Map() }) {
  const byProduct = new Map();
  for (const item of bill.items ?? []) {
    if (!item.productId) continue;
    const row = byProduct.get(item.productId) ?? { quantity: 0, billItemId: item.id, inventoryLotId: chosenLotByProduct.get(item.productId) ?? null };
    row.quantity = round2(row.quantity + Math.abs(Number(item.quantityInBaseUnit || 0)));
    byProduct.set(item.productId, row);
  }
  const tracked = await tx.product.findMany({ where: { shopId, id: { in: [...byProduct.keys()] }, batchTrackingEnabled: true }, select: { id: true, name: true, baseUnit: true } });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (const product of tracked) {
    const requested = byProduct.get(product.id);
    const allLots = await tx.inventoryLot.findMany({ where: { shopId, locationId, productId: product.id, status: "active", availableBaseQty: { gt: 0 }, expiresOn: { gte: today } }, orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }] });
    // A named batch must cover the whole line on its own. Topping the remainder
    // up from the next batch would silently span two printed MRPs while the line
    // carries the chosen batch's ceiling.
    const lots = requested.inventoryLotId ? allLots.filter((lot) => lot.id === requested.inventoryLotId) : allLots;
    if (requested.inventoryLotId && lots.length === 0) throw new AppError("The selected batch is no longer saleable at this branch", 409, "BATCH_NOT_SELLABLE");
    const available = round2(lots.reduce((sum, lot) => sum + Number(lot.availableBaseQty), 0));
    if (available + 0.000001 < requested.quantity) {
      const where = requested.inventoryLotId ? `batch ${lots[0].batchNumber}` : "saleable, unexpired batches";
      const error = new AppError(`${product.name} has only ${available} ${product.baseUnit} in ${where}`, 409, "BATCH_STOCK_INSUFFICIENT");
      error.publicData = { productId: product.id, requestedBaseQty: requested.quantity, availableBaseQty: available, inventoryLotId: requested.inventoryLotId ?? null };
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
