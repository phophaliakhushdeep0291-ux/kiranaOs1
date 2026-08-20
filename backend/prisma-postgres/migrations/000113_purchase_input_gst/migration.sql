-- Input GST on purchases. See the SQLite twin at
-- prisma/migrations/20260813150000_purchase_input_gst.
--
-- A purchase voucher could carry no tax at all, because nothing captured any:
-- PurchaseReceipt held only the invoice total and Supplier had no GSTIN. The tax
-- is stored as the tax, not the taxable value, so the goods value stays a
-- residual (invoice total − tax) and can never disagree with the invoice.
-- Existing receipts default to 0, which posts exactly as they do today.
--
-- @replay-safe: every statement is guarded, so an interrupted deploy can replay
-- this migration without error.
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "gstin" TEXT;

ALTER TABLE "PurchaseReceipt" ADD COLUMN IF NOT EXISTS "supplierInvoiceTax" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReceipt" ADD COLUMN IF NOT EXISTS "supplierInvoiceTaxPaise" BIGINT;
