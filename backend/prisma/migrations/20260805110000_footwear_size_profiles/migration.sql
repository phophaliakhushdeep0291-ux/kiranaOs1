-- Footwear: which size system a style is sold in.
--
-- The size run itself is ordinary variant machinery — a Size axis on the
-- Product, one ProductSellingUnit per size holding its own stock — so nothing
-- here duplicates stock. What cannot be derived from those variants is whether
-- the number written on them means UK, EU, US or centimetres, and that is all
-- this table records. One row per style, because a style is sold in one system.
--
-- productId is intentionally not a foreign key, consistent with the other trade
-- registers: the profile survives a catalogue row being renamed.

CREATE TABLE "FootwearSizeProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sizeSystem" TEXT NOT NULL DEFAULT 'uk',
    "gender" TEXT NOT NULL DEFAULT 'unisex',
    "widthFit" TEXT,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FootwearSizeProfile_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One profile per style: a second row would let the same shoe claim two scales.
CREATE UNIQUE INDEX "FootwearSizeProfile_shopId_productId_key" ON "FootwearSizeProfile"("shopId", "productId");
CREATE INDEX "FootwearSizeProfile_shopId_deletedAt_idx" ON "FootwearSizeProfile"("shopId", "deletedAt");
