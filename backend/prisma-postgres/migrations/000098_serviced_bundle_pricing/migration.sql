ALTER TABLE "Subscription"
  ADD COLUMN "lockedPriceMonthlyPaise" INTEGER,
  ADD COLUMN "lockedPriceYearlyPaise" INTEGER,
  ADD COLUMN "entitledFeaturesJson" TEXT,
  ADD COLUMN "intendedPaidPlanCode" TEXT;

UPDATE "Subscription" s
SET "lockedPriceMonthlyPaise" = p."priceMonthlyPaise",
    "lockedPriceYearlyPaise" = p."priceYearlyPaise",
    "entitledFeaturesJson" = p."featuresJson"
FROM "Plan" p WHERE p."code" = s."planCode";

CREATE TABLE "OnboardingPurchase" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT 'FIRST_YEAR_ONBOARDING',
  "amountPaise" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "includesJson" TEXT NOT NULL DEFAULT '[]',
  "recordedByUserId" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnboardingPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OnboardingPurchase_shopId_createdAt_idx" ON "OnboardingPurchase"("shopId", "createdAt");
CREATE INDEX "OnboardingPurchase_sku_status_idx" ON "OnboardingPurchase"("sku", "status");
