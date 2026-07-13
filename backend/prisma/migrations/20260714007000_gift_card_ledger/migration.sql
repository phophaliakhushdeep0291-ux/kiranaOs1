ALTER TABLE "Bill" ADD COLUMN "giftCardAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Bill" ADD COLUMN "giftCardAmountPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN "refundMode" TEXT;

CREATE TABLE "GiftCard" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "customerId" TEXT,
  "codeHash" TEXT NOT NULL,
  "codeLast4" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "initialBalancePaise" BIGINT NOT NULL,
  "balancePaise" BIGINT NOT NULL,
  "expiresAt" DATETIME,
  "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" DATETIME,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GiftCard_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GiftCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "GiftCardTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "giftCardId" TEXT NOT NULL,
  "billId" TEXT,
  "locationId" TEXT,
  "type" TEXT NOT NULL,
  "amountPaise" BIGINT NOT NULL,
  "balanceAfterPaise" BIGINT NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCardTransaction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GiftCardTransaction_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GiftCard_shopId_codeHash_key" ON "GiftCard"("shopId", "codeHash");
CREATE INDEX "GiftCard_shopId_status_createdAt_idx" ON "GiftCard"("shopId", "status", "createdAt");
CREATE INDEX "GiftCard_shopId_customerId_createdAt_idx" ON "GiftCard"("shopId", "customerId", "createdAt");
CREATE UNIQUE INDEX "GiftCardTransaction_giftCardId_billId_type_key" ON "GiftCardTransaction"("giftCardId", "billId", "type");
CREATE INDEX "GiftCardTransaction_shopId_createdAt_idx" ON "GiftCardTransaction"("shopId", "createdAt");
CREATE INDEX "GiftCardTransaction_giftCardId_createdAt_idx" ON "GiftCardTransaction"("giftCardId", "createdAt");
CREATE INDEX "GiftCardTransaction_billId_idx" ON "GiftCardTransaction"("billId");
