-- @replay-safe: the additive column is guarded and every classification update
-- only fills NULL rows, so an interrupted production deploy can repeat safely.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "restaurantItemType" TEXT;

-- Preserve ambiguous legacy rows. Only products already proven to be dishes or
-- ingredients are backfilled; everything else stays on the ordinary stock path.
UPDATE "Product" AS product
SET "restaurantItemType" = 'packaged'
FROM "Shop" AS shop
WHERE product."shopId" = shop."id"
  AND product."restaurantItemType" IS NULL
  AND lower(product."name") = 'mineral water'
  AND product."description" LIKE 'Starter item%'
  AND (
    shop."settingsJson" LIKE '%"businessType":"restaurant"%'
    OR shop."settingsJson" LIKE '%"businessTypeKey":"restaurant"%'
  );

UPDATE "Product" AS product
SET "restaurantItemType" = 'prepared'
FROM "Shop" AS shop
WHERE product."shopId" = shop."id"
  AND product."restaurantItemType" IS NULL
  AND (
    shop."settingsJson" LIKE '%"businessType":"restaurant"%'
    OR shop."settingsJson" LIKE '%"businessTypeKey":"restaurant"%'
  )
  AND (
    product."description" LIKE 'Starter item%'
    OR product."menuCourse" IS NOT NULL
    OR product."foodType" IS NOT NULL
    OR product."prepMinutes" IS NOT NULL
    OR product."menuTags" IS NOT NULL
    OR product."menuSortOrder" <> 0
    OR product."id" IN (SELECT "dishProductId" FROM "DishRecipeComponent")
    OR product."id" IN (SELECT "comboProductId" FROM "MenuComboComponent")
  );

UPDATE "Product" AS product
SET "restaurantItemType" = 'ingredient'
FROM "Shop" AS shop
WHERE product."shopId" = shop."id"
  AND product."restaurantItemType" IS NULL
  AND (
    shop."settingsJson" LIKE '%"businessType":"restaurant"%'
    OR shop."settingsJson" LIKE '%"businessTypeKey":"restaurant"%'
  )
  AND product."id" IN (SELECT "ingredientProductId" FROM "DishRecipeComponent");
