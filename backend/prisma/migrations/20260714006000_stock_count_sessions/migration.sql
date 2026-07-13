CREATE TABLE "StockCountSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "activeKey" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'counting',
  "blindCount" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "submittedAt" DATETIME,
  "appliedAt" DATETIME,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StockCountSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockCountSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StockCountSession_activeKey_key" ON "StockCountSession"("activeKey");
CREATE INDEX "StockCountSession_shopId_locationId_status_createdAt_idx" ON "StockCountSession"("shopId", "locationId", "status", "createdAt");

CREATE TABLE "StockCountLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "baseUnit" TEXT NOT NULL,
  "expectedBaseQty" REAL NOT NULL,
  "countedBaseQty" REAL,
  "varianceBaseQty" REAL,
  "reason" TEXT,
  "countedByUserId" TEXT,
  "countedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StockCountLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StockCountSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StockCountLine_sessionId_productId_key" ON "StockCountLine"("sessionId", "productId");
CREATE INDEX "StockCountLine_productId_idx" ON "StockCountLine"("productId");
