-- @replay-safe: every statement below is idempotent (IF NOT EXISTS guards, and a
-- DROP CONSTRAINT IF EXISTS before each ADD CONSTRAINT), so if this migration
-- fails mid-transaction the deploy script (scripts/deploy-postgres-migrations.js)
-- can mark it rolled-back and replay it without double-applying. The UPDATE
-- backfills are naturally re-runnable (they set from source-of-truth / COALESCE).
-- Keep it idempotent if you edit it.
-- Multi-GSTIN location identity, immutable bill seller snapshots, and auditable transfer documents.
ALTER TABLE "StoreLocation"
  ADD COLUMN IF NOT EXISTS "gstStateCode" TEXT,
  ADD COLUMN IF NOT EXISTS "gstLegalName" TEXT,
  ADD COLUMN IF NOT EXISTS "gstTradeName" TEXT,
  ADD COLUMN IF NOT EXISTS "gstRegistrationType" TEXT;

UPDATE "StoreLocation" AS location
SET "gstStateCode" = CASE WHEN LENGTH(BTRIM(COALESCE(location."gstNumber", ''))) = 15 THEN SUBSTRING(BTRIM(location."gstNumber") FROM 1 FOR 2) END,
    "gstLegalName" = COALESCE(location."gstLegalName", shop."name"),
    "gstTradeName" = COALESCE(location."gstTradeName", location."name")
FROM "Shop" AS shop
WHERE shop."id" = location."shopId";

ALTER TABLE "Bill"
  ADD COLUMN IF NOT EXISTS "sellerGstin" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerStateCode" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerLegalName" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerTradeName" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerCity" TEXT;

UPDATE "Bill" AS bill
SET "sellerGstin" = COALESCE((SELECT location."gstNumber" FROM "StoreLocation" AS location WHERE location."id" = bill."locationId"), shop."gstNumber"),
    "sellerStateCode" = COALESCE((SELECT location."gstStateCode" FROM "StoreLocation" AS location WHERE location."id" = bill."locationId"), SUBSTRING(COALESCE(shop."gstNumber", '') FROM 1 FOR 2)),
    "sellerLegalName" = COALESCE((SELECT location."gstLegalName" FROM "StoreLocation" AS location WHERE location."id" = bill."locationId"), shop."name"),
    "sellerTradeName" = COALESCE((SELECT COALESCE(location."gstTradeName", location."name") FROM "StoreLocation" AS location WHERE location."id" = bill."locationId"), shop."name"),
    "sellerAddress" = COALESCE((SELECT location."address" FROM "StoreLocation" AS location WHERE location."id" = bill."locationId"), shop."address"),
    "sellerCity" = COALESCE((SELECT location."city" FROM "StoreLocation" AS location WHERE location."id" = bill."locationId"), shop."city")
FROM "Shop" AS shop
WHERE shop."id" = bill."shopId";

ALTER TABLE "StockTransfer"
  ADD COLUMN IF NOT EXISTS "movementReason" TEXT NOT NULL DEFAULT 'branch_transfer',
  ADD COLUMN IF NOT EXISTS "documentType" TEXT,
  ADD COLUMN IF NOT EXISTS "documentNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "documentDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gstTreatment" TEXT NOT NULL DEFAULT 'unregistered_internal',
  ADD COLUMN IF NOT EXISTS "fromGstin" TEXT,
  ADD COLUMN IF NOT EXISTS "fromStateCode" TEXT,
  ADD COLUMN IF NOT EXISTS "toGstin" TEXT,
  ADD COLUMN IF NOT EXISTS "toStateCode" TEXT,
  ADD COLUMN IF NOT EXISTS "isInterstate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "complianceStatus" TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS "eWayReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxableValuePaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cgstPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sgstPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "igstPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxTotalPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "consignmentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "consignmentValuePaise" BIGINT;

UPDATE "StockTransfer" AS transfer
SET "fromGstin" = source."gstNumber",
    "fromStateCode" = source."gstStateCode",
    "toGstin" = destination."gstNumber",
    "toStateCode" = destination."gstStateCode",
    "gstTreatment" = CASE
      WHEN source."gstNumber" IS NULL OR destination."gstNumber" IS NULL THEN 'unregistered_internal'
      WHEN source."gstNumber" = destination."gstNumber" THEN 'same_registration_movement'
      ELSE 'distinct_registration_supply'
    END,
    "isInterstate" = CASE
      WHEN source."gstStateCode" IS NOT NULL AND destination."gstStateCode" IS NOT NULL AND source."gstStateCode" <> destination."gstStateCode" THEN true ELSE false
    END,
    "complianceStatus" = CASE
      WHEN source."gstNumber" IS NULL OR destination."gstNumber" IS NULL THEN 'not_applicable'
      ELSE 'legacy_review_required'
    END
FROM "StoreLocation" AS source, "StoreLocation" AS destination
WHERE source."id" = transfer."fromLocationId" AND destination."id" = transfer."toLocationId";

ALTER TABLE "StockTransferItem"
  ADD COLUMN IF NOT EXISTS "hsn" TEXT,
  ADD COLUMN IF NOT EXISTS "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "declaredValuePerBaseUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "declaredValuePerBaseUnitPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxableValuePaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cgstPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sgstPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "igstPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxTotalPaise" BIGINT,
  ADD COLUMN IF NOT EXISTS "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalValuePaise" BIGINT;

UPDATE "StockTransferItem" AS item
SET "hsn" = product."hsn",
    "gstRate" = product."gstRate"
FROM "Product" AS product
WHERE product."id" = item."productId";
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_shopId_documentType_documentNumber_key"
ON "StockTransfer"("shopId", "documentType", "documentNumber");

CREATE TABLE IF NOT EXISTS "TransferDocumentCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransferDocumentCounter_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TransferDocumentCounter" DROP CONSTRAINT IF EXISTS "TransferDocumentCounter_shopId_fkey";
ALTER TABLE "TransferDocumentCounter" ADD CONSTRAINT "TransferDocumentCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "TransferDocumentCounter_shopId_fiscalYear_documentType_key"
ON "TransferDocumentCounter"("shopId", "fiscalYear", "documentType");
CREATE INDEX IF NOT EXISTS "TransferDocumentCounter_shopId_updatedAt_idx"
ON "TransferDocumentCounter"("shopId", "updatedAt");
