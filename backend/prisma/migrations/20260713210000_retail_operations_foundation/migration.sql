CREATE TABLE "StoreLocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "city" TEXT,
  "gstNumber" TEXT,
  "phone" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StoreLocation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StoreLocation_shopId_code_key" ON "StoreLocation"("shopId", "code");
CREATE INDEX "StoreLocation_shopId_active_createdAt_idx" ON "StoreLocation"("shopId", "active", "createdAt");
CREATE INDEX "StoreLocation_shopId_isPrimary_idx" ON "StoreLocation"("shopId", "isPrimary");

CREATE TABLE "LocationStock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "stockBaseQty" REAL NOT NULL DEFAULT 0,
  "lowStockThreshold" REAL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LocationStock_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LocationStock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LocationStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocationStock_locationId_productId_key" ON "LocationStock"("locationId", "productId");
CREATE INDEX "LocationStock_shopId_productId_idx" ON "LocationStock"("shopId", "productId");

CREATE TABLE "StockTransfer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "referenceNo" TEXT NOT NULL,
  "fromLocationId" TEXT NOT NULL,
  "toLocationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "note" TEXT,
  "createdByUserId" TEXT,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StockTransfer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "StoreLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "StoreLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StockTransfer_shopId_referenceNo_key" ON "StockTransfer"("shopId", "referenceNo");
CREATE INDEX "StockTransfer_shopId_createdAt_idx" ON "StockTransfer"("shopId", "createdAt");
CREATE INDEX "StockTransfer_shopId_status_createdAt_idx" ON "StockTransfer"("shopId", "status", "createdAt");

CREATE TABLE "StockTransferItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "transferId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "quantityBaseQty" REAL NOT NULL,
  "baseUnit" TEXT NOT NULL,
  CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StockTransferItem_transferId_productId_key" ON "StockTransferItem"("transferId", "productId");
CREATE INDEX "StockTransferItem_productId_idx" ON "StockTransferItem"("productId");

CREATE TABLE "LoyaltyProgram" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "pointsPerRupee" REAL NOT NULL DEFAULT 1,
  "redemptionPaisePerPoint" INTEGER NOT NULL DEFAULT 25,
  "minimumRedeemPoints" INTEGER NOT NULL DEFAULT 100,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LoyaltyProgram_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LoyaltyProgram_shopId_key" ON "LoyaltyProgram"("shopId");

CREATE TABLE "LoyaltyAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "pointsBalance" INTEGER NOT NULL DEFAULT 0,
  "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
  "lifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LoyaltyAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LoyaltyAccount_customerId_key" ON "LoyaltyAccount"("customerId");
CREATE INDEX "LoyaltyAccount_shopId_pointsBalance_idx" ON "LoyaltyAccount"("shopId", "pointsBalance");

CREATE TABLE "LoyaltyTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "billId" TEXT,
  "type" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyTransaction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyTransaction_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LoyaltyTransaction_billId_type_key" ON "LoyaltyTransaction"("billId", "type");
CREATE INDEX "LoyaltyTransaction_shopId_createdAt_idx" ON "LoyaltyTransaction"("shopId", "createdAt");
CREATE INDEX "LoyaltyTransaction_accountId_createdAt_idx" ON "LoyaltyTransaction"("accountId", "createdAt");

CREATE TABLE "ComplianceDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "externalReference" TEXT,
  "acknowledgementNo" TEXT,
  "payloadHash" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "responseJson" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ComplianceDocument_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ComplianceDocument_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ComplianceDocument_billId_documentType_key" ON "ComplianceDocument"("billId", "documentType");
CREATE INDEX "ComplianceDocument_shopId_documentType_status_createdAt_idx" ON "ComplianceDocument"("shopId", "documentType", "status", "createdAt");

ALTER TABLE "Customer" ADD COLUMN "address" TEXT;
ALTER TABLE "Customer" ADD COLUMN "gstNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN "stateCode" TEXT;
ALTER TABLE "Bill" ADD COLUMN "buyerGstin" TEXT;
ALTER TABLE "Bill" ADD COLUMN "buyerStateCode" TEXT;
ALTER TABLE "Bill" ADD COLUMN "buyerAddress" TEXT;
