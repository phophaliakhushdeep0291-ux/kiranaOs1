ALTER TABLE "ProductSellingUnit" ADD COLUMN "sku" TEXT;
ALTER TABLE "InventoryLot" ADD COLUMN "sellingUnitId" TEXT;
ALTER TABLE "InventoryLot" ADD COLUMN "producedByRunId" TEXT;

CREATE INDEX "ProductSellingUnit_shopId_sku_idx" ON "ProductSellingUnit"("shopId", "sku");
CREATE INDEX "InventoryLot_shopId_sellingUnitId_status_idx" ON "InventoryLot"("shopId", "sellingUnitId", "status");
CREATE INDEX "InventoryLot_producedByRunId_idx" ON "InventoryLot"("producedByRunId");

CREATE TABLE "ManufacturingBom" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "finishedProductId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "outputQuantityBaseQty" REAL NOT NULL,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ManufacturingBom_shopId_finishedProductId_version_key" ON "ManufacturingBom"("shopId", "finishedProductId", "version");
CREATE INDEX "ManufacturingBom_shopId_status_updatedAt_idx" ON "ManufacturingBom"("shopId", "status", "updatedAt");

CREATE TABLE "ManufacturingBomItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "materialProductId" TEXT NOT NULL,
  "quantityBaseQty" REAL NOT NULL,
  "wastagePercent" REAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManufacturingBomItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "ManufacturingBom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManufacturingBomItem_bomId_materialProductId_key" ON "ManufacturingBomItem"("bomId", "materialProductId");
CREATE INDEX "ManufacturingBomItem_shopId_materialProductId_idx" ON "ManufacturingBomItem"("shopId", "materialProductId");

CREATE TABLE "ProductionRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "bomId" TEXT NOT NULL,
  "runNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "plannedOutputBaseQty" REAL NOT NULL,
  "actualOutputBaseQty" REAL,
  "finishedBatchNumber" TEXT,
  "manufacturedOn" DATETIME,
  "expiresOn" DATETIME,
  "qcStatus" TEXT NOT NULL DEFAULT 'pending',
  "notes" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductionRun_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "ManufacturingBom"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionRun_shopId_runNumber_key" ON "ProductionRun"("shopId", "runNumber");
CREATE INDEX "ProductionRun_shopId_status_createdAt_idx" ON "ProductionRun"("shopId", "status", "createdAt");
CREATE INDEX "ProductionRun_shopId_finishedBatchNumber_idx" ON "ProductionRun"("shopId", "finishedBatchNumber");

CREATE TABLE "ProductionConsumption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "inventoryLotId" TEXT,
  "plannedBaseQty" REAL NOT NULL,
  "actualBaseQty" REAL NOT NULL,
  "sourceBatchNumber" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionConsumption_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductionConsumption_shopId_productId_idx" ON "ProductionConsumption"("shopId", "productId");
CREATE INDEX "ProductionConsumption_inventoryLotId_idx" ON "ProductionConsumption"("inventoryLotId");

CREATE TABLE "ProductionOutput" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sellingUnitId" TEXT,
  "inventoryLotId" TEXT,
  "packagingSku" TEXT,
  "quantityBaseQty" REAL NOT NULL,
  "packageCount" REAL,
  "batchNumber" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionOutput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductionOutput_shopId_productId_batchNumber_idx" ON "ProductionOutput"("shopId", "productId", "batchNumber");
CREATE INDEX "ProductionOutput_inventoryLotId_idx" ON "ProductionOutput"("inventoryLotId");
