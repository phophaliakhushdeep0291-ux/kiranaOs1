-- Combos — the PostgreSQL twin of prisma/migrations/20260808140000_menu_combos.
-- See the SQLite original for the full rationale.
--
-- In short: a combo is a Product sold at its own price, so no part of the money
-- path learns a new concept; this table only records the dishes the guest
-- receives, for the kitchen and for stock. Depth is deliberately one — a
-- component may not be another combo — which makes a cycle impossible to write.
--
-- @replay-safe: the table, every index and the foreign key are guarded, so an
-- interrupted deploy can replay this without error.

CREATE TABLE IF NOT EXISTS "MenuComboComponent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    -- The sellable combo. Its own price is what the guest pays.
    "comboProductId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    -- How many of this dish the combo includes: 2 roti in a thali.
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenuComboComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MenuComboComponent_shopId_comboProductId_componentProductId_key" ON "MenuComboComponent"("shopId", "comboProductId", "componentProductId");
CREATE INDEX IF NOT EXISTS "MenuComboComponent_shopId_comboProductId_idx" ON "MenuComboComponent"("shopId", "comboProductId");
-- "Which combos include roti?" — asked whenever a dish is 86'd or repriced.
CREATE INDEX IF NOT EXISTS "MenuComboComponent_shopId_componentProductId_idx" ON "MenuComboComponent"("shopId", "componentProductId");

-- ADD CONSTRAINT has no IF NOT EXISTS, so the foreign key is added inside a block
-- that swallows only the "already there" error.
DO $$ BEGIN
  ALTER TABLE "MenuComboComponent" ADD CONSTRAINT "MenuComboComponent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
