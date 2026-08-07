-- Restaurant: the floor, the menu card and the recipe book.
--
-- Three things a restaurant has that no retail shop does, and each one exists
-- because something was previously either impossible or a lie.
--
-- 1. THE FLOOR. Tables lived only in the till's own IndexedDB. That was fine
--    while the only reader was the till, and it is untenable the moment a QR
--    sticker on table 5 is scanned by a guest's phone: the phone talks to the
--    server, and the server had never heard of table 5. So the floor plan is a
--    shop record now, and the server can answer "is this a real table here, and
--    what is it called" without trusting anything printed on a sticker.
--
-- 2. THE MENU CARD. A dish is an ordinary Product and stays one — same pricing,
--    tax, billing and stock path as a packet of biscuits. What a menu adds is
--    how the dish is presented and cooked: which course it belongs to, whether
--    it is veg, how hot, how long the kitchen needs, and whether it has been
--    "86'd" for tonight. Every column is nullable or defaulted, so a kirana
--    catalogue is untouched and a restaurant fills them in one dish at a time.
--
-- 3. THE RECIPE BOOK. Without it a restaurant's stock figures are fiction: the
--    POS decrements the dish, and nobody buys or stores a dish. The kitchen buys
--    chicken, cream and butter — and those are what run out mid-service.

-- ── 1. The floor ─────────────────────────────────────────────────────────────
CREATE TABLE "RestaurantTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    -- What the QR sticker carries. Short and human-checkable ("t5",
    -- "terrace-2") because a waiter has to read it off a curling sticker.
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'Dining',
    "seats" INTEGER NOT NULL DEFAULT 4,
    -- Per table, not only shop-wide: a restaurant can open the terrace to
    -- self-ordering and keep the private room on waiter service.
    "selfOrderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RestaurantTable_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RestaurantTable_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- One sticker, one table: the guard that stops a mistyped code silently
-- pointing two tables at the same order.
CREATE UNIQUE INDEX "RestaurantTable_shopId_code_key" ON "RestaurantTable"("shopId", "code");
CREATE INDEX "RestaurantTable_shopId_deletedAt_idx" ON "RestaurantTable"("shopId", "deletedAt");
CREATE INDEX "RestaurantTable_shopId_section_sortOrder_idx" ON "RestaurantTable"("shopId", "section", "sortOrder");
CREATE INDEX "RestaurantTable_shopId_locationId_active_idx" ON "RestaurantTable"("shopId", "locationId", "active");

-- ── 2. The menu card ─────────────────────────────────────────────────────────
-- Free text rather than an enum: no cuisine is assumed, so "Dim sum" and
-- "Thali" are as valid as "Starters".
ALTER TABLE "Product" ADD COLUMN "menuCourse" TEXT;
-- veg | nonveg | egg | vegan | jain — the mark Indian menus are expected to carry.
ALTER TABLE "Product" ADD COLUMN "foodType" TEXT;
ALTER TABLE "Product" ADD COLUMN "spiceLevel" INTEGER;
ALTER TABLE "Product" ADD COLUMN "prepMinutes" INTEGER;
ALTER TABLE "Product" ADD COLUMN "menuTags" TEXT;
-- Tonight's "86" list. Deliberately distinct from stock and from isActive: the
-- dish exists, is priced, and comes back tomorrow — the kitchen has simply run
-- out of it now. Defaulting to true is what keeps every existing catalogue
-- sellable the moment this lands.
ALTER TABLE "Product" ADD COLUMN "menuAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "menuSortOrder" INTEGER NOT NULL DEFAULT 0;

-- "This shop's dishes, grouped by course, in printed order" — asked on every
-- guest scan.
CREATE INDEX "Product_shopId_menuCourse_menuSortOrder_idx" ON "Product"("shopId", "menuCourse", "menuSortOrder");

-- ── 3. The recipe book ───────────────────────────────────────────────────────
-- Neither product id is a foreign key, consistent with the other trade
-- registers: a recipe must survive its dish being renamed and an ingredient
-- being swapped for an equivalent, without cascading a delete through the
-- kitchen's costing history.
--
-- There is no deletedAt on purpose. A recipe line is configuration, not history,
-- and a soft-deleted row would sit inside the unique index below — silently
-- refusing to let the cook add that ingredient back.
CREATE TABLE "DishRecipeComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "dishProductId" TEXT NOT NULL,
    "ingredientProductId" TEXT NOT NULL,
    -- Copied so a costing report reads without a join.
    "ingredientName" TEXT NOT NULL,
    -- Per ONE portion of the dish, in the ingredient's own base unit (g, ml,
    -- piece) — the same unit stock is kept in, so depletion is a subtraction
    -- with no conversion to get wrong.
    "qtyBase" REAL NOT NULL DEFAULT 0,
    -- Trim, spillage and what is left in the pan, on top of qtyBase.
    "wastagePct" REAL NOT NULL DEFAULT 0,
    -- A garnish the dish can be served without. Excluded from "can the kitchen
    -- still make this?", so a shop out of coriander is not told it cannot serve dal.
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DishRecipeComponent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DishRecipeComponent_shopId_dishProductId_ingredientProductId_key" ON "DishRecipeComponent"("shopId", "dishProductId", "ingredientProductId");
CREATE INDEX "DishRecipeComponent_shopId_dishProductId_idx" ON "DishRecipeComponent"("shopId", "dishProductId");
-- "What else uses paneer?" — asked whenever an ingredient runs low.
CREATE INDEX "DishRecipeComponent_shopId_ingredientProductId_idx" ON "DishRecipeComponent"("shopId", "ingredientProductId");

-- ── 4. Dine-in orders ────────────────────────────────────────────────────────
-- Both the id and the name are kept. The id is how the floor screen finds the
-- table; the name is what the kitchen ticket prints, and it must survive the
-- table being renamed or taken off the floor plan mid-service.
ALTER TABLE "CustomerOrder" ADD COLUMN "tableId" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "tableName" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "guestCount" INTEGER;

-- "What has this table ordered tonight?" — the floor screen's only question.
CREATE INDEX "CustomerOrder_shopId_tableId_status_createdAt_idx" ON "CustomerOrder"("shopId", "tableId", "status", "createdAt");
