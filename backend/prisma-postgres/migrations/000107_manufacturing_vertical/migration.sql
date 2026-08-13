-- @replay-safe: every added column, table and index is guarded with IF NOT
-- EXISTS, and this additive migration contains no backfill or unguarded DDL.
ALTER TABLE "ProductSellingUnit" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "InventoryLot" ADD COLUMN IF NOT EXISTS "sellingUnitId" TEXT;
ALTER TABLE "InventoryLot" ADD COLUMN IF NOT EXISTS "producedByRunId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductSellingUnit_shopId_sku_idx" ON "ProductSellingUnit"("shopId", "sku");
CREATE INDEX IF NOT EXISTS "InventoryLot_shopId_sellingUnitId_status_idx" ON "InventoryLot"("shopId", "sellingUnitId", "status");
CREATE INDEX IF NOT EXISTS "InventoryLot_producedByRunId_idx" ON "InventoryLot"("producedByRunId");

CREATE TABLE IF NOT EXISTS "ManufacturingBom" ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "finishedProductId" TEXT NOT NULL, "name" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'active', "outputQuantityBaseQty" DOUBLE PRECISION NOT NULL, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "ManufacturingBom_shopId_finishedProductId_version_key" ON "ManufacturingBom"("shopId", "finishedProductId", "version");
CREATE INDEX IF NOT EXISTS "ManufacturingBom_shopId_status_updatedAt_idx" ON "ManufacturingBom"("shopId", "status", "updatedAt");

CREATE TABLE IF NOT EXISTS "ManufacturingBomItem" ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "bomId" TEXT NOT NULL, "materialProductId" TEXT NOT NULL, "quantityBaseQty" DOUBLE PRECISION NOT NULL, "wastagePercent" DOUBLE PRECISION NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ManufacturingBomItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "ManufacturingBom"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS "ManufacturingBomItem_bomId_materialProductId_key" ON "ManufacturingBomItem"("bomId", "materialProductId");
CREATE INDEX IF NOT EXISTS "ManufacturingBomItem_shopId_materialProductId_idx" ON "ManufacturingBomItem"("shopId", "materialProductId");

CREATE TABLE IF NOT EXISTS "ProductionRun" ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "locationId" TEXT NOT NULL, "bomId" TEXT NOT NULL, "runNumber" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'planned', "plannedOutputBaseQty" DOUBLE PRECISION NOT NULL, "actualOutputBaseQty" DOUBLE PRECISION, "finishedBatchNumber" TEXT, "manufacturedOn" TIMESTAMP(3), "expiresOn" TIMESTAMP(3), "qcStatus" TEXT NOT NULL DEFAULT 'pending', "notes" TEXT, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProductionRun_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "ManufacturingBom"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductionRun_shopId_runNumber_key" ON "ProductionRun"("shopId", "runNumber");
CREATE INDEX IF NOT EXISTS "ProductionRun_shopId_status_createdAt_idx" ON "ProductionRun"("shopId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductionRun_shopId_finishedBatchNumber_idx" ON "ProductionRun"("shopId", "finishedBatchNumber");

CREATE TABLE IF NOT EXISTS "ProductionConsumption" ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "runId" TEXT NOT NULL, "productId" TEXT NOT NULL, "inventoryLotId" TEXT, "plannedBaseQty" DOUBLE PRECISION NOT NULL, "actualBaseQty" DOUBLE PRECISION NOT NULL, "sourceBatchNumber" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProductionConsumption_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX IF NOT EXISTS "ProductionConsumption_shopId_productId_idx" ON "ProductionConsumption"("shopId", "productId");
CREATE INDEX IF NOT EXISTS "ProductionConsumption_inventoryLotId_idx" ON "ProductionConsumption"("inventoryLotId");

CREATE TABLE IF NOT EXISTS "ProductionOutput" ("id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "runId" TEXT NOT NULL, "productId" TEXT NOT NULL, "sellingUnitId" TEXT, "inventoryLotId" TEXT, "packagingSku" TEXT, "quantityBaseQty" DOUBLE PRECISION NOT NULL, "packageCount" DOUBLE PRECISION, "batchNumber" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProductionOutput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX IF NOT EXISTS "ProductionOutput_shopId_productId_batchNumber_idx" ON "ProductionOutput"("shopId", "productId", "batchNumber");
CREATE INDEX IF NOT EXISTS "ProductionOutput_inventoryLotId_idx" ON "ProductionOutput"("inventoryLotId");
