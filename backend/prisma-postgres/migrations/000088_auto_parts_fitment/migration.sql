-- Auto parts: vehicle fitment and cross-references — the PostgreSQL twin of
-- prisma/migrations/20260805100000_auto_parts_fitment.
--
-- "Does this fit?" is the trade's whole question, and nothing in the shared
-- catalogue can answer it. A fitment is a claim that one product fits one
-- vehicle over a range of years; a cross-reference is what else will do when the
-- wanted part is not on the shelf.
--
-- productId is intentionally not a foreign key: this is reference data the shop
-- built up over years and must outlive a product row being renamed.
--
-- @replay-safe: every object is created IF NOT EXISTS and every constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "PartFitment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "variant" TEXT,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartFitment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PartCrossReference" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "alternateProductId" TEXT,
    "partNumber" TEXT NOT NULL,
    "brand" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'alternative',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartCrossReference_pkey" PRIMARY KEY ("id")
);

-- The counter query: "what fits a Swift?" Make and model together, because a
-- model name alone is not unique across manufacturers.
CREATE INDEX IF NOT EXISTS "PartFitment_shopId_make_model_idx" ON "PartFitment"("shopId", "make", "model");
-- "What does this part fit?", read from the product side.
CREATE INDEX IF NOT EXISTS "PartFitment_shopId_productId_idx" ON "PartFitment"("shopId", "productId");
CREATE INDEX IF NOT EXISTS "PartFitment_shopId_make_idx" ON "PartFitment"("shopId", "make");

CREATE INDEX IF NOT EXISTS "PartCrossReference_shopId_productId_idx" ON "PartCrossReference"("shopId", "productId");
-- "Someone read me a number off a box" — the lookup that does not start from a
-- product at all.
CREATE INDEX IF NOT EXISTS "PartCrossReference_shopId_partNumber_idx" ON "PartCrossReference"("shopId", "partNumber");

-- Foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "PartFitment"
    ADD CONSTRAINT "PartFitment_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PartCrossReference"
    ADD CONSTRAINT "PartCrossReference_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
