-- Supplier statements scan one tenant/counterparty in economic-date order.
-- FinancialLedger already carries the append-only supplier identity; this index
-- makes that subledger usable without a shop-wide table scan.
CREATE INDEX "FinancialLedger_shopId_supplierId_businessDate_idx"
ON "FinancialLedger"("shopId", "supplierId", "businessDate");
