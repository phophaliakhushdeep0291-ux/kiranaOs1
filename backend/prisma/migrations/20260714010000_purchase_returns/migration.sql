CREATE TABLE "PurchaseReturn" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "supplierId" TEXT,
  "purchaseReceiptId" TEXT NOT NULL,
  "returnNumber" TEXT NOT NULL,
  "refundMode" TEXT NOT NULL DEFAULT 'supplier_credit',
  "totalAmount" REAL NOT NULL,
  "totalAmountPaise" BIGINT,
  "supplierCreditAmount" REAL NOT NULL DEFAULT 0,
  "supplierCreditAmountPaise" BIGINT,
  "refundAmount" REAL NOT NULL DEFAULT 0,
  "refundAmountPaise" BIGINT,
  "reason" TEXT NOT NULL,
  "supplierReference" TEXT,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReturn_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReturn_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PurchaseReturnItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "purchaseReturnId" TEXT NOT NULL,
  "purchaseReceiptItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantityBaseQty" REAL NOT NULL,
  "actualRate" REAL NOT NULL,
  "actualRatePaise" BIGINT,
  "lineAmount" REAL NOT NULL,
  "lineAmountPaise" BIGINT,
  "lotAllocationsJson" TEXT NOT NULL DEFAULT '[]',
  CONSTRAINT "PurchaseReturnItem_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReturnItem_purchaseReceiptItemId_fkey" FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "PurchaseReceiptItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PurchaseReturn_shopId_returnNumber_key" ON "PurchaseReturn"("shopId", "returnNumber");
CREATE INDEX "PurchaseReturn_shopId_locationId_createdAt_idx" ON "PurchaseReturn"("shopId", "locationId", "createdAt");
CREATE INDEX "PurchaseReturn_shopId_supplierId_createdAt_idx" ON "PurchaseReturn"("shopId", "supplierId", "createdAt");
CREATE INDEX "PurchaseReturn_shopId_purchaseReceiptId_createdAt_idx" ON "PurchaseReturn"("shopId", "purchaseReceiptId", "createdAt");
CREATE UNIQUE INDEX "PurchaseReturnItem_purchaseReturnId_purchaseReceiptItemId_key" ON "PurchaseReturnItem"("purchaseReturnId", "purchaseReceiptItemId");
CREATE INDEX "PurchaseReturnItem_productId_idx" ON "PurchaseReturnItem"("productId");
