ALTER TABLE "LoyaltyTransaction" ADD COLUMN "lifecycleCycle" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "LoyaltyTransaction_billId_type_key";
CREATE UNIQUE INDEX "LoyaltyTransaction_billId_type_lifecycleCycle_key"
ON "LoyaltyTransaction"("billId", "type", "lifecycleCycle");
