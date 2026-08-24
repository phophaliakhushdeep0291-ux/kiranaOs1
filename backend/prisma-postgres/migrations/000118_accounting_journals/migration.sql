-- Double-entry accounting foundation for the journal posting service.
-- The SQLite twin is maintained by the local schema workflow; this migration
-- is the production PostgreSQL contract for the same Prisma models.
--
-- @replay-safe: all tables and indexes are guarded. Constraints live inside
-- their guarded table definitions, so an interrupted deployment can replay.

CREATE TABLE IF NOT EXISTS "ChartOfAccount" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "normalSide" TEXT NOT NULL,
  "systemKey" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChartOfAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChartOfAccount_shopId_code_key"
  ON "ChartOfAccount"("shopId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "ChartOfAccount_shopId_systemKey_key"
  ON "ChartOfAccount"("shopId", "systemKey");
CREATE INDEX IF NOT EXISTS "ChartOfAccount_shopId_category_active_idx"
  ON "ChartOfAccount"("shopId", "category", "active");

CREATE TABLE IF NOT EXISTS "JournalEntry" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "businessDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "description" TEXT,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "reversalOfId" TEXT,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_shopId_sourceType_sourceId_key"
  ON "JournalEntry"("shopId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "JournalEntry_shopId_businessDate_status_idx"
  ON "JournalEntry"("shopId", "businessDate", "status");

CREATE TABLE IF NOT EXISTS "JournalLine" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "financialLedgerId" TEXT,
  "lineNumber" INTEGER NOT NULL,
  "debitPaise" BIGINT NOT NULL DEFAULT 0,
  "creditPaise" BIGINT NOT NULL DEFAULT 0,
  "memo" TEXT,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalLine_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "JournalLine_journalEntryId_lineNumber_key"
  ON "JournalLine"("journalEntryId", "lineNumber");
CREATE INDEX IF NOT EXISTS "JournalLine_shopId_accountId_createdAt_idx"
  ON "JournalLine"("shopId", "accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "JournalLine_financialLedgerId_idx"
  ON "JournalLine"("financialLedgerId");
