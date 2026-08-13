import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { decrementLocationInventory, incrementLocationInventory, resolveOperationalLocation } from "../../modules/stores/location-context.service.js";

function cleanDate(value) { return new Date(`${value}T00:00:00.000Z`); }
function effectiveBomQty(row, scale) { return round2(Number(row.quantityBaseQty) * scale * (1 + Number(row.wastagePercent || 0) / 100)); }

export async function overview(shopId) {
  const [activeBoms, plannedRuns, inProgressRuns, quarantinedLots, recentRuns] = await Promise.all([
    db.manufacturingBom.count({ where: { shopId, status: "active" } }),
    db.productionRun.count({ where: { shopId, status: "planned" } }),
    db.productionRun.count({ where: { shopId, status: "in_progress" } }),
    db.inventoryLot.count({ where: { shopId, status: { in: ["quarantined", "recalled"] }, producedByRunId: { not: null } } }),
    db.productionRun.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 20, include: { bom: true, consumptions: true, outputs: true } }),
  ]);
  return { summary: { activeBoms, plannedRuns, inProgressRuns, quarantinedLots }, recentRuns };
}

export function listBoms(shopId) {
  return db.manufacturingBom.findMany({ where: { shopId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], include: { items: true } });
}

export async function createBom(shopId, input) {
  const productIds = [input.finishedProductId, ...input.items.map((row) => row.materialProductId)];
  const products = await db.product.findMany({ where: { shopId, id: { in: productIds }, deletedAt: null }, select: { id: true, batchTrackingEnabled: true } });
  if (new Set(products.map((row) => row.id)).size !== new Set(productIds).size) throw new AppError("One or more BOM products are unavailable", 422, "BOM_PRODUCT_UNAVAILABLE");
  if (!products.find((row) => row.id === input.finishedProductId)?.batchTrackingEnabled) throw new AppError("Enable batch tracking on the finished product before creating its BOM", 422, "FINISHED_PRODUCT_BATCH_TRACKING_REQUIRED");
  const latest = await db.manufacturingBom.findFirst({ where: { shopId, finishedProductId: input.finishedProductId }, orderBy: { version: "desc" }, select: { version: true } });
  return db.$transaction(async (tx) => {
    await tx.manufacturingBom.updateMany({ where: { shopId, finishedProductId: input.finishedProductId, status: "active" }, data: { status: "superseded" } });
    return tx.manufacturingBom.create({ data: {
      shopId, finishedProductId: input.finishedProductId, name: input.name,
      version: Number(latest?.version || 0) + 1, outputQuantityBaseQty: input.outputQuantityBaseQty,
      notes: input.notes ?? null,
      items: { create: input.items.map((row) => ({ shopId, ...row })) },
    }, include: { items: true } });
  });
}

export async function createRun(shopId, input) {
  const location = await resolveOperationalLocation(shopId, input.locationId);
  const bom = await db.manufacturingBom.findFirst({ where: { id: input.bomId, shopId, status: "active" } });
  if (!bom) throw new AppError("Active BOM not found", 404, "BOM_NOT_FOUND");
  return db.productionRun.create({ data: { shopId, locationId: location.id, bomId: bom.id, runNumber: input.runNumber, plannedOutputBaseQty: input.plannedOutputBaseQty, notes: input.notes ?? null } });
}

export async function completeRun(shopId, runId, input) {
  if (input.qcStatus === "failed") throw new AppError("A failed QC batch cannot be released into finished stock", 422, "PRODUCTION_QC_FAILED");
  return db.$transaction(async (tx) => {
    const run = await tx.productionRun.findFirst({ where: { id: runId, shopId }, include: { bom: { include: { items: true } } } });
    if (!run) throw new AppError("Production run not found", 404, "PRODUCTION_RUN_NOT_FOUND");
    if (!['planned', 'in_progress'].includes(run.status)) throw new AppError("This production run is already closed", 409, "PRODUCTION_RUN_ALREADY_CLOSED");
    const location = await resolveOperationalLocation(shopId, run.locationId, tx);
    const finished = await tx.product.findFirst({ where: { id: run.bom.finishedProductId, shopId, deletedAt: null }, include: { sellingUnits: true } });
    if (!finished) throw new AppError("Finished product is unavailable", 422, "FINISHED_PRODUCT_UNAVAILABLE");
    const scale = Number(run.plannedOutputBaseQty) / Number(run.bom.outputQuantityBaseQty);
    const bomByProduct = new Map(run.bom.items.map((row) => [row.materialProductId, row]));
    if (new Set(input.consumptions.map((row) => row.productId)).size !== input.consumptions.length) throw new AppError("Combine duplicate material consumption rows", 422, "DUPLICATE_CONSUMPTION");

    for (const row of input.consumptions) {
      const bomItem = bomByProduct.get(row.productId);
      if (!bomItem) throw new AppError("A consumed material is not part of this BOM", 422, "CONSUMPTION_NOT_IN_BOM");
      const product = await tx.product.findFirst({ where: { id: row.productId, shopId, deletedAt: null }, include: { sellingUnits: true } });
      if (!product) throw new AppError("Consumed material is unavailable", 422, "MATERIAL_UNAVAILABLE");
      let sourceBatchNumber = null;
      if (row.inventoryLotId) {
        const lot = await tx.inventoryLot.findFirst({ where: { id: row.inventoryLotId, shopId, locationId: location.id, productId: row.productId, status: "active" } });
        if (!lot || Number(lot.availableBaseQty) < Number(row.actualBaseQty)) throw new AppError(`Insufficient selected batch stock for ${product.name}`, 409, "INSUFFICIENT_BATCH_STOCK");
        await tx.inventoryLot.update({ where: { id: lot.id }, data: { availableBaseQty: { decrement: row.actualBaseQty }, ...(Number(lot.availableBaseQty) === Number(row.actualBaseQty) ? { status: "depleted" } : {}) } });
        sourceBatchNumber = lot.batchNumber;
      }
      const packs = row.sellingUnitId && row.packageCount ? new Map([[row.sellingUnitId, { sellingUnit: product.sellingUnits.find((unit) => unit.id === row.sellingUnitId), qty: row.packageCount }]]) : null;
      const moved = await decrementLocationInventory(tx, { shopId, location, product, quantityBase: row.actualBaseQty, packs });
      await tx.stockLedger.create({ data: { shopId, locationId: location.id, productId: product.id, productName: product.name, sellingUnitId: row.sellingUnitId ?? null, sellingUnitQty: row.packageCount ?? null, action: "production_use", changeBaseQty: -row.actualBaseQty, oldStockBaseQty: moved.oldStock, newStockBaseQty: moved.newStock, sourceType: "production_run", sourceId: run.id, note: `Consumed by ${run.runNumber}` } });
      await tx.productionConsumption.create({ data: { shopId, runId: run.id, productId: product.id, inventoryLotId: row.inventoryLotId ?? null, plannedBaseQty: effectiveBomQty(bomItem, scale), actualBaseQty: row.actualBaseQty, sourceBatchNumber } });
    }

    const outputTotal = round2(input.outputs.reduce((sum, row) => sum + Number(row.quantityBaseQty), 0));
    if (Math.abs(outputTotal - Number(input.actualOutputBaseQty)) > 0.01) throw new AppError("Packaging outputs must equal actual finished output", 422, "PRODUCTION_OUTPUT_MISMATCH");
    const lot = await tx.inventoryLot.create({ data: { shopId, locationId: location.id, productId: finished.id, producedByRunId: run.id, batchNumber: input.finishedBatchNumber, manufacturedOn: cleanDate(input.manufacturedOn), expiresOn: cleanDate(input.expiresOn), receivedBaseQty: input.actualOutputBaseQty, availableBaseQty: input.actualOutputBaseQty, costPerRateUnit: finished.costPerRateUnit, status: input.qcStatus === "conditional" ? "quarantined" : "active", note: `Produced by ${run.runNumber}` } });
    const packMap = new Map();
    for (const row of input.outputs) {
      const unit = row.sellingUnitId ? finished.sellingUnits.find((candidate) => candidate.id === row.sellingUnitId) : null;
      if (row.sellingUnitId && !unit) throw new AppError("A packaging output does not belong to the finished product", 422, "OUTPUT_PACKAGING_INVALID");
      if (unit && row.packageCount) packMap.set(unit.id, { sellingUnit: unit, qty: row.packageCount });
      await tx.productionOutput.create({ data: { shopId, runId: run.id, productId: finished.id, sellingUnitId: unit?.id ?? null, inventoryLotId: lot.id, packagingSku: unit?.sku ?? unit?.unitCode ?? null, quantityBaseQty: row.quantityBaseQty, packageCount: row.packageCount ?? null, batchNumber: input.finishedBatchNumber } });
    }
    const moved = await incrementLocationInventory(tx, { shopId, location, product: finished, quantityBase: input.actualOutputBaseQty, packs: packMap.size ? packMap : null });
    await tx.stockLedger.create({ data: { shopId, locationId: location.id, productId: finished.id, productName: finished.name, action: "production_output", changeBaseQty: input.actualOutputBaseQty, oldStockBaseQty: moved.oldStock, newStockBaseQty: moved.newStock, sourceType: "production_run", sourceId: run.id, note: `Finished batch ${input.finishedBatchNumber}` } });
    return tx.productionRun.update({ where: { id: run.id }, data: { status: input.qcStatus === "conditional" ? "quarantined" : "completed", actualOutputBaseQty: input.actualOutputBaseQty, finishedBatchNumber: input.finishedBatchNumber, manufacturedOn: cleanDate(input.manufacturedOn), expiresOn: cleanDate(input.expiresOn), qcStatus: input.qcStatus, notes: input.notes ?? run.notes, startedAt: run.startedAt ?? new Date(), completedAt: new Date() }, include: { bom: true, consumptions: true, outputs: true } });
  });
}

export async function traceBatch(shopId, batchNumber) {
  const outputs = await db.productionOutput.findMany({ where: { shopId, batchNumber }, include: { run: { include: { bom: true, consumptions: true } } } });
  const source = await db.productionConsumption.findMany({ where: { shopId, sourceBatchNumber: batchNumber }, include: { run: { include: { bom: true, outputs: true } } } });
  const lots = await db.inventoryLot.findMany({ where: { shopId, batchNumber }, include: { allocations: { include: { billItem: { include: { bill: { select: { id: true, billNo: true, customerName: true, businessDate: true, status: true } } } } } } } });
  const dispatchedBills = [...new Map(lots.flatMap((lot) => lot.allocations.map((allocation) => allocation.billItem.bill)).map((bill) => [bill.id, bill])).values()];
  return { batchNumber, producedAs: outputs, consumedBy: source, dispatchedBills };
}

export async function releaseRun(shopId, runId) {
  return db.$transaction(async (tx) => {
    const run = await tx.productionRun.findFirst({ where: { id: runId, shopId, status: "quarantined" } });
    if (!run) throw new AppError("Only a QC-held production run can be released", 409, "PRODUCTION_RUN_NOT_ON_HOLD");
    await tx.inventoryLot.updateMany({ where: { shopId, producedByRunId: run.id, status: "quarantined" }, data: { status: "active", note: `QC released from ${run.runNumber}` } });
    return tx.productionRun.update({ where: { id: run.id }, data: { status: "completed", qcStatus: "passed" }, include: { bom: true, consumptions: true, outputs: true } });
  });
}
