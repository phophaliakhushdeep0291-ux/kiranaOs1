-- Track total discount value redeemed per offer
ALTER TABLE "Offer" ADD COLUMN "discountGiven" REAL NOT NULL DEFAULT 0;
