-- CreateTable
CREATE TABLE IF NOT EXISTS "Offer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT NOT NULL DEFAULT 'percentage',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minBillAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "scopeValue" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "usageLimit" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Offer_shopId_idx" ON "Offer"("shopId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Offer_shopId_deletedAt_idx" ON "Offer"("shopId", "deletedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Offer_shopId_active_idx" ON "Offer"("shopId", "active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Offer_shopId_updatedAt_id_idx" ON "Offer"("shopId", "updatedAt", "id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Offer" ADD CONSTRAINT "Offer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
