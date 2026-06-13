-- Durable client identity for offline product creation, mirroring the bill/customer
-- idempotency model. All columns are nullable so existing products are untouched, and
-- NULLs are distinct in SQLite unique indexes so legacy rows never collide.

ALTER TABLE "Product" ADD COLUMN "clientProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Product" ADD COLUMN "sourceDeviceId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_shopId_idempotencyKey_key" ON "Product"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_shopId_sourceDeviceId_clientProductId_key" ON "Product"("shopId", "sourceDeviceId", "clientProductId");
