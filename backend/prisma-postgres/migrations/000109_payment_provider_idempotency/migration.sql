-- @replay-safe
-- Refuse deployment if historical data already applied one provider payment
-- to multiple transactions. That condition requires operator reconciliation;
-- an automated migration must not guess which financial row is authoritative.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PaymentTransaction"
    WHERE "providerPaymentId" IS NOT NULL
    GROUP BY "provider", "providerPaymentId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate provider payment ids exist in PaymentTransaction; reconcile them before deploying 000109_payment_provider_idempotency';
  END IF;
END $$;

DROP INDEX IF EXISTS "PaymentTransaction_provider_providerPaymentId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_provider_providerPaymentId_key"
  ON "PaymentTransaction"("provider", "providerPaymentId");
