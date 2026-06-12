-- Data-preserving repair for Product columns used by the current Prisma client.
-- This is intentionally idempotent so deployed shops with existing rows keep data
-- and only missing columns/defaults are filled.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brand" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "mrp" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reorderLevel" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isLooseItem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lowStockThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "hsn" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "costPerRateUnitPaise" BIGINT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "minPricePerRateUnitPaise" BIGINT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultPricePerRateUnitPaise" BIGINT;

UPDATE "Product" SET
  "mrp" = COALESCE("mrp", 0),
  "reorderLevel" = COALESCE("reorderLevel", 0),
  "isLooseItem" = COALESCE("isLooseItem", false),
  "lowStockThreshold" = COALESCE("lowStockThreshold", 0),
  "costPerRateUnitPaise" = COALESCE("costPerRateUnitPaise", ROUND((COALESCE("costPerRateUnit", 0)::numeric * 100))::bigint),
  "minPricePerRateUnitPaise" = COALESCE("minPricePerRateUnitPaise", ROUND((COALESCE("minPricePerRateUnit", 0)::numeric * 100))::bigint),
  "defaultPricePerRateUnitPaise" = COALESCE("defaultPricePerRateUnitPaise", ROUND((COALESCE("defaultPricePerRateUnit", 0)::numeric * 100))::bigint)
WHERE "mrp" IS NULL
   OR "reorderLevel" IS NULL
   OR "isLooseItem" IS NULL
   OR "lowStockThreshold" IS NULL
   OR "costPerRateUnitPaise" IS NULL
   OR "minPricePerRateUnitPaise" IS NULL
   OR "defaultPricePerRateUnitPaise" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "mrp" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "mrp" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "reorderLevel" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "reorderLevel" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "isLooseItem" SET DEFAULT false;
ALTER TABLE "Product" ALTER COLUMN "isLooseItem" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "lowStockThreshold" SET DEFAULT 0;
ALTER TABLE "Product" ALTER COLUMN "lowStockThreshold" SET NOT NULL;
