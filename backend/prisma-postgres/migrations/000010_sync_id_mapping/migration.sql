-- Phase 30: server-side localId -> serverId mapping for offline-first sync.
-- This lets a batch create a local product/customer and then create a bill that
-- references that local id before the frontend has persisted the returned server id.

CREATE TABLE IF NOT EXISTS "SyncIdMapping" (
  "id" TEXT PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "localId" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "sourceEventId" TEXT,
  "deviceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncIdMapping_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SyncIdMapping_shopId_entityType_localId_key"
  ON "SyncIdMapping"("shopId", "entityType", "localId");

CREATE INDEX IF NOT EXISTS "SyncIdMapping_shopId_entityType_serverId_idx"
  ON "SyncIdMapping"("shopId", "entityType", "serverId");

CREATE INDEX IF NOT EXISTS "SyncIdMapping_shopId_updatedAt_id_idx"
  ON "SyncIdMapping"("shopId", "updatedAt", "id");
