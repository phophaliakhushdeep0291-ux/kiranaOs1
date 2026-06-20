-- Preserve all existing bills while repairing databases deployed before
-- Bill.returnOfBillId was added to the Prisma schema.
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "returnOfBillId" TEXT;

CREATE INDEX IF NOT EXISTS "Bill_shopId_returnOfBillId_idx"
ON "Bill"("shopId", "returnOfBillId");
