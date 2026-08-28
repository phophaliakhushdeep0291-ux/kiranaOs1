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

-- Every dish on the menu, not only the ones that happen to carry a recipe.
--
-- Keying this on recipes was too narrow: a kitchen puts dishes on the menu long
-- before anybody writes their recipes down, and Dal Fry is no more a thing you
-- stock on the day it is added than it is a month later. Being on the menu is
-- what says "we cook this to order"; a recipe only says how.
--
-- A menu item that genuinely IS stock — a bottled drink off the shelf — is the
-- exception, and the owner turns tracking back on for it.
UPDATE "Product"
   SET "stockTrackingEnabled" = false
 WHERE "menuCourse" IS NOT NULL
   AND "stockTrackingEnabled" IS DISTINCT FROM false;
