-- @replay-safe
-- Original receipts remain immutable; adjustments are separate dated records.
ALTER TABLE "FurnitureOrderPayment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'receipt';
ALTER TABLE "FurnitureOrderPayment" ADD COLUMN "reversesPaymentId" TEXT;
ALTER TABLE "FurnitureOrderPayment" ADD COLUMN "reason" TEXT;
