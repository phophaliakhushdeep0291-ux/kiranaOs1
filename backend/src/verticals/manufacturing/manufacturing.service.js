import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { decrementLocationInventory, incrementLocationInventory, resolveOperationalLocation } from "../../modules/stores/location-context.service.js";
import { stockLedgerProvenance } from "../../modules/inventory/stock-ledger-provenance.js";
import { formatDateInTimeZone } from "../../utils/dates.js";

function cleanDate(value) { return new Date(`${value}T00:00:00.000Z`); }
function effectiveBomQty(row, scale) { return round2(Number(row.quantityBaseQty) * scale * (1 + Number(row.wastagePercent || 0) / 100)); }

function runLocation(run, actor) {
  if (actor.locationId && actor.locationId !== run.locationId) throw new AppError("Switch to this run's location before updating it", 403, "PRODUCTION_LOCATION_MISMATCH");
}

function packaging(product, row, quantity) {
  if (!row.sellingUnitId) {
    if (row.packageCount != null || product.packagingMode === "per_pack") throw new AppError(`Select the packaging and count for ${product.name}`, 422, "PRODUCTION_PACKAGING_REQUIRED");
    return null;
  }
  const unit = product.sellingUnits.find((entry) => entry.id === row.sellingUnitId && entry.isActive);
  if (!unit || !(Number(row.packageCount) > 0) || !(Number(unit.conversionToBase) > 0)
    || Math.abs(round2(Number(row.packageCount) * Number(unit.conversionToBase)) - round2(quantity)) > 0.001) {
    throw new AppError(`Pack count must match the base quantity for ${product.name}`, 422, "PRODUCTION_PACKAGING_MISMATCH");
  }
  return { sellingUnit: unit, qty: Number(row.packageCount) };
}

export async function runDetails(shopId, runId, actor = {}) {
  const run = await db.productionRun.findFirst({ where: { id: runId, shopId }, include: { bom: { include: { items: true } } } });
  if (!run) throw new AppError("Production run not found", 404, "PRODUCTION_RUN_NOT_FOUND");
  runLocation(run, actor);
  const productIds = [run.bom.finishedProductId, ...run.bom.items.map((item) => item.materialProductId)];
  const [products, lots] = await Promise.all([
    db.product.findMany({ where: { shopId, id: { in: productIds }, deletedAt: null }, include: { sellingUnits: true } }),
    db.inventoryLot.findMany({ where: { shopId, locationId: run.locationId, productId: { in: productIds }, status: "active", availableBaseQty: { gt: 0 }, expiresOn: { gte: cleanDate(formatDateInTimeZone(new Date())) } }, orderBy: { expiresOn: "asc" } }),
  ]);
  return { run, products, lots };
}

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

export async function completeRun(shopId, runId, input, actor = {}) {
  if (input.qcStatus === "failed") throw new AppError("A failed QC batch cannot be released into finished stock", 422, "PRODUCTION_QC_FAILED");
  return db.$transaction(async (tx) => {
    const run = await tx.productionRun.findFirst({ where: { id: runId, shopId }, include: { bom: { include: { items: true } } } });
    if (!run) throw new AppError("Production run not found", 404, "PRODUCTION_RUN_NOT_FOUND");
    runLocation(run, actor);
    if (!['planned', 'in_progress'].includes(run.status)) throw new AppError("This production run is already closed", 409, "PRODUCTION_RUN_ALREADY_CLOSED");
    // Claim the run inside the stock transaction. Concurrent completions cannot
    // both move stock; a failed completion rolls the claim back too.
    const claimed = await tx.productionRun.updateMany({ where: { id: run.id, shopId, status: { in: ["planned", "in_progress"] } }, data: { status: "completing" } });
    if (claimed.count !== 1) throw new AppError("This production run is already closed", 409, "PRODUCTION_RUN_ALREADY_CLOSED");
    const location = await resolveOperationalLocation(shopId, run.locationId, tx);
    const finished = await tx.product.findFirst({ where: { id: run.bom.finishedProductId, shopId, deletedAt: null }, include: { sellingUnits: true } });
    if (!finished) throw new AppError("Finished product is unavailable", 422, "FINISHED_PRODUCT_UNAVAILABLE");
    const scale = Number(run.plannedOutputBaseQty) / Number(run.bom.outputQuantityBaseQty);
    const bomByProduct = new Map(run.bom.items.map((row) => [row.materialProductId, row]));
    if (new Set(input.consumptions.map((row) => row.productId)).size !== input.consumptions.length) throw new AppError("Combine duplicate material consumption rows", 422, "DUPLICATE_CONSUMPTION");
    if (input.consumptions.length !== bomByProduct.size || input.consumptions.some((row) => !bomByProduct.has(row.productId))) throw new AppError("Record actual consumption for every BOM material", 422, "PRODUCTION_MATERIALS_INCOMPLETE");

    for (const row of input.consumptions) {
      const bomItem = bomByProduct.get(row.productId);
      if (!bomItem) throw new AppError("A consumed material is not part of this BOM", 422, "CONSUMPTION_NOT_IN_BOM");
      const product = await tx.product.findFirst({ where: { id: row.productId, shopId, deletedAt: null }, include: { sellingUnits: true } });
      if (!product) throw new AppError("Consumed material is unavailable", 422, "MATERIAL_UNAVAILABLE");
      let sourceBatchNumber = null;
      if (product.batchTrackingEnabled && !row.inventoryLotId) throw new AppError(`Select a source batch for ${product.name}`, 422, "PRODUCTION_SOURCE_BATCH_REQUIRED");
      if (row.inventoryLotId) {
        const lot = await tx.inventoryLot.findFirst({ where: { id: row.inventoryLotId, shopId, locationId: location.id, productId: row.productId, status: "active", expiresOn: { gte: cleanDate(formatDateInTimeZone(new Date())) } } });
        if (!lot || Number(lot.availableBaseQty) < Number(row.actualBaseQty)) throw new AppError(`Insufficient selected batch stock for ${product.name}`, 409, "INSUFFICIENT_BATCH_STOCK");
        const movedLot = await tx.inventoryLot.updateMany({ where: { id: lot.id, status: "active", availableBaseQty: { gte: row.actualBaseQty } }, data: { availableBaseQty: { decrement: row.actualBaseQty } } });
        if (movedLot.count !== 1) throw new AppError(`Selected batch stock changed for ${product.name}`, 409, "INSUFFICIENT_BATCH_STOCK");
        await tx.inventoryLot.updateMany({ where: { id: lot.id, availableBaseQty: 0 }, data: { status: "depleted" } });
        sourceBatchNumber = lot.batchNumber;
      }
      const pack = packaging(product, row, row.actualBaseQty);
      const packs = pack ? new Map([[row.sellingUnitId, pack]]) : null;
      const moved = await decrementLocationInventory(tx, { shopId, location, product, quantityBase: row.actualBaseQty, packs });
      await tx.stockLedger.create({ data: { shopId, locationId: location.id, productId: product.id, productName: product.name, ...stockLedgerProvenance(actor), sellingUnitId: row.sellingUnitId ?? null, sellingUnitQty: row.packageCount ?? null, action: "production_use", changeBaseQty: -row.actualBaseQty, oldStockBaseQty: moved.oldStock, newStockBaseQty: moved.newStock, sourceType: "production_run", sourceId: run.id, note: `Consumed by ${run.runNumber}` } });
      await tx.productionConsumption.create({ data: { shopId, runId: run.id, productId: product.id, inventoryLotId: row.inventoryLotId ?? null, plannedBaseQty: effectiveBomQty(bomItem, scale), actualBaseQty: row.actualBaseQty, sourceBatchNumber } });
    }

    const outputTotal = round2(input.outputs.reduce((sum, row) => sum + Number(row.quantityBaseQty), 0));
    if (Math.abs(outputTotal - Number(input.actualOutputBaseQty)) > 0.01) throw new AppError("Packaging outputs must equal actual finished output", 422, "PRODUCTION_OUTPUT_MISMATCH");
    const lot = await tx.inventoryLot.create({ data: { shopId, locationId: location.id, productId: finished.id, producedByRunId: run.id, batchNumber: input.finishedBatchNumber, manufacturedOn: cleanDate(input.manufacturedOn), expiresOn: cleanDate(input.expiresOn), receivedBaseQty: input.actualOutputBaseQty, availableBaseQty: input.actualOutputBaseQty, costPerRateUnit: finished.costPerRateUnit, status: input.qcStatus === "conditional" ? "quarantined" : "active", note: `Produced by ${run.runNumber}` } });
    const packMap = new Map();
    for (const row of input.outputs) {
      const pack = packaging(finished, row, row.quantityBaseQty);
      const unit = pack?.sellingUnit;
      if (pack) {
        const previous = packMap.get(unit.id);
        packMap.set(unit.id, { ...pack, qty: round2((previous?.qty ?? 0) + pack.qty) });
      }
      await tx.productionOutput.create({ data: { shopId, runId: run.id, productId: finished.id, sellingUnitId: unit?.id ?? null, inventoryLotId: lot.id, packagingSku: unit?.sku ?? unit?.unitCode ?? null, quantityBaseQty: row.quantityBaseQty, packageCount: row.packageCount ?? null, batchNumber: input.finishedBatchNumber } });
    }
    const moved = await incrementLocationInventory(tx, { shopId, location, product: finished, quantityBase: input.actualOutputBaseQty, packs: packMap.size ? packMap : null });
    await tx.stockLedger.create({ data: { shopId, locationId: location.id, productId: finished.id, productName: finished.name, ...stockLedgerProvenance(actor), action: "production_output", changeBaseQty: input.actualOutputBaseQty, oldStockBaseQty: moved.oldStock, newStockBaseQty: moved.newStock, sourceType: "production_run", sourceId: run.id, note: `Finished batch ${input.finishedBatchNumber}` } });
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

export async function releaseRun(shopId, runId, actor = {}) {
  return db.$transaction(async (tx) => {
    const run = await tx.productionRun.findFirst({ where: { id: runId, shopId, status: "quarantined" } });
    if (!run) throw new AppError("Only a QC-held production run can be released", 409, "PRODUCTION_RUN_NOT_ON_HOLD");
    runLocation(run, actor);
    const claimed = await tx.productionRun.updateMany({ where: { id: run.id, shopId, status: "quarantined" }, data: { status: "completed", qcStatus: "passed" } });
    if (claimed.count !== 1) throw new AppError("This run's QC status changed. Refresh and review it again", 409, "PRODUCTION_RUN_NOT_ON_HOLD");
    await tx.inventoryLot.updateMany({ where: { shopId, producedByRunId: run.id, status: "quarantined" }, data: { status: "active", note: `QC released from ${run.runNumber}` } });
    return tx.productionRun.update({ where: { id: run.id }, data: { status: "completed", qcStatus: "passed" }, include: { bom: true, consumptions: true, outputs: true } });
  });
}
