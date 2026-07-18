ALTER TABLE "BillItem" ADD COLUMN "hsn" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "originalBillItemId" TEXT;
ALTER TABLE "BillCounter" ADD COLUMN "returnLastNumber" INTEGER NOT NULL DEFAULT 0;

-- Best-effort history bootstrap. Future invoices capture HSN when the bill is
-- created so later product edits cannot rewrite an 