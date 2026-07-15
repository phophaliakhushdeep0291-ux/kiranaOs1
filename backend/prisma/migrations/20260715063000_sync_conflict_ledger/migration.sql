CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "clientConflictId" TEXT,
    "deviceId" TEXT,
    "reportedByUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "localSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "serverSnapshotJson" TEXT,
    "baseSnapshotJson" TEXT,
    "serverVersion" TEXT,
    "resolution" TEXT,
    "mergedPayloadJson" TEXT,
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedByDeviceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncConflict_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SyncConflict_shopId_sourceEventId_key" ON "SyncConflict"("shopId", "sourceEventId");
CREATE UNIQUE INDEX "SyncConflict_shopId_clientConflictId_key" ON "SyncConflict"("shopId", "clientConflictId");
CREATE INDEX "SyncConflict_shopId_status_createdAt_idx" ON "SyncConflict"("shopId", "status", "createdAt");
CREATE INDEX "SyncConflict_shopId_entityType_entityId_idx" ON "SyncConflict"("shopId", "entityType", "entityId");
CREATE INDEX "SyncConflict_shopId_deviceId_createdAt_idx" ON "SyncConflict"("shopId", "deviceId", "createdAt");
CREATE INDEX "SyncConflict_expiresAt_idx" ON "SyncConflict"("expiresAt");
