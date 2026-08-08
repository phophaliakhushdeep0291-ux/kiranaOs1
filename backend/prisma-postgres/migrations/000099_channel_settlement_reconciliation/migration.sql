-- @replay-safe: all create and index statements are guarded and contain no
-- destructive mutation, so an interrupted deployment can safely replay them.
CREATE TABLE IF NOT EXISTS "ChannelSettlementImport" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT,
  "provider" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "mappingJson" TEXT NOT NULL,
  "periodFrom" TIMESTAMP(3),
  "periodTo" TIMESTAMP(3),
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "grossPaise" BIGINT NOT NULL DEFAULT 0,
  "calculatedNetPaise" BIGINT NOT NULL DEFAULT 0,
  "paidNetPaise" BIGINT NOT NULL DEFAULT 0,
  "variancePaise" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'processed',
  "importedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelSettlementImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelSettlementImport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelSettlementImport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ChannelSettlementRow" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "locationId" TEXT,
  "provider" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rowFingerprint" TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "orderDate" TIMESTAMP(3) NOT NULL,
  "channelStatus" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "grossPaise" BIGINT NOT NULL,
  "merchantDiscountPaise" BIGINT NOT NULL DEFAULT 0,
  "platformCommissionPaise" BIGINT NOT NULL DEFAULT 0,
  "paymentFeePaise" BIGINT NOT NULL DEFAULT 0,
  "taxOnFeesPaise" BIGINT NOT NULL DEFAULT 0,
  "tcsPaise" BIGINT NOT NULL DEFAULT 0,
  "tdsPaise" BIGINT NOT NULL DEFAULT 0,
  "adjustmentPaise" BIGINT NOT NULL DEFAULT 0,
  "refundPaise" BIGINT NOT NULL DEFAULT 0,
  "providerExpectedNetPaise" BIGINT,
  "calculatedExpectedNetPaise" BIGINT NOT NULL,
  "paidNetPaise" BIGINT NOT NULL,
  "variancePaise" BIGINT NOT NULL,
  "mismatchTypesJson" TEXT NOT NULL DEFAULT '[]',
  "matchStatus" TEXT NOT NULL DEFAULT 'open',
  "candidateCustomerOrderId" TEXT,
  "candidateBillId" TEXT,
  "matchedCustomerOrderId" TEXT,
  "matchedBillId" TEXT,
  "bankStatementTransactionId" TEXT,
  "resolutionStatus" TEXT NOT NULL DEFAULT 'open',
  "resolutionNote" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelSettlementRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelSettlementRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ChannelSettlementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelSettlementRow_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelSettlementRow_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ChannelSettlementEvent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "rowId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousJson" TEXT NOT NULL,
  "nextJson" TEXT NOT NULL,
  "reason" TEXT,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelSettlementEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelSettlementEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelSettlementEvent_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ChannelSettlementRow"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelSettlementImport_shopId_provider_fileHash_key" ON "ChannelSettlementImport"("shopId", "provider", "fileHash");
CREATE INDEX IF NOT EXISTS "ChannelSettlementImport_shopId_createdAt_idx" ON "ChannelSettlementImport"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChannelSettlementImport_shopId_locationId_createdAt_idx" ON "ChannelSettlementImport"("shopId", "locationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChannelSettlementImport_shopId_provider_createdAt_idx" ON "ChannelSettlementImport"("shopId", "provider", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelSettlementRow_importId_rowNumber_key" ON "ChannelSettlementRow"("importId", "rowNumber");
CREATE INDEX IF NOT EXISTS "ChannelSettlementRow_shopId_externalOrderId_idx" ON "ChannelSettlementRow"("shopId", "externalOrderId");
CREATE INDEX IF NOT EXISTS "ChannelSettlementRow_shopId_locationId_orderDate_idx" ON "ChannelSettlementRow"("shopId", "locationId", "orderDate");
CREATE INDEX IF NOT EXISTS "ChannelSettlementRow_shopId_resolutionStatus_orderDate_idx" ON "ChannelSettlementRow"("shopId", "resolutionStatus", "orderDate");
CREATE INDEX IF NOT EXISTS "ChannelSettlementRow_shopId_provider_orderDate_idx" ON "ChannelSettlementRow"("shopId", "provider", "orderDate");
CREATE INDEX IF NOT EXISTS "ChannelSettlementRow_importId_matchStatus_idx" ON "ChannelSettlementRow"("importId", "matchStatus");
CREATE INDEX IF NOT EXISTS "ChannelSettlementEvent_shopId_rowId_createdAt_idx" ON "ChannelSettlementEvent"("shopId", "rowId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChannelSettlementEvent_shopId_action_createdAt_idx" ON "ChannelSettlementEvent"("shopId", "action", "createdAt");
