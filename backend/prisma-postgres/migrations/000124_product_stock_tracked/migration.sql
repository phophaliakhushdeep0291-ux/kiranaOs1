-- @replay-safe: the column add is guarded, and the backfill is idempotent.
--
-- A cooked dish is not stock. Its ingredients are what leave the store room,
-- and the recipe already moves those — so decrementing the dish as well moved
-- stock twice against a number no purchase order ever puts back.
--
-- Defaults to true so every existing product in every trade is unchanged: a
-- kirana's biscuits, a pharmacy's strips and a restaurant's bottled drinks all
-- keep counting exactly as they did.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockTrackingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Anything already carrying a recipe is assembled here rather than bought in,
-- which is the same rule the sale guard uses. Backfilled so an existing
-- restaurant does not have to revisit its menu one dish at a time.
UPDATE "Product"
   SET "stockTrackingEnabled" = false
 WHERE "id" IN (SELECT DISTINCT "dishProductId" FROM "DishRecipeComponent")
   AND "stockTrackingEnabled" IS DISTINCT FROM false;
