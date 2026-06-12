-- Track total discount value redeemed per offer
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "discountGiven" DOUBLE PRECISION NOT NULL DEFAULT 0;
