ALTER TABLE "Product" ADD COLUMN "restaurantItemType" TEXT;

-- Classify only restaurant rows whose intent is already unambiguous. Unknown
-- legacy products remain null and keep the ordinary stock path until the owner
-- chooses a role in the product editor.
UPDATE "Product"
SET "restaurantItemType" = 'packaged'
WHERE "restaurantItemType" IS NULL
  AND lower("name") = 'mineral water'
  AND "description" LIKE 'Starter item%'
  AND "shopId" IN (
    SELECT "id" FROM "Shop"
    WHERE "settingsJson" LIKE '%"businessType":"restaurant"%'
       OR "settingsJson" LIKE '%"businessTypeKey":"restaurant"%'
  );

UPDATE "Product"
SET "restaurantItemType" = 'prepared'
WHERE "restaurantItemType" IS NULL
  AND "shopId" IN (
    SELECT "id" FROM "Shop"
    WHERE "settingsJson" LIKE '%"businessType":"restaurant"%'
       OR "settingsJson" LIKE '%"businessTypeKey":"restaurant"%'
  )
  AND (
    "description" LIKE 'Starter item%'
    OR "menuCourse" IS NOT NULL
    OR "foodType" IS NOT NULL
    OR "prepMinutes" IS NOT NULL
    OR "menuTags" IS NOT NULL
    OR "menuSortOrder" <> 0
    OR "id" IN (SELECT "dishProductId" FROM "DishRecipeComponent")
    OR "id" IN (SELECT "comboProductId" FROM "MenuComboComponent")
  );

UPDATE "Product"
SET "restaurantItemType" = 'ingredient'
WHERE "restaurantItemType" IS NULL
  AND "shopId" IN (
    SELECT "id" FROM "Shop"
    WHERE "settingsJson" LIKE '%"businessType":"restaurant"%'
       OR "settingsJson" LIKE '%"businessTypeKey":"restaurant"%'
  )
  AND "id" IN (SELECT "ingredientProductId" FROM "DishRecipeComponent");
