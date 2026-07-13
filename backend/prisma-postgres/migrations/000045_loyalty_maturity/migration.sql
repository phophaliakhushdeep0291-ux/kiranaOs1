ALTER TABLE "LoyaltyProgram" ADD COLUMN "pointsExpireDays" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "LoyaltyProgram" ADD COLUMN "tierRulesJson" TEXT NOT NULL DEFAULT '[{"name":"Bronze","minLifetimePoints":0},{"name":"Silver","minLifetimePoints":1000},{"name":"Gold","minLifetimePoints":5000}]';
ALTER TABLE "LoyaltyAccount" ADD COLUMN "lastEarnedAt" TIMESTAMP(3);
ALTER TABLE "LoyaltyTransaction" ADD COLUMN "locationId" TEXT;
ALTER TABLE "LoyaltyTransaction" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'pos';
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LoyaltyTransaction_shopId_locationId_createdAt_idx" ON "LoyaltyTransaction"("shopId", "locationId", "createdAt");
