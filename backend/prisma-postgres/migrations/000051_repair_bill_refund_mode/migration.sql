-- Production repair: some deployments can have the Bill return/gift-card Prisma
-- fields in the generated client before the Railway PostgreSQL database has the
-- matching nullable columns. This migration is intentionally idempotent and
-- data-preserving so migrate deploy can heal a drifted production database.
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "refundMode" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "giftCardAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "giftCardAmountPaise" BIGINT;

