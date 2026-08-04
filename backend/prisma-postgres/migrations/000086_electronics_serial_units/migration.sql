-- Electronics: serialised stock units — the PostgreSQL twin of
-- prisma/migrations/20260804220000_electronics_serial_units.
--
-- Every other trade counts stock as a number; this one has to name each piece,
-- because a return or warranty claim has to find the same physical unit again.
--
-- productId and billId are intentionally not foreign keys: the unit records a
-- physical thing that left the shop and must outlive a renamed product or a
-- cancelled bill.
--
-- @replay-safe: every object is created IF NOT EXISTS and the constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "ProductUnit" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "imei" TEXT,
    "imei2" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "condition" TEXT NOT NULL DEFAULT 'new',
    "purchaseBillId" TEXT,
    "supplierId" TEXT,
    "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billId" TEXT,
    "billNumber" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT NOT NULL DEFAULT '',
    "soldAt" TIMESTAMP(3),
    "sellingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "warrantyUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

-- Two units in one shop may never share an identifier. NULLs are distinct, so a
-- laptop with no IMEI does not collide with every other laptop that has none.
CREATE UNIQUE INDEX IF NOT EXISTS "ProductUnit_shopId_imei_key" ON "ProductUnit"("shopId", "imei");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductUnit_shopId_serialNumber_key" ON "ProductUnit"("shopId", "serialNumber");
-- The counter's lookup: someone puts a handset down and asks about it.
CREATE INDEX IF NOT EXISTS "ProductUnit_shopId_imei2_idx" ON "ProductUnit"("shopId", "imei2");
CREATE INDEX IF NOT EXISTS "ProductUnit_shopId_status_idx" ON "ProductUnit"("shopId", "status");
CREATE INDEX IF NOT EXISTS "ProductUnit_shopId_productId_status_idx" ON "ProductUnit"("shopId", "productId", "status");
CREATE INDEX IF NOT EXISTS "ProductUnit_shopId_billId_idx" ON "ProductUnit"("shopId", "billId");
CREATE INDEX IF NOT EXISTS "ProductUnit_shopId_customerPhone_idx" ON "ProductUnit"("shopId", "customerPhone");
-- "What cover is about to run out?"
CREATE INDEX IF NOT EXISTS "ProductUnit_shopId_warrantyUntil_idx" ON "ProductUnit"("shopId", "warrantyUntil");

-- The foreign key is added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "ProductUnit"
    ADD CONSTRAINT "ProductUnit_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
