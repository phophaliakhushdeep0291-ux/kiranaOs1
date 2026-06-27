-- Adds the Product.barcode and Product.sku columns to PostgreSQL to match
-- prisma-postgres/schema.prisma (both `String?`). These shipped to the SQLite schema /
-- Prisma client earlier but the PostgreSQL migration was missed, leaving schema drift
-- (caught by scripts/production-check.js). Idempotent + data-preserving: existing rows
-- keep their data and the nullable columns simply start as NULL.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sku" TEXT;
