ALTER TABLE "Product" ADD COLUMN "batchTrackingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "InventoryLot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "purchaseReceiptItemId" TEXT,
  "batchNumber" TEXT NOT NULL,
  "manufacturedOn" DATETIME,
  "expiresOn" DATETIME NOT NULL,
  "receivedBaseQty" REAL NOT NULL,
  "availableBaseQty" REAL NOT NULL,
  "costPerRateUnit" REAL NOT NULL,
  "costPerRateUnitPaise" BIGINT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InventoryLot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryLot_purchaseReceiptItemId_fkey" FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "PurchaseReceiptItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BillItemLotAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "billItemId" TEXT NOT NULL,
  "inventoryLotId" TEXT NOT NULL,
  "quantityBaseQty" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillItemLotAllocation_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BillItemLotAllocation_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InventoryLot_shopId_locationId_productId_batchNumber_expiresOn_key" ON "InventoryLot"("shopId", "locationId", "productId", "batchNumber", "expiresOn");
CREATE INDEX "InventoryLot_shopId_locationId_status_expiresOn_idx" ON "InventoryLot"("shopId", "locationId", "status", "expiresOn");
CREATE INDEX "InventoryLot_shopId_productId_expiresOn_idx" ON "InventoryLot"("shopId", "productId", "expiresOn");
CREATE UNIQUE INDEX "BillItemLotAllocation_billItemId_inventoryLotId_key" ON "BillItemLotAllocation"("billItemId", "inventoryLotId");
CREATE INDEX "BillItemLotAllocation_inventoryLotId_idx" ON "BillItemLotAllocation"("inventoryLotId");
