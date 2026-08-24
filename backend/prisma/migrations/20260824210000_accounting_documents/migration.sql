CREATE TABLE "AccountingDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'review_required',
    "sourceHash" TEXT NOT NULL,
    "sourceMimeType" TEXT NOT NULL,
    "sourceBytes" INTEGER NOT NULL,
    "supplierId" TEXT,
    "supplierMatch" TEXT NOT NULL,
    "extractedJson" TEXT NOT NULL,
    "validationJson" TEXT NOT NULL,
    "suggestedJournalJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" DATETIME,
    "reviewReason" TEXT,
    "journalEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountingDocument_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AccountingDocumentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountingDocumentEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountingDocumentEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "AccountingDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AccountingDocument_shopId_sourceHash_key" ON "AccountingDocument"("shopId", "sourceHash");
CREATE INDEX "AccountingDocument_shopId_status_createdAt_idx" ON "AccountingDocument"("shopId", "status", "createdAt");
CREATE INDEX "AccountingDocument_shopId_supplierId_createdAt_idx" ON "AccountingDocument"("shopId", "supplierId", "createdAt");
CREATE INDEX "AccountingDocumentEvent_shopId_documentId_createdAt_idx" ON "AccountingDocumentEvent"("shopId", "documentId", "createdAt");
