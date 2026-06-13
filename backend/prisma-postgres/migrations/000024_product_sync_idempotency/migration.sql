-- Durable client identity for offline product creation, mirroring the bill/customer
-- idempotency model. Additive and data-preserving for production: columns are nullable,
-- and NULLs are distinct in Postgres unique indexes so existing products never collide.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "clientProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sourceDeviceId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_shopId_idempotencyKey_key" ON "Product"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_shopId_sourceDeviceId_clientProductId_key" ON "Product"("shopId", "sourceDeviceId", "clientProductId");
