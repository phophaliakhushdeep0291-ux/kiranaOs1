-- Furniture sales orders — the PostgreSQL twin of
-- prisma/migrations/20260805130000_furniture_sales_orders.
--
-- The only trade where the sale happens before the goods leave the floor: quote,
-- advance, made-to-order, reserve, deliver, install. For that whole stretch the
-- money and the goods are in different places, which a bill cannot express.
--
-- The order is NOT a bill: it settles nothing, and links to the bill raised when
-- the goods finally go out. productId and billId are intentionally not foreign
-- keys — the order records a promise and outlives a purged product or a
-- cancelled bill.
--
-- @replay-safe: every object is created IF NOT EXISTS and every constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "FurnitureOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL DEFAULT '',
    "deliveryAddress" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'quote',
    "itemsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "installCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quotedOn" TIMESTAMP(3) NOT NULL,
    "promisedOn" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "billId" TEXT,
    "billNumber" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FurnitureOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FurnitureOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "variant" TEXT,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reserveStock" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    CONSTRAINT "FurnitureOrderItem_pkey" PRIMARY KEY ("id")
);

-- Advances. Several per order are normal, so this is a child table rather than
-- one column that could only ever hold the last one.
CREATE TABLE IF NOT EXISTS "FurnitureOrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'cash',
    "paidOn" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FurnitureOrderPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FurnitureOrder_shopId_orderNumber_key" ON "FurnitureOrder"("shopId", "orderNumber");
CREATE INDEX IF NOT EXISTS "FurnitureOrder_shopId_deletedAt_idx" ON "FurnitureOrder"("shopId", "deletedAt");
-- "What is open, and what is due?" — the two questions a showroom asks daily.
CREATE INDEX IF NOT EXISTS "FurnitureOrder_shopId_status_promisedOn_idx" ON "FurnitureOrder"("shopId", "status", "promisedOn");
CREATE INDEX IF NOT EXISTS "FurnitureOrder_shopId_customerPhone_idx" ON "FurnitureOrder"("shopId", "customerPhone");
CREATE INDEX IF NOT EXISTS "FurnitureOrder_shopId_quotedOn_idx" ON "FurnitureOrder"("shopId", "quotedOn");

CREATE INDEX IF NOT EXISTS "FurnitureOrderItem_orderId_idx" ON "FurnitureOrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "FurnitureOrderItem_productId_idx" ON "FurnitureOrderItem"("productId");

CREATE INDEX IF NOT EXISTS "FurnitureOrderPayment_orderId_idx" ON "FurnitureOrderPayment"("orderId");

-- Foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "FurnitureOrder"
    ADD CONSTRAINT "FurnitureOrder_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "FurnitureOrderItem"
    ADD CONSTRAINT "FurnitureOrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "FurnitureOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "FurnitureOrderPayment"
    ADD CONSTRAINT "FurnitureOrderPayment_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "FurnitureOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
