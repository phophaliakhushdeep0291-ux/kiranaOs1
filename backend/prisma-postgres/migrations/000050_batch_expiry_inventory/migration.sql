ALTER TABLE "Product" ADD COLUMN "batchTrackingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "InventoryLot" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "purchaseReceiptItemId" TEXT,
  "batchNumber" TEXT NOT NULL,
  "manufacturedOn" TIMESTAMP(3),
  "expiresOn" TIMESTAMP(3) NOT NULL,
  "receivedBaseQty" DOUBLE PRECISION NOT NULL,
  "availableBaseQty" DOUBLE PRECISION NOT NULL,
  "costPerRateUnit" DOUBLE PRECISION NOT NULL,
  "costPerRateUnitPaise" BIGINT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillItemLotAllocation" (
  "id" TEXT NOT NULL,
  "billItemId" TEXT NOT NULL,
  "inventoryLotId" TEXT NOT NULL,
  "quantityBaseQty" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillItemLotAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryLot_shopId_locationId_productId_batchNumber_expiresOn_key" ON "InventoryLot"("shopId", "locationId", "productId", "batchNumber", "expiresOn");
CREATE INDEX "InventoryLot_shopId_locationId_status_expiresOn_idx" ON "InventoryLot"("shopId", "locationId", "status", "expiresOn");
CREATE INDEX "InventoryLot_shopId_productId_expiresOn_idx" ON "InventoryLot"("shopId", "productId", "expiresOn");
CREATE UNIQUE INDEX "BillItemLotAllocation_billItemId_inventoryLotId_key" ON "BillItemLotAllocation"("billItemId", "inventoryLotId");
CREATE INDEX "BillItemLotAllocation_inventoryLotId_idx" ON "BillItemLotAllocation"("inventoryLotId");
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_purchaseReceiptItemId_fkey" FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "PurchaseReceiptItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillItemLotAllocation" ADD CONSTRAINT "BillItemLotAllocation_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillItemLotAllocation" ADD CONSTRAINT "BillItemLotAllocation_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
