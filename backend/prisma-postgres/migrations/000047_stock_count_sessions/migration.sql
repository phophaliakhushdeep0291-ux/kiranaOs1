CREATE TABLE "StockCountSession" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "activeKey" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'counting',
  "blindCount" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockCountSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockCountSession_activeKey_key" ON "StockCountSession"("activeKey");
CREATE INDEX "StockCountSession_shopId_locationId_status_createdAt_idx" ON "StockCountSession"("shopId", "locationId", "status", "createdAt");

CREATE TABLE "StockCountLine" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "baseUnit" TEXT NOT NULL,
  "expectedBaseQty" DOUBLE PRECISION NOT NULL,
  "countedBaseQty" DOUBLE PRECISION,
  "varianceBaseQty" DOUBLE PRECISION,
  "reason" TEXT,
  "countedByUserId" TEXT,
  "countedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockCountLine_sessionId_productId_key" ON "StockCountLine"("sessionId", "productId");
CREATE INDEX "StockCountLine_productId_idx" ON "StockCountLine"("productId");
ALTER TABLE "StockCountSession" ADD CONSTRAINT "StockCountSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockCountSession" ADD CONSTRAINT "StockCountSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StockCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
