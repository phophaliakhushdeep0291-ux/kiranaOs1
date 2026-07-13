ALTER TABLE "LoyaltyProgram" ADD COLUMN "pointsExpireDays" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "LoyaltyProgram" ADD COLUMN "tierRulesJson" TEXT NOT NULL DEFAULT '[{"name":"Bronze","minLifetimePoints":0},{"name":"Silver","minLifetimePoints":1000},{"name":"Gold","minLifetimePoints":5000}]';
ALTER TABLE "LoyaltyAccount" ADD COLUMN "lastEarnedAt" DATETIME;
ALTER TABLE "LoyaltyTransaction" ADD COLUMN "locationId" TEXT;
ALTER TABLE "LoyaltyTransaction" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'pos';
CREATE INDEX "LoyaltyTransaction_shopId_locationId_createdAt_idx" ON "LoyaltyTransaction"("shopId", "locationId", "createdAt");
