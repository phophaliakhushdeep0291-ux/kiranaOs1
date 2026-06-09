-- Persist frontend purchase-bill payment and due metadata on purchase stock-in rows.
ALTER TABLE "StockLedger" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "purchasePaymentStatus" TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE "StockLedger" ADD COLUMN "purchasePaymentMode" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "purchasePaidAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockLedger" ADD COLUMN "purchasePaidAmountPaise" BIGINT;
ALTER TABLE "StockLedger" ADD COLUMN "purchaseDueAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "StockLedger" ADD COLUMN "purchaseDueAmountPaise" BIGINT;
ALTER TABLE "StockLedger" ADD COLUMN "purchaseDueDate" DATETIME;

ALTER TABLE "PurchaseHistory" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchasePaymentStatus" TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchasePaymentMode" TEXT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchasePaidAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchasePaidAmountPaise" BIGINT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseDueAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseDueAmountPaise" BIGINT;
ALTER TABLE "PurchaseHistory" ADD COLUMN "purchaseDueDate" DATETIME;
