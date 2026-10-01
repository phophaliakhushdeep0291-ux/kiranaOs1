-- @replay-safe: assembled combos keep historical quantities; only their tracking flag changes.
UPDATE "Product"
   SET "stockTrackingEnabled" = false,
       "updatedAt" = NOW()
 WHERE "stockTrackingEnabled" = true
   AND EXISTS (
     SELECT 1 FROM "MenuComboComponent" AS component
      WHERE component."comboProductId" = "Product"."id"
        AND component."shopId" = "Product"."shopId"
   );
