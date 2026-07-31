-- @replay-safe: every statement is idempotent (CREATE TABLE/INDEX IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before each ADD CONSTRAINT),
-- so the deploy script (scripts/deploy-postgres-migrations.js) may auto-resolve
-- and replay it on a P3009 failure without double-applying.
CREATE TABLE IF NOT EXISTS "PurchaseReturn" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "locationId" TEXT NOT NULL, "supplierId" TEXT, "purchaseReceiptId" TEXT NOT NULL,
  "returnNumber" TEXT NOT NULL, "refundMode" TEXT NOT NULL DEFAULT 'supplier_credit', "totalAmount" DOUBLE PRECISION NOT NULL,
  "totalAmountPaise" BIGINT, "supplierCreditAmount" DOUBLE PRECISION NOT NULL DEFAULT 0, "supplierCreditAmountPaise" BIGINT,
  "refundAmount" DOUBLE PRECISION NOT NULL DEFAULT 0, "refundAmountPaise" BIGINT, "reason" TEXT NOT NULL, "supplierReference" TEXT,
  "idempotencyKey" TEXT, "status" TEXT NOT NULL DEFAULT 'active', "cancelledAt" TIMESTAMP(3), "cancelledByUserId" TEXT,
  "cancellationReason" TEXT, "createdByUserId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PurchaseReturnItem" (
  "id" TEXT NOT NULL, "purchaseReturnId" TEXT NOT NULL, "purchaseReceiptItemId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "quantityBaseQty" DOUBLE PRECISION NOT NULL, "actualRate" DOUBLE PRECISION NOT NULL, "actualRatePaise" BIGINT,
  "lineAmount" DOUBLE PRECISION NOT NULL, "lineAmountPaise" BIGINT, "lotAllocationsJson" TEXT NOT NULL DEFAULT '[]', CONSTRAINT "PurchaseReturnItem_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "cancelledByUserId" TEXT;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReturn_shopId_returnNumber_key" ON "PurchaseReturn"("shopId", "returnNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReturn_shopId_idempotencyKey_key" ON "PurchaseReturn"("shopId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_shopId_locationId_createdAt_idx" ON "PurchaseReturn"("shopId", "locationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_shopId_supplierId_createdAt_idx" ON "PurchaseReturn"("shopId", "supplierId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_shopId_purchaseReceiptId_createdAt_idx" ON "PurchaseReturn"("shopId", "purchaseReceiptId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_shopId_status_createdAt_idx" ON "PurchaseReturn"("shopId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReturnItem_purchaseReturnId_purchaseReceiptItemId_key" ON "PurchaseReturnItem"("purchaseReturnId", "purchaseReceiptItemId");
CREATE INDEX IF NOT EXISTS "PurchaseReturnItem_productId_idx" ON "PurchaseReturnItem"("productId");
ALTER TABLE "PurchaseReturn" DROP CONSTRAINT IF EXISTS "PurchaseReturn_shopId_fkey";
ALTER TABLE "PurchaseReturn" DROP CONSTRAINT IF EXISTS "PurchaseReturn_locationId_fkey";
ALTER TABLE "PurchaseReturn" DROP CONSTRAINT IF EXISTS "PurchaseReturn_supplierId_fkey";
ALTER TABLE "PurchaseReturn" DROP CONSTRAINT IF EXISTS "PurchaseReturn_purchaseReceiptId_fkey";
ALTER TABLE "PurchaseReturnItem" DROP CONSTRAINT IF EXISTS "PurchaseReturnItem_purchaseReturnId_fkey";
ALTER TABLE "PurchaseReturnItem" DROP CONSTRAINT IF EXISTS "PurchaseReturnItem_purchaseReceiptItemId_fkey";
ALTER TABLE "PurchaseReturnItem" DROP CONSTRAINT IF EXISTS "PurchaseReturnItem_productId_fkey";
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_purchaseReceiptItemId_fkey" FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "PurchaseReceiptItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
