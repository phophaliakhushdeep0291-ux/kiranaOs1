-- Add durable idempotency columns for bill sync retries and append-only finance tables.
-- This migration is additive and data-preserving for production databases.

ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "clientBillId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "sourceDeviceId" TEXT;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "clientPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "sourceDeviceId" TEXT;

UPDATE "Payment"
SET "shopId" = "Bill"."shopId"
FROM "Bill"
WHERE "Payment"."billId" = "Bill"."id"
  AND "Payment"."shopId" IS NULL;

ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "clientMovementId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "sourceDeviceId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;

ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "clientLedgerId" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "sourceDeviceId" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;

CREATE TABLE IF NOT EXISTS "SyncCommand" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "userId" TEXT,
  "deviceId" TEXT,
  "clientCommandId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "resultJson" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncCommand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChangeLog" (
  "seq" BIGSERIAL NOT NULL,
  "shopId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("seq")
);

CREATE TABLE IF NOT EXISTS "FinancialLedger" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "customerId" TEXT,
  "supplierId" TEXT,
  "billId" TEXT,
  "paymentId" TEXT,
  "purchaseBillId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amountPaise" BIGINT NOT NULL,
  "paymentMode" TEXT,
  "businessDate" TIMESTAMP(3) NOT NULL,
  "serverSeq" BIGINT,
  "idempotencyKey" TEXT NOT NULL,
  "reversedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Bill_shopId_idempotencyKey_key" ON "Bill"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_shopId_sourceDeviceId_clientBillId_key" ON "Bill"("shopId", "sourceDeviceId", "clientBillId");

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_shopId_idempotencyKey_key" ON "Payment"("shopId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "Payment_shopId_createdAt_idx" ON "Payment"("shopId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "StockLedger_shopId_idempotencyKey_key" ON "StockLedger"("shopId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "StockLedger_shopId_sourceType_sourceId_idx" ON "StockLedger"("shopId", "sourceType", "sourceId");

CREATE UNIQUE INDEX IF NOT EXISTS "UdharLedger_shopId_idempotencyKey_key" ON "UdharLedger"("shopId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "UdharLedger_shopId_reversalOfLedgerId_idx" ON "UdharLedger"("shopId", "reversalOfLedgerId");
CREATE INDEX IF NOT EXISTS "UdharLedger_shopId_sourceType_sourceId_idx" ON "UdharLedger"("shopId", "sourceType", "sourceId");

CREATE UNIQUE INDEX IF NOT EXISTS "SyncCommand_shopId_idempotencyKey_key" ON "SyncCommand"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "SyncCommand_shopId_deviceId_clientCommandId_key" ON "SyncCommand"("shopId", "deviceId", "clientCommandId");
CREATE INDEX IF NOT EXISTS "SyncCommand_shopId_status_createdAt_idx" ON "SyncCommand"("shopId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "ChangeLog_shopId_seq_idx" ON "ChangeLog"("shopId", "seq");
CREATE INDEX IF NOT EXISTS "ChangeLog_shopId_entityType_entityId_idx" ON "ChangeLog"("shopId", "entityType", "entityId");

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialLedger_shopId_idempotencyKey_key" ON "FinancialLedger"("shopId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "FinancialLedger_shopId_businessDate_idx" ON "FinancialLedger"("shopId", "businessDate");
CREATE INDEX IF NOT EXISTS "FinancialLedger_shopId_customerId_idx" ON "FinancialLedger"("shopId", "customerId");
CREATE INDEX IF NOT EXISTS "FinancialLedger_shopId_billId_idx" ON "FinancialLedger"("shopId", "billId");
CREATE INDEX IF NOT EXISTS "FinancialLedger_shopId_sourceType_sourceId_idx" ON "FinancialLedger"("shopId", "sourceType", "sourceId");
