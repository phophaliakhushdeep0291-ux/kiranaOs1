ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseOrderId" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseOrderItemId" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseReceiptId" TEXT;

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "locationId" TEXT NOT NULL, "supplierId" TEXT,
  "orderNumber" TEXT NOT NULL, "supplierName" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "expectedOn" TIMESTAMP(3), "expectedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0, "expectedTotalPaise" BIGINT,
  "note" TEXT, "createdByUserId" TEXT, "sentAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PurchaseOrderItem" (
  "id" TEXT NOT NULL, "purchaseOrderId" TEXT NOT NULL, "productId" TEXT NOT NULL, "productName" TEXT NOT NULL,
  "baseUnit" TEXT NOT NULL, "rateUnit" TEXT NOT NULL, "orderedBaseQty" DOUBLE PRECISION NOT NULL,
  "receivedBaseQty" DOUBLE PRECISION NOT NULL DEFAULT 0, "expectedRate" DOUBLE PRECISION NOT NULL,
  "expectedRatePaise" BIGINT, "expectedAmount" DOUBLE PRECISION NOT NULL, "expectedAmountPaise" BIGINT,
  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PurchaseReceipt" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "locationId" TEXT NOT NULL, "purchaseOrderId" TEXT NOT NULL, "supplierId" TEXT,
  "receiptNumber" TEXT NOT NULL, "supplierInvoiceNumber" TEXT, "idempotencyKey" TEXT,
  "totalAmount" DOUBLE PRECISION NOT NULL, "totalAmountPaise" BIGINT, "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paidAmountPaise" BIGINT, "dueAmount" DOUBLE PRECISION NOT NULL DEFAULT 0, "dueAmountPaise" BIGINT,
  "paymentMode" TEXT, "dueDate" TIMESTAMP(3), "note" TEXT, "receivedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PurchaseReceiptItem" (
  "id" TEXT NOT NULL, "receiptId" TEXT NOT NULL, "purchaseOrderItemId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "quantityBaseQty" DOUBLE PRECISION NOT NULL, "actualRate" DOUBLE PRECISION NOT NULL, "actualRatePaise" BIGINT,
  "lineAmount" DOUBLE PRECISION NOT NULL, "lineAmountPaise" BIGINT, "stockLedgerId" TEXT, "purchaseHistoryId" TEXT,
  CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
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

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptItem" ADD CONSTRAINT "PurchaseReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD CONSTRAINT "PurchaseHistory_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD CONSTRAINT "PurchaseHistory_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD CONSTRAINT "PurchaseHistory_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
