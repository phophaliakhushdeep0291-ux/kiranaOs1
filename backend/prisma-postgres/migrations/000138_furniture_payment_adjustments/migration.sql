-- @replay-safe
-- Original receipts remain immutable; adjustments are separate dated records.
ALTER TABLE "FurnitureOrderPayment" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'receipt';
ALTER TABLE "FurnitureOrderPayment" ADD COLUMN IF NOT EXISTS "reversesPaymentId" TEXT;
ALTER TABLE "FurnitureOrderPayment" ADD COLUMN IF NOT EXISTS "reason" TEXT;
