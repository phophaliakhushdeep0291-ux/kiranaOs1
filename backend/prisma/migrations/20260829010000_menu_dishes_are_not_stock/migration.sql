-- @replay-safe: a bounded UPDATE that converges, so replaying it changes nothing.
--
-- 000124 added the column and backfilled it, but keyed "is this stock" on having
-- a recipe. That was too narrow, and on a real menu it matched nothing at all.
--
-- A kitchen puts dishes on the menu long before anybody writes their recipes
-- down. Dal Fry is no more a thing you stock on the day it is added than it is a
-- month later — being on the menu is what says "we cook this to order"; a recipe
-- only says how. So every dish stayed tracked, every sale drove its count one
-- further below zero, and the store room filled with rows nobody can act on:
-- there is no purchase order for a cooked plate to put the number back.
--
-- Separate migration rather than an edit to 000124, which is already applied:
-- Prisma never re-runs a recorded migration, so a correction to that file would
-- have shipped, deployed green, and changed nothing.
UPDATE "Product"
   SET "stockTrackingEnabled" = false
 WHERE "menuCourse" IS NOT NULL
   AND "stockTrackingEnabled" <> 0;
