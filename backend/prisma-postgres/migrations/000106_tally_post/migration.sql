-- One row per document already pushed into TallyPrime. See the SQLite twin at
-- prisma/migrations/20260813120000_tally_post.
--
-- Tally's importer is not idempotent: the same envelope sent twice creates the
-- vouchers twice. The unique key below is what makes a second "Send to Tally"
-- a no-op rather than a doubled month of turnover in the shop's own books.
--
-- @replay-safe: every statement is guarded, so an interrupted deploy can replay
-- this migration without error.
CREATE TABLE IF NOT EXISTS "TallyPost" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "voucherNumber" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TallyPost_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "TallyPost"
    ADD CONSTRAINT "TallyPost_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The idempotency key itself.
CREATE UNIQUE INDEX IF NOT EXISTS "TallyPost_shopId_documentType_documentId_key"
  ON "TallyPost"("shopId", "documentType", "documentId");

CREATE INDEX IF NOT EXISTS "TallyPost_shopId_postedAt_idx"
  ON "TallyPost"("shopId", "postedAt");
