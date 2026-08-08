-- @replay-safe: every schema statement is guarded; the snapshot backfill is
-- deterministic and may be repeated after an interrupted deployment.
ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "lockedPriceMonthlyPaise" INTEGER,
  ADD COLUMN IF NOT EXISTS "lockedPriceYearlyPaise" INTEGER,
  ADD COLUMN IF NOT EXISTS "entitledFeaturesJson" TEXT,
  ADD COLUMN IF NOT EXISTS "intendedPaidPlanCode" TEXT;

UPDATE "Subscription" s
SET "lockedPriceMonthlyPaise" = p."priceMonthlyPaise",
    "lockedPriceYearlyPaise" = p."priceYearlyPaise",
    "entitledFeaturesJson" = p."featuresJson"
FROM "Plan" p WHERE p."code" = s."planCode";

CREATE TABLE IF NOT EXISTS "OnboardingPurchase" (
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
CREATE INDEX IF NOT EXISTS "OnboardingPurchase_shopId_createdAt_idx" ON "OnboardingPurchase"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "OnboardingPurchase_sku_status_idx" ON "OnboardingPurchase"("sku", "status");
