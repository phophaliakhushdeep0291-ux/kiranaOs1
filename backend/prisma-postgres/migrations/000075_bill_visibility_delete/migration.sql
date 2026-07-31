ALTER TABLE "Bill" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Bill" ADD COLUMN "deletedReason" TEXT;

CREATE INDEX "Bill_shopId_deletedAt_businessDate_idx" ON "Bill"("shopId", "deletedAt", "businessDate");
