-- Input GST given back when goods go back to the supplier.
--
-- Purchases started carrying input tax in 20260813150000_purchase_input_gst, but
-- returns did not reverse it: send stock back and the shop kept claiming credit
-- on tax it had been refunded. Correct in Tally's arithmetic — the ledgers still
-- balanced — and wrong in the return, which is the harder kind to notice.
--
-- Derived from the receipt at return time (the returned value's share of that
-- invoice's tax) so nobody has to enter it, then stored, so the amount reversed
-- is a fact of the return rather than something that shifts if the receipt is
-- reconciled again afterwards. Existing returns default to 0, which is what they
-- already reversed.
ALTER TABLE "PurchaseReturn" ADD COLUMN "taxAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReturn" ADD COLUMN "taxAmountPaise" BIGINT;
