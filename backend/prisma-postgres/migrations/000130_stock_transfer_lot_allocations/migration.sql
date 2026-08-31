CREATE TABLE "StockTransferLotAllocation" (
    "id" TEXT NOT NULL,
    "transferItemId" TEXT NOT NULL,
    "sourceInventoryLotId" TEXT NOT NULL,
    "sellingUnitId" TEXT,
    "batchNumber" TEXT NOT NULL,
    "manufacturedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "quantityBaseQty" DOUBLE PRECISION NOT NULL,
    "receivedBaseQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPerRateUnit" DOUBLE PRECISION NOT NULL,
    "costPerRateUnitPaise" BIGINT,
    "mrp" DOUBLE PRECISION,
    "mrpPaise" BIGINT,
    "sourceStatus" TEXT NOT NULL DEFAULT 'active',
    "sourceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferLotAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockTransferLotAllocation_transferItemId_sourceInventoryLotId_key"
ON "StockTransferLotAllocation"("transferItemId", "sourceInventoryLotId");

CREATE INDEX "StockTransferLotAllocation_sourceInventoryLotId_idx"
ON "StockTransferLotAllocation"("sourceInventoryLotId");

CREATE INDEX "StockTransferLotAllocation_transferItemId_expiresOn_idx"
ON "StockTransferLotAllocation"("transferItemId", "expiresOn");

ALTER TABLE "StockTransferLotAllocation"
ADD CONSTRAINT "StockTransferLotAllocation_transferItemId_fkey"
FOREIGN KEY ("transferItemId") REFERENCES "StockTransferItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockTransferLotAllocation"
ADD CONSTRAINT "StockTransferLotAllocation_sourceInventoryLotId_fkey"
FOREIGN KEY ("sourceInventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
