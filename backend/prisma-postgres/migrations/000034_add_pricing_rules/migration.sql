-- Smart Adaptive Pricing Engine: owner-defined pricing rules + customer groups.
ALTER TABLE "Customer" ADD COLUMN "customerGroup" TEXT;

CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "unitCode" TEXT,
    "customerId" TEXT,
    "customerGroup" TEXT,
    "minQuantity" DOUBLE PRECISION,
    "maxQuantity" DOUBLE PRECISION,
    "fixedUnitPrice" DOUBLE PRECISION,
    "adjustmentType" TEXT,
    "adjustmentValue" DOUBLE PRECISION,
    "minimumMarginPercent" DOUBLE PRECISION,
    "paymentMethod" TEXT,
    "combinePolicy" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "requiresOwnerApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PricingRule_shopId_status_priority_idx" ON "PricingRule"("shopId", "status", "priority");
CREATE INDEX "PricingRule_shopId_productId_idx" ON "PricingRule"("shopId", "productId");
CREATE INDEX "PricingRule_shopId_customerId_idx" ON "PricingRule"("shopId", "customerId");
CREATE INDEX "PricingRule_shopId_customerGroup_idx" ON "PricingRule"("shopId", "customerGroup");
CREATE INDEX "PricingRule_shopId_updatedAt_id_idx" ON "PricingRule"("shopId", "updatedAt", "id");
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
