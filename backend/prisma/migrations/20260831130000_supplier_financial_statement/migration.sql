-- Supplier statements scan one tenant/counterparty in economic-date order.
-- FinancialLedger already carries the append-only supplier identity; this index
-- makes that subledger usable without a shop-wide table scan.
-- @replay-safe: local schema recovery can safely replay this additive index.
CREATE INDEX IF NOT EXISTS "FinancialLedger_shopId_supplierId_businessDate_idx"
ON "FinancialLedger"("shopId", "supplierId", "businessDate");
