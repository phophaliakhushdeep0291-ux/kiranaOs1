-- Per-line discounts: flat rupee discount stored on each bill item.
ALTER TABLE "BillItem" ADD COLUMN "lineDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "BillItem" ADD COLUMN "lineDiscountPaise" BIGINT;
