-- @replay-safe: the bounded UPDATE converges and leaves explicit inventory alone.
--
-- The first restaurant backfill used menuCourse as the dish marker. Existing
-- restaurants created their menu through the ordinary Dishes screen, however,
-- and those rows have no menuCourse at all. They therefore remained tracked and
-- appeared in Store Room as -1, -2, or 0 plates after every sale.
--
-- Existing restaurant rows with no stock value, buying cost, or reorder level
-- are legacy menu dishes, not ingredients. Real ingredients already carrying a
-- quantity/cost/reorder policy remain counted, and the owner can explicitly turn
-- tracking on for packaged drinks. updatedAt is moved so offline tills pull the
-- correction instead of keeping their stale copy forever.
UPDATE "Product" AS product
   SET "stockTrackingEnabled" = false,
       "updatedAt" = NOW()
 WHERE product."shopId" IN (
       SELECT shop."id"
         FROM "Shop" AS shop
        WHERE COALESCE(
                NULLIF(shop."settingsJson", '')::jsonb #>> '{businessProfile,businessType}',
                NULLIF(shop."settingsJson", '')::jsonb #>> '{storeProfile,businessTypeKey}'
              ) = 'restaurant'
   )
   AND product."stockTrackingEnabled" IS DISTINCT FROM false
   AND product."stockBaseQty" <= 0
   AND product."costPerRateUnit" <= 0
   AND product."reorderLevel" <= 0;
