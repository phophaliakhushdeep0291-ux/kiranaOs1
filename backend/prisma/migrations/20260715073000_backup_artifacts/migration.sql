CREATE TABLE "BackupArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT,
  "requestedByUserId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "format" TEXT NOT NULL DEFAULT 'kiranaos_aes256gcm_gzip_v1',
  "storageProvider" TEXT,
  "objectKey" TEXT,
  "checksumSha256" TEXT,
  "sizeBytes" BIGINT,
  "recordCount" INTEGER,
  "schemaVersion" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "expiresAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BackupArtifact_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BackupArtifact_shopId_createdAt_idx" ON "BackupArtifact"("shopId", "createdAt");
CREATE INDEX "BackupArtifact_status_expiresAt_idx" ON "BackupArtifact"("status", "expiresAt");
