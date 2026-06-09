-- KiranaOS Phase 4F sync pull keyset pagination indexes.
-- Manually authored forward migration for PostgreSQL deployments.

CREATE INDEX IF NOT EXISTS "Product_shopId_updatedAt_id_idx" ON "Product"("shopId", "updatedAt", "id");
CREATE INDEX IF NOT EXISTS "Customer_shopId_updatedAt_id_idx" ON "Customer"("shopId", "updatedAt", "id");
CREATE INDEX IF NOT EXISTS "Bill_shopId_updatedAt_id_idx" ON "Bill"("shopId", "updatedAt", "id");
CREATE INDEX IF NOT EXISTS "StockLedger_shopId_updatedAt_id_idx" ON "StockLedger"("shopId", "updatedAt", "id");
CREATE INDEX IF NOT EXISTS "UdharLedger_shopId_updatedAt_id_idx" ON "UdharLedger"("shopId", "updatedAt", "id");
