-- Line-item notes: free-text note stored on each bill item (printed on receipts).
ALTER TABLE "BillItem" ADD COLUMN "note" TEXT;
