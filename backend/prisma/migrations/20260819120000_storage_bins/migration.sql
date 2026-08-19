-- Bin locations: where inside a branch a product physically sits.
--
-- This is deliberately NOT a second stock ledger. LocationStock stays
-- authoritative for how much a branch holds, and the primary branch keeps holding
-- no row at all (its quantity is the product total minus every branch allocation
-- and every in-transit reservation). What a bin records is placement, and the
-- quantity not yet assigned to any bin is derived as location stock minus the sum
-- of that product's placements rather than stored anywhere.
--
-- The only mutation is a move between two bins of the SAME location, which nets
-- to zero by construction, so no bin operation can change what a branch owns. The
-- alternative -- letting bins own quantity -- would force every sale, transfer,
-- count and per-pack path to know about bins, and the two ledgers would drift the
-- first time one path forgot.
--
-- sellingUnitId splits placements per pack size for the same reason LocationStock
-- does: a placement that cannot say which size it holds cannot be picked from or
-- audited. NULLs are DISTINCT in a unique index, so the composite unique below
-- does NOT stop two product-level placements in one bin. The partial index over
-- the NULL case closes that, matching LocationStock_locationId_productId_pooled_key.
CREATE TABLE "StorageBin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'pick',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StorageBin_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StorageBin_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BinPlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sellingUnitId" TEXT,
    "stockBaseQty" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BinPlacement_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BinPlacement_binId_fkey" FOREIGN KEY ("binId") REFERENCES "StorageBin" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BinPlacement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BinPlacement_sellingUnitId_fkey" FOREIGN KEY ("sellingUnitId") REFERENCES "ProductSellingUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StorageBin_shopId_locationId_active_idx" ON "StorageBin"("shopId", "locationId", "active");

CREATE INDEX "StorageBin_shopId_updatedAt_id_idx" ON "StorageBin"("shopId", "updatedAt", "id");

CREATE UNIQUE INDEX "StorageBin_locationId_code_key" ON "StorageBin"("locationId", "code");

CREATE INDEX "BinPlacement_shopId_productId_idx" ON "BinPlacement"("shopId", "productId");

CREATE INDEX "BinPlacement_shopId_updatedAt_id_idx" ON "BinPlacement"("shopId", "updatedAt", "id");

CREATE UNIQUE INDEX "BinPlacement_binId_productId_sellingUnitId_key" ON "BinPlacement"("binId", "productId", "sellingUnitId");

CREATE UNIQUE INDEX "BinPlacement_binId_productId_pooled_key"
  ON "BinPlacement"("binId", "productId") WHERE "sellingUnitId" IS NULL;
