-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountLast4" TEXT,
    "fileName" TEXT NOT NULL,
    "statementFrom" TIMESTAMP(3) NOT NULL,
    "statementTo" TIMESTAMP(3) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "fingerprint" TEXT NOT NULL,
    "importedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BankStatementTransaction" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "direction" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "balancePaise" BIGINT,
    "fingerprint" TEXT NOT NULL,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "reconciledAmountPaise" BIGINT NOT NULL DEFAULT 0,
    "ignoredReason" TEXT,
    "ignoredByUserId" TEXT,
    "ignoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankStatementTransaction_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BankReconciliationAllocation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bankStatementTransactionId" TEXT NOT NULL,
    "ledgerRowId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "activeLedgerKey" TEXT,
    "activeBankLedgerKey" TEXT,
    "method" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "matchedByUserId" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    CONSTRAINT "BankReconciliationAllocation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BankReconciliationEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bankStatementTransactionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankReconciliationEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankStatementImport_shopId_fingerprint_key" ON "BankStatementImport"("shopId", "fingerprint");
CREATE INDEX "BankStatementImport_shopId_createdAt_idx" ON "BankStatementImport"("shopId", "createdAt");
CREATE INDEX "BankStatementImport_shopId_accountType_statementFrom_statementTo_idx" ON "BankStatementImport"("shopId", "accountType", "statementFrom", "statementTo");
CREATE UNIQUE INDEX "BankStatementTransaction_shopId_fingerprint_key" ON "BankStatementTransaction"("shopId", "fingerprint");
CREATE INDEX "BankStatementTransaction_shopId_transactionDate_idx" ON "BankStatementTransaction"("shopId", "transactionDate");
CREATE INDEX "BankStatementTransaction_shopId_matchStatus_transactionDate_idx" ON "BankStatementTransaction"("shopId", "matchStatus", "transactionDate");
CREATE INDEX "BankStatementTransaction_importId_rowNumber_idx" ON "BankStatementTransaction"("importId", "rowNumber");
CREATE UNIQUE INDEX "BankReconciliationAllocation_activeLedgerKey_key" ON "BankReconciliationAllocation"("activeLedgerKey");
CREATE UNIQUE INDEX "BankReconciliationAllocation_activeBankLedgerKey_key" ON "BankReconciliationAllocation"("activeBankLedgerKey");
CREATE INDEX "BankReconciliationAllocation_shopId_status_matchedAt_idx" ON "BankReconciliationAllocation"("shopId", "status", "matchedAt");
CREATE INDEX "BankReconciliationAllocation_bankStatementTransactionId_status_idx" ON "BankReconciliationAllocation"("bankStatementTransactionId", "status");
CREATE INDEX "BankReconciliationAllocation_ledgerRowId_status_idx" ON "BankReconciliationAllocation"("ledgerRowId", "status");
CREATE INDEX "BankReconciliationEvent_shopId_createdAt_idx" ON "BankReconciliationEvent"("shopId", "createdAt");
CREATE INDEX "BankReconciliationEvent_bankStatementTransactionId_createdAt_idx" ON "BankReconciliationEvent"("bankStatementTransactionId", "createdAt");
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationAllocation" ADD CONSTRAINT "BankReconciliationAllocation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationAllocation" ADD CONSTRAINT "BankReconciliationAllocation_bankStatementTransactionId_fkey" FOREIGN KEY ("bankStatementTransactionId") REFERENCES "BankStatementTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationAllocation" ADD CONSTRAINT "BankReconciliationAllocation_ledgerRowId_fkey" FOREIGN KEY ("ledgerRowId") REFERENCES "FinancialLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationEvent" ADD CONSTRAINT "BankReconciliationEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationEvent" ADD CONSTRAINT "BankReconciliationEvent_bankStatementTransactionId_fkey" FOREIGN KEY ("bankStatementTransactionId") REFERENCES "BankStatementTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;