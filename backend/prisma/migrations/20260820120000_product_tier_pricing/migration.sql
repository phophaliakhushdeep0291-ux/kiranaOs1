-- Persist the simple retail/wholesale quantity tiers already used by the web
-- counter and offline product editor. Nullable prices preserve the historical
-- behaviour: products created before this migration inherit their default price.
ALTER TABLE "Product" ADD COLUMN "retailPricePerRateUnit" REAL;
ALTER TABLE "Product" ADD COLUMN "retailFromQuantity" REAL NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN "wholesalePricePerRateUnit" REAL;
ALTER TABLE "Product" ADD COLUMN "wholesaleFromQuantity" REAL NOT NULL DEFAULT 10;
