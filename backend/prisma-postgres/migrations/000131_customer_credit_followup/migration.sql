-- @replay-safe: additive nullable columns, safe after an interrupted deploy.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "udharLimit" DOUBLE PRECISION;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "dueDate" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "promiseToPayDate" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "notes" TEXT;
