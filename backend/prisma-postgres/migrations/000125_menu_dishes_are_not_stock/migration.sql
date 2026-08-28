-- @replay-safe: a bounded UPDATE that converges, so replaying it changes nothing.
--
-- 000124 added the column and backfilled it, but keyed "is this stock" on the
-- dish having a recipe. On a real menu that matched nothing.
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
--
-- `updatedAt` is bumped deliberately. It is @updatedAt, which Prisma maintains
-- from the client and raw SQL does not touch, and the till pulls incrementally
-- on `updatedAt >= since`. Correcting the column without moving the timestamp
-- would fix the server and never reach the device: the store room reads its own
-- offline copy of these products, so a row the sync never re-sends stays wrong
-- on screen no matter what the database says.
UPDATE "Product"
   SET "stockTrackingEnabled" = false,
       "updatedAt" = NOW()
 WHERE "menuCourse" IS NOT NULL
   AND "stockTrackingEnabled" IS DISTINCT FROM false;
