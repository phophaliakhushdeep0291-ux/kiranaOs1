-- Electronics: serialised stock units.
--
-- Every other trade in the app counts stock as a number. This one has to name
-- each piece: the shop sells THAT handset, and a return, a warranty claim or a
-- police enquiry has to find the same physical unit again months later.
--
-- productId and billId are intentionally not foreign keys: the unit records a
-- physical thing that left the shop and must outlive a renamed product or a
-- cancelled bill.

CREATE TABLE "ProductUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "imei" TEXT,
    "imei2" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "condition" TEXT NOT NULL DEFAULT 'new',
    "purchaseBillId" TEXT,
    "supplierId" TEXT,
    "costPrice" REAL NOT NULL DEFAULT 0,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billId" TEXT,
    "billNumber" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT NOT NULL DEFAULT '',
    "soldAt" DATETIME,
    "sellingPrice" REAL NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "warrantyUntil" DATETIME,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductUnit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Two units in one shop may never share an identifier. NULLs are distinct, so a
-- laptop with no IMEI does not collide with every other laptop that has none.
CREATE UNIQUE INDEX "ProductUnit_shopId_imei_key" ON "ProductUnit"("shopId", "imei");
CREATE UNIQUE INDEX "ProductUnit_shopId_serialNumber_key" ON "ProductUnit"("shopId", "serialNumber");
-- The counter's lookup: someone puts a handset down and asks about it.
CREATE INDEX "ProductUnit_shopId_imei2_idx" ON "ProductUnit"("shopId", "imei2");
CREATE INDEX "ProductUnit_shopId_status_idx" ON "ProductUnit"("shopId", "status");
CREATE INDEX "ProductUnit_shopId_productId_status_idx" ON "ProductUnit"("shopId", "productId", "status");
CREATE INDEX "ProductUnit_shopId_billId_idx" ON "ProductUnit"("shopId", "billId");
CREATE INDEX "ProductUnit_shopId_customerPhone_idx" ON "ProductUnit"("shopId", "customerPhone");
-- "What cover is about to run out?"
CREATE INDEX "ProductUnit_shopId_warrantyUntil_idx" ON "ProductUnit"("shopId", "warrantyUntil");
