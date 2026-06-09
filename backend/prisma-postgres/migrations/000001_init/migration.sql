-- KiranaOS PostgreSQL initial schema
-- Generated for production deployment. Local development continues to use prisma/schema.prisma with SQLite.

CREATE TABLE "Shop" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerName" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "gstNumber" TEXT,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillCounter" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mobile" TEXT,
  "email" TEXT,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'staff',
  "pinHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "aliasesJson" TEXT NOT NULL DEFAULT '[]',
  "displayUnit" TEXT NOT NULL DEFAULT 'piece',
  "baseUnit" TEXT NOT NULL DEFAULT 'piece',
  "rateUnit" TEXT NOT NULL DEFAULT 'piece',
  "stockBaseQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costPerRateUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minPricePerRateUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "defaultPricePerRateUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hsn" TEXT,
  "lowStockThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mobile" TEXT,
  "type" TEXT NOT NULL DEFAULT 'regular',
  "udharAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reminderOverrideUntil" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bill" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "billNo" TEXT NOT NULL,
  "billType" TEXT NOT NULL DEFAULT 'normal_sale',
  "status" TEXT NOT NULL DEFAULT 'active',
  "customerId" TEXT,
  "customerName" TEXT NOT NULL DEFAULT 'Walk-in',
  "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actualAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "buyerPaidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "waivedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "grossProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "creditAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cancelledAt" TIMESTAMP(3),
  "cancelledReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillItem" (
  "id" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "productId" TEXT,
  "name" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "enteredUnit" TEXT NOT NULL,
  "baseUnit" TEXT NOT NULL,
  "quantityInBaseUnit" DOUBLE PRECISION NOT NULL,
  "rateUnit" TEXT NOT NULL,
  "ratePerRateUnit" DOUBLE PRECISION NOT NULL,
  "costPerRateUnit" DOUBLE PRECISION NOT NULL,
  "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lineTotal" DOUBLE PRECISION NOT NULL,
  "lineCost" DOUBLE PRECISION NOT NULL,
  "lineProfit" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "BillItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockLedger" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "changeBaseQty" DOUBLE PRECISION NOT NULL,
  "oldStockBaseQty" DOUBLE PRECISION NOT NULL,
  "newStockBaseQty" DOUBLE PRECISION NOT NULL,
  "purchaseBillAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "calculatedBuyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "supplierName" TEXT,
  "damageLossValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "billId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UdharLedger" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "mode" TEXT NOT NULL,
  "billId" TEXT,
  "billNo" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UdharLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mobile" TEXT,
  "address" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseHistory" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierId" TEXT,
  "supplierName" TEXT NOT NULL,
  "qtyBase" DOUBLE PRECISION NOT NULL,
  "pricePerRateUnit" DOUBLE PRECISION NOT NULL,
  "totalCost" DOUBLE PRECISION NOT NULL,
  "billAmount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiActionLog" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT,
  "transcript" TEXT NOT NULL,
  "parsedActionJson" TEXT NOT NULL,
  "permissionLevel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiActionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "beforeJson" TEXT,
  "afterJson" TEXT,
  "metadataJson" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfflineSyncEvent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "requestJson" TEXT NOT NULL DEFAULT '{}',
  "resultJson" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineSyncEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillCounter_shopId_key" ON "BillCounter"("shopId");
CREATE UNIQUE INDEX "User_shopId_mobile_key" ON "User"("shopId", "mobile");
CREATE UNIQUE INDEX "User_shopId_email_key" ON "User"("shopId", "email");
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_shopId_revokedAt_idx" ON "Session"("shopId", "revokedAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Product_shopId_deletedAt_idx" ON "Product"("shopId", "deletedAt");
CREATE UNIQUE INDEX "Customer_shopId_mobile_key" ON "Customer"("shopId", "mobile");
CREATE INDEX "Customer_shopId_deletedAt_idx" ON "Customer"("shopId", "deletedAt");
CREATE UNIQUE INDEX "Bill_shopId_billNo_key" ON "Bill"("shopId", "billNo");
CREATE INDEX "Bill_shopId_status_createdAt_idx" ON "Bill"("shopId", "status", "createdAt");
CREATE INDEX "BillItem_billId_idx" ON "BillItem"("billId");
CREATE INDEX "Payment_billId_idx" ON "Payment"("billId");
CREATE INDEX "StockLedger_shopId_createdAt_idx" ON "StockLedger"("shopId", "createdAt");
CREATE INDEX "StockLedger_productId_idx" ON "StockLedger"("productId");
CREATE INDEX "UdharLedger_shopId_customerId_createdAt_idx" ON "UdharLedger"("shopId", "customerId", "createdAt");
CREATE INDEX "Supplier_shopId_idx" ON "Supplier"("shopId");
CREATE INDEX "PurchaseHistory_shopId_productId_createdAt_idx" ON "PurchaseHistory"("shopId", "productId", "createdAt");
CREATE INDEX "AiActionLog_shopId_createdAt_idx" ON "AiActionLog"("shopId", "createdAt");
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");
CREATE INDEX "AuditLog_shopId_action_createdAt_idx" ON "AuditLog"("shopId", "action", "createdAt");
CREATE UNIQUE INDEX "OfflineSyncEvent_shopId_eventId_key" ON "OfflineSyncEvent"("shopId", "eventId");
CREATE INDEX "OfflineSyncEvent_shopId_status_createdAt_idx" ON "OfflineSyncEvent"("shopId", "status", "createdAt");

CREATE INDEX "Product_shopId_updatedAt_id_idx" ON "Product"("shopId", "updatedAt", "id");
CREATE INDEX "Customer_shopId_updatedAt_id_idx" ON "Customer"("shopId", "updatedAt", "id");
CREATE INDEX "Bill_shopId_updatedAt_id_idx" ON "Bill"("shopId", "updatedAt", "id");
CREATE INDEX "StockLedger_shopId_updatedAt_id_idx" ON "StockLedger"("shopId", "updatedAt", "id");
CREATE INDEX "UdharLedger_shopId_updatedAt_id_idx" ON "UdharLedger"("shopId", "updatedAt", "id");


ALTER TABLE "BillCounter" ADD CONSTRAINT "BillCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UdharLedger" ADD CONSTRAINT "UdharLedger_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UdharLedger" ADD CONSTRAINT "UdharLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UdharLedger" ADD CONSTRAINT "UdharLedger_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD CONSTRAINT "PurchaseHistory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD CONSTRAINT "PurchaseHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseHistory" ADD CONSTRAINT "PurchaseHistory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiActionLog" ADD CONSTRAINT "AiActionLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiActionLog" ADD CONSTRAINT "AiActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OfflineSyncEvent" ADD CONSTRAINT "OfflineSyncEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
