-- Product-specific selling units, pack-size identity, and immutable bill pricing snapshots.
-- Existing products are backfilled with one default selling unit; no product or bill data is reset.

CREATE TABLE "ProductSellingUnit" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "packSizeValue" DOUBLE PRECISION,
    "packSizeUnit" TEXT,
    "conversionToBase" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "barcode" TEXT,
    "defaultPrice" DOUBLE PRECISION NOT NULL,
    "defaultPricePaise" BIGINT,
    "minimumPrice" DOUBLE PRECISION,
    "minimumPricePaise" BIGINT,
    "maximumPrice" DOUBLE PRECISION,
    "maximumPricePaise" BIGINT,
    "costPrice" DOUBLE PRECISION,
    "costPricePaise" BIGINT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductSellingUnit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductSellingUnit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductSellingUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductSellingUnit_shopId_productId_unitCode_key" ON "ProductSellingUnit"("shopId", "productId", "unitCode");
CREATE INDEX "ProductSellingUnit_shopId_productId_isActive_idx" ON "ProductSellingUnit"("shopId", "productId", "isActive");
CREATE INDEX "ProductSellingUnit_shopId_barcode_idx" ON "ProductSellingUnit"("shopId", "barcode");
CREATE INDEX "ProductSellingUnit_shopId_updatedAt_id_idx" ON "ProductSellingUnit"("shopId", "updatedAt", "id");

INSERT INTO "ProductSellingUnit" (
    "id", "shopId", "productId", "name", "unitType", "unitCode",
    "conversionToBase", "barcode", "defaultPrice", "defaultPricePaise",
    "minimumPrice", "minimumPricePaise", "maximumPrice", "costPrice",
    "costPricePaise", "isDefault", "isActive", "createdAt", "updatedAt"
)
SELECT
    'legacy-unit-' || "id", "shopId", "id", "rateUnit", "rateUnit", "rateUnit",
    CASE
      WHEN lower("rateUnit") IN ('kg', 'kilogram') AND lower("baseUnit") IN ('g', 'gram') THEN 1000
      WHEN lower("rateUnit") IN ('litre', 'liter', 'l') AND lower("baseUnit") = 'ml' THEN 1000
      WHEN lower("rateUnit") = 'dozen' AND lower("baseUnit") = 'piece' THEN 12
      ELSE 1
    END,
    "barcode", "defaultPricePerRateUnit", "defaultPricePerRateUnitPaise",
    NULLIF("minPricePerRateUnit", 0), "minPricePerRateUnitPaise",
    NULLIF("mrp", 0), "costPerRateUnit", "costPerRateUnitPaise",
    true, true, "createdAt", "updatedAt"
FROM "Product";

ALTER TABLE "PricingRule" ADD COLUMN "sellingUnitId" TEXT;
CREATE INDEX "PricingRule_shopId_sellingUnitId_idx" ON "PricingRule"("shopId", "sellingUnitId");
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_sellingUnitId_fkey" FOREIGN KEY ("sellingUnitId") REFERENCES "ProductSellingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillItem" ADD COLUMN "sellingUnitId" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "sellingUnitCode" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "sellingUnitLabel" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "conversionToBase" DOUBLE PRECISION;
ALTER TABLE "BillItem" ADD COLUMN "originalUnitPrice" DOUBLE PRECISION;
ALTER TABLE "BillItem" ADD COLUMN "originalUnitPricePaise" BIGINT;
ALTER TABLE "BillItem" ADD COLUMN "appliedPricingRuleId" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "appliedPricingRuleType" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "pricingExplanation" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "pricingConfidence" DOUBLE PRECISION;
ALTER TABLE "BillItem" ADD COLUMN "pricingCalculationVersion" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "wasPriceOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BillItem" ADD COLUMN "priceOverrideReason" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "priceApprovedByUserId" TEXT;
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_sellingUnitId_fkey" FOREIGN KEY ("sellingUnitId") REFERENCES "ProductSellingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "BillItem" AS bi
SET
  "sellingUnitId" = 'legacy-unit-' || bi."productId",
  "sellingUnitCode" = bi."rateUnit",
  "sellingUnitLabel" = bi."enteredUnit",
  "conversionToBase" = CASE WHEN bi."quantity" <> 0 THEN bi."quantityInBaseUnit" / bi."quantity" ELSE 1 END,
  "originalUnitPrice" = bi."ratePerRateUnit",
  "originalUnitPricePaise" = bi."ratePerRateUnitPaise",
  "pricingCalculationVersion" = 'legacy'
WHERE bi."productId" IS NOT NULL;

CREATE TABLE "PricingDecisionEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "billId" TEXT,
    "billItemId" TEXT,
    "productId" TEXT NOT NULL,
    "sellingUnitId" TEXT,
    "customerId" TEXT,
    "customerGroup" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "productCost" DOUBLE PRECISION,
    "productCostPaise" BIGINT,
    "defaultPrice" DOUBLE PRECISION NOT NULL,
    "defaultPricePaise" BIGINT,
    "recommendedPrice" DOUBLE PRECISION NOT NULL,
    "recommendedPricePaise" BIGINT,
    "finalAcceptedPrice" DOUBLE PRECISION NOT NULL,
    "finalAcceptedPricePaise" BIGINT,
    "appliedRuleId" TEXT,
    "recommendationSource" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "wasOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "reusableDecision" BOOLEAN NOT NULL DEFAULT true,
    "oneTimeSpecialPrice" BOOLEAN NOT NULL DEFAULT false,
    "excludedFromLearning" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "decidedByUserId" TEXT,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingDecisionEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PricingDecisionEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PricingDecisionEvent_shopId_productId_customerId_idx" ON "PricingDecisionEvent"("shopId", "productId", "customerId");
CREATE INDEX "PricingDecisionEvent_shopId_productId_sellingUnitId_idx" ON "PricingDecisionEvent"("shopId", "productId", "sellingUnitId");
CREATE INDEX "PricingDecisionEvent_shopId_createdAt_idx" ON "PricingDecisionEvent"("shopId", "createdAt");
