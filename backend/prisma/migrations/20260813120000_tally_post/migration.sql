-- One row per document already pushed into TallyPrime.
--
-- Tally's importer is not idempotent: importing the same envelope twice creates
-- the vouchers twice, so a shopkeeper who clicks "Send to Tally" again — after a
-- timeout, or just unsure whether the first click worked — would double that
-- month's turnover inside their own books, with nothing on screen to say so.
--
-- The unique key below is what makes the second send a no-op. The table holds
-- no money, only the identity of what was sent, so it can never disagree with
-- the documents it points at.
CREATE TABLE "TallyPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "voucherNumber" TEXT NOT NULL,
  "remoteId" TEXT NOT NULL,
  "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TallyPost_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The idempotency key itself.
CREATE UNIQUE INDEX "TallyPost_shopId_documentType_documentId_key"
  ON "TallyPost"("shopId", "documentType", "documentId");

CREATE INDEX "TallyPost_shopId_postedAt_idx" ON "TallyPost"("shopId", "postedAt");
