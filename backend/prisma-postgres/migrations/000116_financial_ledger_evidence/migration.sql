-- @replay-safe: this additive evidence column can be retried after an
-- interrupted deployment without producing a duplicate-column failure.
ALTER TABLE "FinancialLedger" ADD COLUMN IF NOT EXISTS "evidenceJson" TEXT NOT NULL DEFAULT '{}';
