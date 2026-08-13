-- @replay-safe
-- A provider payment is a single financial fact and may activate only one
-- local transaction. Existing duplicates make the unique-index creation fail
-- visibly instead of silently choosing a winner.
DROP INDEX IF EXISTS "PaymentTransaction_provider_providerPaymentId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_provider_providerPaymentId_key"
  ON "PaymentTransaction"("provider", "providerPaymentId");
