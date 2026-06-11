-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT NOT NULL DEFAULT 'percentage',
    "value" REAL NOT NULL DEFAULT 0,
    "minBillAmount" REAL NOT NULL DEFAULT 0,
    "maxDiscount" REAL NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "scopeValue" TEXT,
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "usageLimit" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Offer_shopId_idx" ON "Offer"("shopId");

-- CreateIndex
CREATE INDEX "Offer_shopId_deletedAt_idx" ON "Offer"("shopId", "deletedAt");

-- CreateIndex
CREATE INDEX "Offer_shopId_active_idx" ON "Offer"("shopId", "active");

-- CreateIndex
CREATE INDEX "Offer_shopId_updatedAt_id_idx" ON "Offer"("shopId", "updatedAt", "id");
