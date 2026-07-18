ALTER TABLE "BillItem" ADD COLUMN "hsn" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "originalBillItemId" TEXT;
ALTER TABLE "BillCounter" ADD COLUMN "returnLastNumber" INTEGER NOT NULL DEFAULT 0;

-- Best-effort history bootstrap. Future invoices capture HSN when the bill is
-- created so later product edits cannot rewrite an old tax document.
UPDATE "BillItem"
SET "hsn" = (
  SELECT "Product"."hsn"
  FROM "Product"
  WHERE "Product"."id" = "BillItem"."productId"
)
WHERE "productId" IS NOT NULL;

CREATE INDEX "BillItem_originalBillItemId_idx" ON "BillItem"("originalBillItemId");
