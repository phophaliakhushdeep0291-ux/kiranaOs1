ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseOrderId" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseOrderItemId" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseReceiptId" TEXT;

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "supplierId" TEXT,
  "orderNumber" TEXT NOT NULL,
  "supplierName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "expectedOn" DATETIME,
  "expectedTotal" REAL NOT NULL DEFAULT 0,
  "expectedTotalPaise" INTEGER,
  "note" TEXT,
  "createdByUserId" TEXT,
  "sentAt" DATETIME,
  "receivedAt" DATETIME,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PurchaseOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PurchaseOrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "baseUnit" TEXT NOT NULL,
  "rateUnit" TEXT NOT NULL,
  "orderedBaseQty" REAL NOT NULL,
  "receivedBaseQty" REAL NOT NULL DEFAULT 0,
  "expectedRate" REAL NOT NULL,
  "expectedRatePaise" INTEGER,
  "expectedAmount" REAL NOT NULL,
  "expectedAmountPaise" INTEGER,
  CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PurchaseReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "supplierId" TEXT,
  "receiptNumber" TEXT NOT NULL,
  "supplierInvoiceNumber" TEXT,
  "idempotencyKey" TEXT,
  "totalAmount" REAL NOT NULL,
  "totalAmountPaise" INTEGER,
  "paidAmount" REAL NOT NULL DEFAULT 0,
  "paidAmountPaise" INTEGER,
  "dueAmount" REAL NOT NULL DEFAULT 0,
  "dueAmountPaise" INTEGER,
  "paymentMode" TEXT,
  "dueDate" DATETIME,
  "note" TEXT,
  "receivedByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PurchaseReceiptItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "receiptId" TEXT NOT NULL,
  "purchaseOrderItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantityBaseQty" REAL NOT NULL,
  "actualRate" REAL NOT NULL,
  "actualRatePaise" INTEGER,
  "lineAmount" REAL NOT NULL,
  "lineAmountPaise" INTEGER,
  "stockLedgerId" TEXT,
  "purchaseHistoryId" TEXT,
  CONSTRAINT "PurchaseReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReceiptItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PurchaseOrder_shopId_orderNumber_key" ON "PurchaseOrder"("shopId", "orderNumber");
CREATE INDEX "PurchaseOrder_shopId_locationId_status_createdAt_idx" ON "PurchaseOrder"("shopId", "locationId", "status", "createdAt");
CREATE INDEX "PurchaseOrder_shopId_supplierId_createdAt_idx" ON "PurchaseOrder"("shopId", "supplierId", "createdAt");
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_productId_key" ON "PurchaseOrderItem"("purchaseOrderId", "productId");
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");
CREATE UNIQUE INDEX "PurchaseReceipt_shopId_receiptNumber_key" ON "PurchaseReceipt"("shopId", "receiptNumber");
CREATE UNIQUE INDEX "PurchaseReceipt_shopId_idempotencyKey_key" ON "PurchaseReceipt"("shopId", "idempotencyKey");
CREATE INDEX "PurchaseReceipt_shopId_locationId_createdAt_idx" ON "PurchaseReceipt"("shopId", "locationId", "createdAt");
CREATE INDEX "PurchaseReceipt_shopId_purchaseOrderId_createdAt_idx" ON "PurchaseReceipt"("shopId", "purchaseOrderId", "createdAt");
CREATE UNIQUE INDEX "PurchaseReceiptItem_receiptId_purchaseOrderItemId_key" ON "PurchaseReceiptItem"("receiptId", "purchaseOrderItemId");
CREATE INDEX "PurchaseReceiptItem_productId_idx" ON "PurchaseReceiptItem"("productId");
CREATE INDEX "PurchaseHistory_shopId_purchaseOrderId_createdAt_idx" ON "PurchaseHistory"("shopId", "purchaseOrderId", "createdAt");
CREATE INDEX "PurchaseHistory_shopId_purchaseReceiptId_idx" ON "PurchaseHistory"("shopId", "purchaseReceiptId");
