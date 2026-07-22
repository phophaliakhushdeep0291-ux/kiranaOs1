-- Discount reasons: optional free-text reason for the bill-level discount.
ALTER TABLE "Bill" ADD COLUMN "discountReason" TEXT;
