-- @replay-safe: SQLite supports guarded table and index creation; the foreign
-- keys are part of the guarded table declaration.
CREATE TABLE IF NOT EXISTS "StockTransferLotAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferItemId" TEXT NOT NULL,
    "sourceInventoryLotId" TEXT NOT NULL,
    "sellingUnitId" TEXT,
    "batchNumber" TEXT NOT NULL,
    "manufacturedOn" DATETIME,
    "expiresOn" DATETIME NOT NULL,
    "quantityBaseQty" REAL NOT NULL,
    "receivedBaseQty" REAL NOT NULL DEFAULT 0,
    "costPerRateUnit" REAL NOT NULL,
    "costPerRateUnitPaise" BIGINT,
    "mrp" REAL,
    "mrpPaise" BIGINT,
    "sourceStatus" TEXT NOT NULL DEFAULT 'active',
    "sourceNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockTransferLotAllocation_transferItemId_fkey" FOREIGN KEY ("transferItemId") REFERENCES "StockTransferItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockTransferLotAllocation_sourceInventoryLotId_fkey" FOREIGN KEY ("sourceInventoryLotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockTransferLotAllocation_transferItemId_sourceInventoryLotId_key"
ON "StockTransferLotAllocation"("transferItemId", "sourceInventoryLotId");

CREATE INDEX IF NOT EXISTS "StockTransferLotAllocation_sourceInventoryLotId_idx"
ON "StockTransferLotAllocation"("sourceInventoryLotId");

CREATE INDEX IF NOT EXISTS "StockTransferLotAllocation_transferItemId_expiresOn_idx"
ON "StockTransferLotAllocation"("transferItemId", "expiresOn");
