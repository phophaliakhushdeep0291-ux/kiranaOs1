-- Add durable idempotency columns for bill sync retries and append-only finance tables.
-- All existing data is preserved; new identity columns are nullable for legacy rows.

ALTER TABLE "Bill" ADD COLUMN "clientBillId" TEXT;
ALTER TABLE "Bill" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Bill" ADD COLUMN "sourceDeviceId" TEXT;

ALTER TABLE "Payment" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "clientPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN "sourceDeviceId" TEXT;

UPDATE "Payment"
SET "shopId" = (
  SELECT "Bill"."shopId"
  FROM "Bill"
  WHERE "Bill"."id" = "Payment"."billId"
)
WHERE "shopId" IS NULL;

ALTER TABLE "StockLedger" ADD COLUMN "clientMovementId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "sourceDeviceId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "sourceId" TEXT;

ALTER TABLE "UdharLedger" ADD COLUMN "clientLedgerId" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN "sourceDeviceId" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "UdharLedger" ADD COLUMN "sourceId" TEXT;

CREATE TABLE "SyncCommand" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ChangeLog" (
  "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "shopId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "FinancialLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  "businessDate" DATETIME NOT NULL,
  "serverSeq" BIGINT,
  "idempotencyKey" TEXT NOT NULL,
  "reversedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
