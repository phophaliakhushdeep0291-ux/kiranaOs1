-- Combos: a thali, a meal deal, "burger + fries + coke".
--
-- A combo needs no pricing of its own. It IS a Product, sold at that product's
-- price, taxed and reported through the same path as any other dish — so nothing
-- in the money path learns a new concept. What this table adds is the list of
-- dishes the guest actually receives, which is what the kitchen must cook and
-- what stock must lose.
--
-- Depth is deliberately ONE: a component must be a plain dish, never another
-- combo. That is not simplification for its own sake — it makes a cycle
-- impossible to write, so no expansion can loop and no thali can contain itself.
-- combos.service.js refuses a nested combo with a sentence rather than letting
-- the server find out by recursing forever.
--
-- componentName is copied rather than joined, exactly as DishRecipeComponent
-- copies ingredientName: a combo report should read without a join, and the
-- printed ticket should still say what was sold after a dish is renamed.

CREATE TABLE "MenuComboComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    -- The sellable combo. Its own price is what the guest pays.
    "comboProductId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "componentName" TEXT NOT NULL,
    -- How many of this dish the combo includes: 2 roti in a thali.
    "quantity" REAL NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuComboComponent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MenuComboComponent_shopId_comboProductId_componentProductId_key" ON "MenuComboComponent"("shopId", "comboProductId", "componentProductId");
CREATE INDEX "MenuComboComponent_shopId_comboProductId_idx" ON "MenuComboComponent"("shopId", "comboProductId");
-- "Which combos include roti?" — asked whenever a dish is 86'd or repriced.
CREATE INDEX "MenuComboComponent_shopId_componentProductId_idx" ON "MenuComboComponent"("shopId", "componentProductId");
