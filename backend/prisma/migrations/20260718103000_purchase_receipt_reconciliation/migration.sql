ALTER TABLE "PurchaseReceipt" ADD COLUMN "supplierInvoiceAmount" REAL;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "supplierInvoiceAmountPaise" BIGINT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "expectedGoodsAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "expectedGoodsAmountPaise" BIGINT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "priceVarianceAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "priceVarianceAmountPaise" BIGINT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceVarianceAmount" REAL;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "invoiceVarianceAmountPaise" BIGINT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "matchStatus" TEXT NOT NULL DEFAULT 'invoice_pending';
ALTER TABLE "PurchaseReceipt" ADD COLUMN "varianceReason" TEXT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "varianceApprovedByUserId" TEXT;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "varianceApprovedAt" DATETIME;

-- Historical receipts remain explicitly pending until a user supplies invoice
-- evidence. Their goods value is preserved without inventing a PO-rate match.
UPDATE "PurchaseReceipt"
SET "expectedGoodsAmount" = "totalAmount",
    "expectedGoodsAmountPaise" = "totalAmountPaise";

CREATE INDEX "PurchaseReceipt_shopId_matchStatus_createdAt_idx"
ON "PurchaseReceipt"("shopId", "matchStatus", "createdAt");
