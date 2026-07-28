-- Multi-GSTIN location identity, immutable bill seller snapshots, and auditable transfer documents.
ALTER TABLE "StoreLocation"
  ADD COLUMN "gstStateCode" TEXT,
  ADD COLUMN "gstLegalName" TEXT,
  ADD COLUMN "gstTradeName" TEXT,
  ADD COLUMN "gstRegistrationType" TEXT;

UPDATE "StoreLocation" AS location
SET "gstStateCode" = CASE WHEN LENGTH(BTRIM(COALESCE(location."gstNumber", ''))) = 15 THEN SUBSTRING(BTRIM(location."gstNumber") FROM 1 FOR 2) END,
    "gstLegalName" = COALESCE(location."gstLegalName", shop."name"),
    "gstTradeName" = COALESCE(location."gstTradeName", location."name")
FROM "Shop" AS shop
WHERE shop."id" = location."shopId";

ALTER TABLE "Bill"
  ADD COLUMN "sellerGstin" TEXT,
  ADD COLUMN "sellerStateCode" TEXT,
  ADD COLUMN "sellerLegalName" TEXT,
  ADD COLUMN "sellerTradeName" TEXT,
  ADD COLUMN "sellerAddress" TEXT,
  ADD COLUMN "sellerCity" TEXT;

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
  ADD COLUMN "movementReason" TEXT NOT NULL DEFAULT 'branch_transfer',
  ADD COLUMN "documentType" TEXT,
  ADD COLUMN "documentNumber" TEXT,
  ADD COLUMN "documentDate" TIMESTAMP(3),
  ADD COLUMN "gstTreatment" TEXT NOT NULL DEFAULT 'unregistered_internal',
  ADD COLUMN "fromGstin" TEXT,
  ADD COLUMN "fromStateCode" TEXT,
  ADD COLUMN "toGstin" TEXT,
  ADD COLUMN "toStateCode" TEXT,
  ADD COLUMN "isInterstate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "complianceStatus" TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN "eWayReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "taxableValuePaise" BIGINT,
  ADD COLUMN "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "cgstPaise" BIGINT,
  ADD COLUMN "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "sgstPaise" BIGINT,
  ADD COLUMN "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "igstPaise" BIGINT,
  ADD COLUMN "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "taxTotalPaise" BIGINT,
  ADD COLUMN "consignmentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "consignmentValuePaise" BIGINT;

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
  ADD COLUMN "hsn" TEXT,
  ADD COLUMN "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "declaredValuePerBaseUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "declaredValuePerBaseUnitPaise" BIGINT,
  ADD COLUMN "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "taxableValuePaise" BIGINT,
  ADD COLUMN "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "cgstPaise" BIGINT,
  ADD COLUMN "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "sgstPaise" BIGINT,
  ADD COLUMN "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "igstPaise" BIGINT,
  ADD COLUMN "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "taxTotalPaise" BIGINT,
  ADD COLUMN "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "totalValuePaise" BIGINT;

UPDATE "StockTransferItem" AS item
SET "hsn" = product."hsn",
    "gstRate" = product."gstRate"
FROM "Product" AS product
WHERE product."id" = item."productId";
CREATE UNIQUE INDEX "StockTransfer_shopId_documentType_documentNumber_key"
ON "StockTransfer"("shopId", "documentType", "documentNumber");

CREATE TABLE "TransferDocumentCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransferDocumentCounter_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TransferDocumentCounter" ADD CONSTRAINT "TransferDocumentCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TransferDocumentCounter_shopId_fiscalYear_documentType_key"
ON "TransferDocumentCounter"("shopId", "fiscalYear", "documentType");
CREATE INDEX "TransferDocumentCounter_shopId_updatedAt_idx"
ON "TransferDocumentCounter"("shopId", "updatedAt");