-- Existing restaurant dishes created before stock tracking had no menuCourse,
-- so the earlier menu-course backfill could not see them. Correct legacy rows
-- that carry none of the signals of real ingredient/packaged inventory.
-- @replay-safe: the bounded UPDATE converges.
UPDATE "Product"
   SET "stockTrackingEnabled" = false,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "shopId" IN (
       SELECT "id"
         FROM "Shop"
        WHERE COALESCE(
                json_extract("settingsJson", '$.businessProfile.businessType'),
                json_extract("settingsJson", '$.storeProfile.businessTypeKey')
              ) = 'restaurant'
   )
   AND "stockTrackingEnabled" <> 0
   AND "stockBaseQty" <= 0
   AND "costPerRateUnit" <= 0
   AND "reorderLevel" <= 0;
