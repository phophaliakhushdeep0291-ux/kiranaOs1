-- Footwear size profiles — the PostgreSQL twin of
-- prisma/migrations/20260805110000_footwear_size_profiles.
--
-- The size run itself is ordinary variant machinery (a Size axis, one selling
-- unit per size holding its own stock). What cannot be derived from those
-- variants is whether "8" means UK, EU, US or centimetres — that is all this
-- records, one row per style.
--
-- productId is intentionally not a foreign key, consistent with the other trade
-- registers: the profile survives a catalogue row being renamed.
--
-- @replay-safe: every object is created IF NOT EXISTS and the constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "FootwearSizeProfile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sizeSystem" TEXT NOT NULL DEFAULT 'uk',
    "gender" TEXT NOT NULL DEFAULT 'unisex',
    "widthFit" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FootwearSizeProfile_pkey" PRIMARY KEY ("id")
);

-- One profile per style: a second row would let the same shoe claim two scales.
CREATE UNIQUE INDEX IF NOT EXISTS "FootwearSizeProfile_shopId_productId_key" ON "FootwearSizeProfile"("shopId", "productId");
CREATE INDEX IF NOT EXISTS "FootwearSizeProfile_shopId_deletedAt_idx" ON "FootwearSizeProfile"("shopId", "deletedAt");

-- The foreign key is added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "FootwearSizeProfile"
    ADD CONSTRAINT "FootwearSizeProfile_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
