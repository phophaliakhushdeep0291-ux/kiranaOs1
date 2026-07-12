-- Smart Adaptive Pricing Engine: owner-defined pricing rules + customer groups.
ALTER TABLE "Customer" ADD COLUMN "customerGroup" TEXT;

CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "minQuantity" REAL,
    "maxQuantity" REAL,
    "fixedUnitPrice" REAL,
    "adjustmentType" TEXT,
    "adjustmentValue" REAL,
    "minimumMarginPercent" REAL,
    "paymentMethod" TEXT,
    "combinePolicy" TEXT,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "requiresOwnerApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PricingRule_shopId_status_priority_idx" ON "PricingRule"("shopId", "status", "priority");
CREATE INDEX "PricingRule_shopId_productId_idx" ON "PricingRule"("shopId", "productId");
CREATE INDEX "PricingRule_shopId_customerId_idx" ON "PricingRule"("shopId", "customerId");
CREATE INDEX "PricingRule_shopId_customerGroup_idx" ON "PricingRule"("shopId", "customerGroup");
CREATE INDEX "PricingRule_shopId_updatedAt_id_idx" ON "PricingRule"("shopId", "updatedAt", "id");
