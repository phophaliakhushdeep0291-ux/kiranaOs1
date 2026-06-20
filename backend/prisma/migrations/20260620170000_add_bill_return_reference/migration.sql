-- Preserve all existing bills while adding the optional sales-return reference.
ALTER TABLE "Bill" ADD COLUMN "returnOfBillId" TEXT;

CREATE INDEX "Bill_shopId_returnOfBillId_idx"
ON "Bill"("shopId", "returnOfBillId");
