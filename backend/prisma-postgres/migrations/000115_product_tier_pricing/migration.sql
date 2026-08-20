-- Persist the simple retail/wholesale quantity tiers already used by the web
-- counter and offline product editor. Nullable prices preserve the historical
-- behaviour: products created before this migration inherit their default price.
--
-- @replay-safe: every additive statement is guarded so a deployment interrupted
-- after any one column can safely replay the whole migration.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "retailPricePerRateUnit" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "retailFromQuantity" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wholesalePricePerRateUnit" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wholesaleFromQuantity" DOUBLE PRECISION NOT NULL DEFAULT 10;
