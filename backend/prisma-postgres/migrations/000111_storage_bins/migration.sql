-- Bin locations: where inside a branch a product physically sits. See the SQLite
-- twin at prisma/migrations/20260819120000_storage_bins for the full rationale.
--
-- The short version: this is NOT a second stock ledger. LocationStock stays
-- authoritative for how much a branch holds, placements only say where inside the
-- branch it sits, and the unplaced remainder is derived rather than stored. The
-- only mutation is a move between two bins of the same location, which nets to
-- zero, so no bin operation can change what a branch owns.
--
-- NULLs are DISTINCT in a unique index, so the composite unique does NOT stop two
-- product-level placements in one bin. The partial index over the NULL case closes
-- that, matching LocationStock_locationId_productId_pooled_key.
--
-- @replay-safe: every statement is guarded, so an interrupted deploy can replay
-- this migration without error.
CREATE TABLE IF NOT EXISTS "StorageBin" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "locationId" TEXT NOT NULL,
  "code" TEXT NOT NULL, "name" TEXT NOT NULL, "zone" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'pick', "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "BinPlacement" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "binId" TEXT NOT NULL,
  "productId" TEXT NOT NULL, "sellingUnitId" TEXT,
  "stockBaseQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "StorageBin_shopId_locationId_active_idx" ON "StorageBin"("shopId", "locationId", "active");
CREATE INDEX IF NOT EXISTS "StorageBin_shopId_updatedAt_id_idx" ON "StorageBin"("shopId", "updatedAt", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "StorageBin_locationId_code_key" ON "StorageBin"("locationId", "code");

CREATE INDEX IF NOT EXISTS "BinPlacement_shopId_productId_idx" ON "BinPlacement"("shopId", "productId");
CREATE INDEX IF NOT EXISTS "BinPlacement_shopId_updatedAt_id_idx" ON "BinPlacement"("shopId", "updatedAt", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "BinPlacement_binId_productId_sellingUnitId_key" ON "BinPlacement"("binId", "productId", "sellingUnitId");
CREATE UNIQUE INDEX IF NOT EXISTS "BinPlacement_binId_productId_pooled_key"
  ON "BinPlacement"("binId", "productId") WHERE "sellingUnitId" IS NULL;
