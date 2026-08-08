ALTER TABLE "Subscription" ADD COLUMN "lockedPriceMonthlyPaise" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN "lockedPriceYearlyPaise" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN "entitledFeaturesJson" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "intendedPaidPlanCode" TEXT;

UPDATE "Subscription"
SET "lockedPriceMonthlyPaise" = (SELECT "priceMonthlyPaise" FROM "Plan" WHERE "Plan"."code" = "Subscription"."planCode"),
    "lockedPriceYearlyPaise" = (SELECT "priceYearlyPaise" FROM "Plan" WHERE "Plan"."code" = "Subscription"."planCode"),
    "entitledFeaturesJson" = (SELECT "featuresJson" FROM "Plan" WHERE "Plan"."code" = "Subscription"."planCode");

CREATE TABLE "OnboardingPurchase" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT 'FIRST_YEAR_ONBOARDING',
  "amountPaise" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "includesJson" TEXT NOT NULL DEFAULT '[]',
  "recordedByUserId" TEXT,
  "deliveredAt" DATETIME,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OnboardingPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OnboardingPurchase_shopId_createdAt_idx" ON "OnboardingPurchase"("shopId", "createdAt");
CREATE INDEX "OnboardingPurchase_sku_status_idx" ON "OnboardingPurchase"("sku", "status");
