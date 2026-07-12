-- Product-specific selling units, pack-size identity, and immutable bill pricing snapshots.
-- Existing products are backfilled with one default selling unit; no data is reset.

CREATE TABLE "ProductSellingUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "packSizeValue" REAL,
    "packSizeUnit" TEXT,
    "conversionToBase" REAL NOT NULL DEFAULT 1,
    "barcode" TEXT,
    "defaultPrice" REAL NOT NULL,
    "defaultPricePaise" BIGINT,
    "minimumPrice" REAL,
    "minimumPricePaise" BIGINT,
    "maximumPrice" REAL,
    "maximumPricePaise" BIGINT,
    "costPrice" REAL,
    "costPricePaise" BIGINT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductSellingUnit_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductSellingUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    1, 1, "createdAt", "updatedAt"
FROM "Product";

ALTER TABLE "PricingRule" ADD COLUMN "sellingUnitId" TEXT;
CREATE INDEX "PricingRule_shopId_sellingUnitId_idx" ON "PricingRule"("shopId", "sellingUnitId");

ALTER TABLE "BillItem" ADD COLUMN "sellingUnitId" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "sellingUnitCode" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "sellingUnitLabel" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "conversionToBase" REAL;
ALTER TABLE "BillItem" ADD COLUMN "originalUnitPrice" REAL;
ALTER TABLE "BillItem" ADD COLUMN "originalUnitPricePaise" BIGINT;
ALTER TABLE "BillItem" ADD COLUMN "appliedPricingRuleId" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "appliedPricingRuleType" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "pricingExplanation" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "pricingConfidence" REAL;
ALTER TABLE "BillItem" ADD COLUMN "pricingCalculationVersion" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "wasPriceOverridden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BillItem" ADD COLUMN "priceOverrideReason" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "priceApprovedByUserId" TEXT;

UPDATE "BillItem"
SET
  "sellingUnitId" = 'legacy-unit-' || "productId",
  "sellingUnitCode" = "rateUnit",
  "sellingUnitLabel" = "enteredUnit",
  "conversionToBase" = CASE WHEN "quantity" <> 0 THEN "quantityInBaseUnit" / "quantity" ELSE 1 END,
  "originalUnitPrice" = "ratePerRateUnit",
  "originalUnitPricePaise" = "ratePerRateUnitPaise",
  "pricingCalculationVersion" = 'legacy'
WHERE "productId" IS NOT NULL;

CREATE TABLE "PricingDecisionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "billId" TEXT,
    "billItemId" TEXT,
    "productId" TEXT NOT NULL,
    "sellingUnitId" TEXT,
    "customerId" TEXT,
    "customerGroup" TEXT,
    "quantity" REAL NOT NULL,
    "productCost" REAL,
    "productCostPaise" BIGINT,
    "defaultPrice" REAL NOT NULL,
    "defaultPricePaise" BIGINT,
    "recommendedPrice" REAL NOT NULL,
    "recommendedPricePaise" BIGINT,
    "finalAcceptedPrice" REAL NOT NULL,
    "finalAcceptedPricePaise" BIGINT,
    "appliedRuleId" TEXT,
    "recommendationSource" TEXT NOT NULL,
    "confidence" REAL,
    "wasOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "reusableDecision" BOOLEAN NOT NULL DEFAULT true,
    "oneTimeSpecialPrice" BOOLEAN NOT NULL DEFAULT false,
    "excludedFromLearning" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "decidedByUserId" TEXT,
    "deviceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingDecisionEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PricingDecisionEvent_shopId_productId_customerId_idx" ON "PricingDecisionEvent"("shopId", "productId", "customerId");
CREATE INDEX "PricingDecisionEvent_shopId_productId_sellingUnitId_idx" ON "PricingDecisionEvent"("shopId", "productId", "sellingUnitId");
CREATE INDEX "PricingDecisionEvent_shopId_createdAt_idx" ON "PricingDecisionEvent"("shopId", "createdAt");
