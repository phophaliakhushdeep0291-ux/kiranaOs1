-- Multi-GSTIN location identity, immutable bill seller snapshots, and auditable transfer documents.
ALTER TABLE "StoreLocation" ADD COLUMN "gstStateCode" TEXT;
ALTER TABLE "StoreLocation" ADD COLUMN "gstLegalName" TEXT;
ALTER TABLE "StoreLocation" ADD COLUMN "gstTradeName" TEXT;
ALTER TABLE "StoreLocation" ADD COLUMN "gstRegistrationType" TEXT;

UPDATE "StoreLocation"
SET "gstStateCode" = CASE WHEN LENGTH(TRIM(COALESCE("gstNumber", ''))) = 15 THEN SUBSTR(TRIM("gstNumber"), 1, 2) END,
    "gstLegalName" = COALESCE("gstLegalName", (SELECT "name" FROM "Shop" WHERE "Shop"."id" = "StoreLocation"."shopId")),
    "gstTradeName" = COALESCE("gstTradeName", "name");

ALTER TABLE "Bill" ADD COLUMN "sellerGstin" TEXT;
ALTER TABLE "Bill" ADD COLUMN "sellerStateCode" TEXT;
ALTER TABLE "Bill" ADD COLUMN "sellerLegalName" TEXT;
ALTER TABLE "Bill" ADD COLUMN "sellerTradeName" TEXT;
ALTER TABLE "Bill" ADD COLUMN "sellerAddress" TEXT;
ALTER TABLE "Bill" ADD COLUMN "sellerCity" TEXT;

UPDATE "Bill"
SET "sellerGstin" = COALESCE(
      (SELECT "gstNumber" FROM "StoreLocation" WHERE "StoreLocation"."id" = "Bill"."locationId"),
      (SELECT "gstNumber" FROM "Shop" WHERE "Shop"."id" = "Bill"."shopId")
    ),
    "sellerStateCode" = COALESCE(
      (SELECT "gstStateCode" FROM "StoreLocation" WHERE "StoreLocation"."id" = "Bill"."locationId"),
      SUBSTR(COALESCE((SELECT "gstNumber" FROM "Shop" WHERE "Shop"."id" = "Bill"."shopId"), ''), 1, 2)
    ),
    "sellerLegalName" = COALESCE(
      (SELECT "gstLegalName" FROM "StoreLocation" WHERE "StoreLocation"."id" = "Bill"."locationId"),
      (SELECT "name" FROM "Shop" WHERE "Shop"."id" = "Bill"."shopId")
    ),
    "sellerTradeName" = COALESCE(
      (SELECT "gstTradeName" FROM "StoreLocation" WHERE "StoreLocation"."id" = "Bill"."locationId"),
      (SELECT "name" FROM "StoreLocation" WHERE "StoreLocation"."id" = "Bill"."locationId"),
      (SELECT "name" FROM "Shop" WHERE "Shop"."id" = "Bill"."shopId")
    ),
    "sellerAddress" = COALESCE(
      (SELECT "address" FROM "StoreLocation" WHERE "StoreLocation"."id" = "Bill"."locationId"),
      (SELECT "address" FROM "Shop" WHERE "Shop"."id" = "Bill"."shopId")
    ),
    "sellerCity" = COALESCE(
      (SELECT "city" FROM "StoreLocation" WHERE "StoreLocation"."id" = "Bill"."locationId"),
      (SELECT "city" FROM "Shop" WHERE "Shop"."id" = "Bill"."shopId")
    );

ALTER TABLE "StockTransfer" ADD COLUMN "movementReason" TEXT NOT NULL DEFAULT 'branch_transfer';
ALTER TABLE "StockTransfer" ADD COLUMN "documentType" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "documentNumber" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "documentDate" DATETIME;
ALTER TABLE "StockTransfer" ADD COLUMN "gstTreatment" TEXT NOT NULL DEFAULT 'unregistered_internal';
ALTER TABLE "StockTransfer" ADD COLUMN "fromGstin" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "fromStateCode" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "toGstin" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "toStateCode" TEXT;
ALTER TABLE "StockTransfer" ADD COLUMN "isInterstate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StockTransfer" ADD COLUMN "complianceStatus" TEXT NOT NULL DEFAULT 'not_applicable';
ALTER TABLE "StockTransfer" ADD COLUMN "eWayReviewRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StockTransfer" ADD COLUMN "taxableValue" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransfer" ADD COLUMN "taxableValuePaise" BIGINT;
ALTER TABLE "StockTransfer" ADD COLUMN "cgst" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransfer" ADD COLUMN "cgstPaise" BIGINT;
ALTER TABLE "StockTransfer" ADD COLUMN "sgst" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransfer" ADD COLUMN "sgstPaise" BIGINT;
ALTER TABLE "StockTransfer" ADD COLUMN "igst" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransfer" ADD COLUMN "igstPaise" BIGINT;
ALTER TABLE "StockTransfer" ADD COLUMN "taxTotal" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransfer" ADD COLUMN "taxTotalPaise" BIGINT;
ALTER TABLE "StockTransfer" ADD COLUMN "consignmentValue" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransfer" ADD COLUMN "consignmentValuePaise" BIGINT;

UPDATE "StockTransfer"
SET "fromGstin" = (SELECT "gstNumber" FROM "StoreLocation" WHERE "StoreLocation"."id" = "StockTransfer"."fromLocationId"),
    "fromStateCode" = (SELECT "gstStateCode" FROM "StoreLocation" WHERE "StoreLocation"."id" = "StockTransfer"."fromLocationId"),
    "toGstin" = (SELECT "gstNumber" FROM "StoreLocation" WHERE "StoreLocation"."id" = "StockTransfer"."toLocationId"),
    "toStateCode" = (SELECT "gstStateCode" FROM "StoreLocation" WHERE "StoreLocation"."id" = "StockTransfer"."toLocationId");

UPDATE "StockTransfer"
SET "gstTreatment" = CASE
      WHEN "fromGstin" IS NULL OR "toGstin" IS NULL THEN 'unregistered_internal'
      WHEN "fromGstin" = "toGstin" THEN 'same_registration_movement'
      ELSE 'distinct_registration_supply'
    END,
    "isInterstate" = CASE
      WHEN "fromStateCode" IS NOT NULL AND "toStateCode" IS NOT NULL AND "fromStateCode" <> "toStateCode" THEN true ELSE false
    END,
    "complianceStatus" = CASE
      WHEN "fromGstin" IS NULL OR "toGstin" IS NULL THEN 'not_applicable'
      ELSE 'legacy_review_required'
    END;

ALTER TABLE "StockTransferItem" ADD COLUMN "hsn" TEXT;
ALTER TABLE "StockTransferItem" ADD COLUMN "gstRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "declaredValuePerBaseUnit" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "declaredValuePerBaseUnitPaise" BIGINT;
ALTER TABLE "StockTransferItem" ADD COLUMN "taxableValue" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "taxableValuePaise" BIGINT;
ALTER TABLE "StockTransferItem" ADD COLUMN "cgst" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "cgstPaise" BIGINT;
ALTER TABLE "StockTransferItem" ADD COLUMN "sgst" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "sgstPaise" BIGINT;
ALTER TABLE "StockTransferItem" ADD COLUMN "igst" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "igstPaise" BIGINT;
ALTER TABLE "StockTransferItem" ADD COLUMN "taxTotal" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "taxTotalPaise" BIGINT;
ALTER TABLE "StockTransferItem" ADD COLUMN "totalValue" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockTransferItem" ADD COLUMN "totalValuePaise" BIGINT;

UPDATE "StockTransferItem"
SET "hsn" = (SELECT "hsn" FROM "Product" WHERE "Product"."id" = "StockTransferItem"."productId"),
    "gstRate" = COALESCE((SELECT "gstRate" FROM "Product" WHERE "Product"."id" = "StockTransferItem"."productId"), 0);
CREATE UNIQUE INDEX "StockTransfer_shopId_documentType_documentNumber_key"
ON "StockTransfer"("shopId", "documentType", "documentNumber");

CREATE TABLE "TransferDocumentCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransferDocumentCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TransferDocumentCounter_shopId_fiscalYear_documentType_key"
ON "TransferDocumentCounter"("shopId", "fiscalYear", "documentType");
CREATE INDEX "TransferDocumentCounter_shopId_updatedAt_idx"
ON "TransferDocumentCounter"("shopId", "updatedAt");