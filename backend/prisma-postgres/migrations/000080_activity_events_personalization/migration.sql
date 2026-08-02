-- §13 User Activity Collection & Personalization Engine.
--
-- ActivityEvent is the append-only behavioural fact table; ActivityAggregate is
-- the counter read model the personalization endpoints query directly.
--
-- @replay-safe: every statement is IF NOT EXISTS, so an interrupted deploy can
-- replay this migration without error.

CREATE TABLE IF NOT EXISTS "ActivityEvent" (
  "id"            TEXT NOT NULL,
  -- Client-generated; the UNIQUE index below is what makes a retried offline
  -- batch idempotent rather than double-counted.
  "eventId"       TEXT NOT NULL,
  "shopId"        TEXT NOT NULL,
  "userId"        TEXT,
  "orgId"         TEXT,
  "deviceId"      TEXT,
  "sessionId"     TEXT,
  "eventType"     TEXT NOT NULL,
  "module"        TEXT NOT NULL DEFAULT 'other',
  "screen"        TEXT,
  "appVersion"    TEXT,
  "networkStatus" TEXT,
  "source"        TEXT NOT NULL DEFAULT 'pos',
  "durationMs"    INTEGER,
  "metadataJson"  TEXT NOT NULL DEFAULT '{}',
  "occurredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivityEvent_eventId_key" ON "ActivityEvent" ("eventId");
CREATE INDEX IF NOT EXISTS "ActivityEvent_shopId_occurredAt_idx" ON "ActivityEvent" ("shopId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ActivityEvent_shopId_eventType_occurredAt_idx" ON "ActivityEvent" ("shopId", "eventType", "occurredAt");
CREATE INDEX IF NOT EXISTS "ActivityEvent_shopId_userId_occurredAt_idx" ON "ActivityEvent" ("shopId", "userId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ActivityEvent_shopId_sessionId_idx" ON "ActivityEvent" ("shopId", "sessionId");

CREATE TABLE IF NOT EXISTS "ActivityAggregate" (
  "id"     TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  -- "*" is the shop-wide rollup. A sentinel rather than NULL: both engines treat
  -- NULLs as distinct in a unique index, so a nullable column would let every
  -- shop-wide upsert insert a duplicate instead of incrementing.
  "userId" TEXT NOT NULL DEFAULT '*',
  "kind"   TEXT NOT NULL,
  "key"    TEXT NOT NULL,
  "label"  TEXT,
  "count"  INTEGER NOT NULL DEFAULT 0,
  "score"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalMs" INTEGER NOT NULL DEFAULT 0,
  "durationSamples" INTEGER NOT NULL DEFAULT 0,
  "metaJson"    TEXT NOT NULL DEFAULT '{}',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityAggregate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivityAggregate_shopId_userId_kind_key_key"
  ON "ActivityAggregate" ("shopId", "userId", "kind", "key");
CREATE INDEX IF NOT EXISTS "ActivityAggregate_shopId_kind_score_idx"
  ON "ActivityAggregate" ("shopId", "kind", "score");
CREATE INDEX IF NOT EXISTS "ActivityAggregate_shopId_userId_kind_lastSeenAt_idx"
  ON "ActivityAggregate" ("shopId", "userId", "kind", "lastSeenAt");

DO $$
BEGIN
  ALTER TABLE "ActivityEvent"
    ADD CONSTRAINT "ActivityEvent_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ActivityAggregate"
    ADD CONSTRAINT "ActivityAggregate_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
