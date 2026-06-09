-- Persist frontend purchase-bill payment and due metadata on purchase stock-in rows.
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchasePaymentStatus" TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchasePaymentMode" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchasePaidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchasePaidAmountPaise" BIGINT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchaseDueAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchaseDueAmountPaise" BIGINT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchaseDueDate" TIMESTAMP(3);

ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "purchasePaymentStatus" TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "purchasePaymentMode" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "purchasePaidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "purchasePaidAmountPaise" BIGINT;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "purchaseDueAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "purchaseDueAmountPaise" BIGINT;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "purchaseDueDate" TIMESTAMP(3);
