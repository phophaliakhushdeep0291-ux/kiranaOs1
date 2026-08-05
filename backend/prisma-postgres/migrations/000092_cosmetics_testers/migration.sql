-- Cosmetics tester stock — the PostgreSQL twin of
-- prisma/migrations/20260805140000_cosmetics_testers.
--
-- A tester is a unit opened for customers to try and will never be sold.
-- Counted as sellable it makes the shelf wrong, surfaces later as shrinkage that
-- looks like theft, and hides what testers cost the shop.
--
-- productId is intentionally not a foreign key, consistent with the other trade
-- registers: the record survives a catalogue row being renamed.
--
-- @replay-safe: every object is created IF NOT EXISTS and the constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "TesterUnit" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variant" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_use',
    "openedOn" TIMESTAMP(3) NOT NULL,
    "expectedDays" INTEGER NOT NULL DEFAULT 90,
    "closedOn" TIMESTAMP(3),
    "costValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockLedgerId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TesterUnit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TesterUnit_shopId_deletedAt_idx" ON "TesterUnit"("shopId", "deletedAt");
-- "What is on the counter, and what needs replacing?"
CREATE INDEX IF NOT EXISTS "TesterUnit_shopId_status_openedOn_idx" ON "TesterUnit"("shopId", "status", "openedOn");
CREATE INDEX IF NOT EXISTS "TesterUnit_shopId_productId_status_idx" ON "TesterUnit"("shopId", "productId", "status");

-- The foreign key is added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "TesterUnit"
    ADD CONSTRAINT "TesterUnit_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
