-- Restaurant: the floor, the menu card and the recipe book — the PostgreSQL
-- twin of prisma/migrations/20260807120000_restaurant_tables_menu_recipes.
-- See the SQLite original for the full rationale.
--
-- In short: a QR sticker on table 5 is read by a guest's phone, and that phone
-- talks to the server, so the floor plan can no longer live only in the till's
-- IndexedDB. A dish stays an ordinary Product and gains only the columns that
-- describe how it is presented and cooked. And a recipe is what turns "we sold
-- 4 butter chickens" into "we are down 600 g of butter" — without it a
-- restaurant's stock figures are fiction, because nobody buys or stores a dish.
--
-- @replay-safe: every object is created IF NOT EXISTS, every column is added
-- IF NOT EXISTS, and the foreign keys are guarded, so an interrupted deploy can
-- replay this migration without error.

-- ── 1. The floor ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RestaurantTable" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    -- What the QR sticker carries: short and human-checkable ("t5").
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'Dining',
    "seats" INTEGER NOT NULL DEFAULT 4,
    -- Per table, not only shop-wide: the terrace can self-order while the
    -- private room stays on waiter service.
    "selfOrderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

-- One sticker, one table: the guard that stops a mistyped code silently
-- pointing two tables at the same order.
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantTable_shopId_code_key" ON "RestaurantTable"("shopId", "code");
CREATE INDEX IF NOT EXISTS "RestaurantTable_shopId_deletedAt_idx" ON "RestaurantTable"("shopId", "deletedAt");
CREATE INDEX IF NOT EXISTS "RestaurantTable_shopId_section_sortOrder_idx" ON "RestaurantTable"("shopId", "section", "sortOrder");
CREATE INDEX IF NOT EXISTS "RestaurantTable_shopId_locationId_active_idx" ON "RestaurantTable"("shopId", "locationId", "active");

-- The foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "RestaurantTable"
    ADD CONSTRAINT "RestaurantTable_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "RestaurantTable"
    ADD CONSTRAINT "RestaurantTable_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. The menu card ─────────────────────────────────────────────────────────
-- Free text rather than an enum: no cuisine is assumed.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "menuCourse" TEXT;
-- veg | nonveg | egg | vegan | jain.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "foodType" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "spiceLevel" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "prepMinutes" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "menuTags" TEXT;
-- Tonight's "86" list, distinct from stock and from isActive. Defaulting to
-- true keeps every existing catalogue sellable the moment this lands.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "menuAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "menuSortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Product_shopId_menuCourse_menuSortOrder_idx" ON "Product"("shopId", "menuCourse", "menuSortOrder");

-- ── 3. The recipe book ───────────────────────────────────────────────────────
-- Neither product id is a foreign key, consistent with the other trade
-- registers. There is no deletedAt on purpose: a soft-deleted row would sit
-- inside the unique index and refuse to let the cook add that ingredient back.
CREATE TABLE IF NOT EXISTS "DishRecipeComponent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dishProductId" TEXT NOT NULL,
    "ingredientProductId" TEXT NOT NULL,
    -- Copied so a costing report reads without a join.
    "ingredientName" TEXT NOT NULL,
    -- Per ONE portion, in the ingredient's own base unit — the same unit stock
    -- is kept in, so depletion is a subtraction with no conversion to get wrong.
    "qtyBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastagePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- A garnish the dish can be served without: excluded from "can the kitchen
    -- still make this?", so a shop out of coriander can still serve dal.
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DishRecipeComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DishRecipeComponent_shopId_dishProductId_ingredientProductId_key" ON "DishRecipeComponent"("shopId", "dishProductId", "ingredientProductId");
CREATE INDEX IF NOT EXISTS "DishRecipeComponent_shopId_dishProductId_idx" ON "DishRecipeComponent"("shopId", "dishProductId");
-- "What else uses paneer?" — asked whenever an ingredient runs low.
CREATE INDEX IF NOT EXISTS "DishRecipeComponent_shopId_ingredientProductId_idx" ON "DishRecipeComponent"("shopId", "ingredientProductId");

DO $$
BEGIN
  ALTER TABLE "DishRecipeComponent"
    ADD CONSTRAINT "DishRecipeComponent_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. Dine-in orders ────────────────────────────────────────────────────────
-- Both the id and the name are kept: the id is how the floor screen finds the
-- table, the name is what the kitchen ticket prints and must survive the table
-- being renamed or taken off the floor plan mid-service.
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "tableId" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "tableName" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "guestCount" INTEGER;

-- "What has this table ordered tonight?" — the floor screen's only question.
CREATE INDEX IF NOT EXISTS "CustomerOrder_shopId_tableId_status_createdAt_idx" ON "CustomerOrder"("shopId", "tableId", "status", "createdAt");
