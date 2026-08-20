-- Input GST given back when goods go back to the supplier. See the SQLite twin
-- at prisma/migrations/20260813170000_purchase_return_tax.
--
-- Purchases started carrying input tax in 000113_purchase_input_gst, but returns
-- did not reverse it: send stock back and the shop kept claiming credit on tax
-- it had been refunded. Derived from the receipt at return time so nobody has to
-- enter it, then stored so the reversed amount is a fact of the return. Existing
-- rows default to 0, which is what they already reversed.
--
-- @replay-safe: every statement is guarded, so an interrupted deploy can replay
-- this migration without error.
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "taxAmountPaise" BIGINT;
