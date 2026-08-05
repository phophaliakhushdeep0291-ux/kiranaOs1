-- Auto parts: vehicle fitment and cross-references.
--
-- "Does this fit?" is the trade's whole question, and nothing in the shared
-- catalogue can answer it — a part number means nothing to a customer who says
-- "Swift, 2015, diesel". Until now the advice was to type that into the product
-- notes, which no query can read.
--
-- productId is intentionally not a foreign key: a fitment is reference data the
-- shop built up over years and must outlive a product row being renamed or
-- repurchased.

CREATE TABLE "PartFitment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "variant" TEXT,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartFitment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The counter query: "what fits a Swift?" Make and model together, because a
-- model name alone is not unique across manufacturers.
CREATE INDEX "PartFitment_shopId_make_model_idx" ON "PartFitment"("shopId", "make", "model");
-- "What does this part fit?", read from the product side.
CREATE INDEX "PartFitment_shopId_productId_idx" ON "PartFitment"("shopId", "productId");
CREATE INDEX "PartFitment_shopId_make_idx" ON "PartFitment"("shopId", "make");

CREATE TABLE "PartCrossReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "alternateProductId" TEXT,
    "partNumber" TEXT NOT NULL,
    "brand" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'alternative',
    "notes" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartCrossReference_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PartCrossReference_shopId_productId_idx" ON "PartCrossReference"("shopId", "productId");
-- "Someone read me a number off a box" — the lookup that does not start from a
-- product at all.
CREATE INDEX "PartCrossReference_shopId_partNumber_idx" ON "PartCrossReference"("shopId", "partNumber");
