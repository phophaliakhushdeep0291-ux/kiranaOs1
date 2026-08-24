CREATE TABLE "ChartOfAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "normalSide" TEXT NOT NULL,
  "systemKey" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ChartOfAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChartOfAccount_shopId_code_key" ON "ChartOfAccount"("shopId", "code");
CREATE UNIQUE INDEX "ChartOfAccount_shopId_systemKey_key" ON "ChartOfAccount"("shopId", "systemKey");
CREATE INDEX "ChartOfAccount_shopId_category_active_idx" ON "ChartOfAccount"("shopId", "category", "active");

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "businessDate" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "description" TEXT,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "reversalOfId" TEXT,
  "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JournalEntry_shopId_sourceType_sourceId_key" ON "JournalEntry"("shopId", "sourceType", "sourceId");
CREATE INDEX "JournalEntry_shopId_businessDate_status_idx" ON "JournalEntry"("shopId", "businessDate", "status");

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "financialLedgerId" TEXT,
  "lineNumber" INTEGER NOT NULL,
  "debitPaise" BIGINT NOT NULL DEFAULT 0,
  "creditPaise" BIGINT NOT NULL DEFAULT 0,
  "memo" TEXT,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalLine_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JournalLine_journalEntryId_lineNumber_key" ON "JournalLine"("journalEntryId", "lineNumber");
CREATE INDEX "JournalLine_shopId_accountId_createdAt_idx" ON "JournalLine"("shopId", "accountId", "createdAt");
CREATE INDEX "JournalLine_financialLedgerId_idx" ON "JournalLine"("financialLedgerId");

CREATE TABLE "AccountingPeriod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" DATETIME NOT NULL,
  "endsAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "closedAt" DATETIME,
  "closedByUserId" TEXT,
  "closeReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AccountingPeriod_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AccountingPeriod_shopId_startsAt_endsAt_key" ON "AccountingPeriod"("shopId", "startsAt", "endsAt");
CREATE INDEX "AccountingPeriod_shopId_status_startsAt_endsAt_idx" ON "AccountingPeriod"("shopId", "status", "startsAt", "endsAt");
