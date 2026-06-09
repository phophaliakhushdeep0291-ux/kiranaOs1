-- Phase 47: make suppliers production-safe for offline sync.
-- Suppliers can now be soft-deleted/restored and pulled through the same
-- keyset pagination contract as products/customers/bills.

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Supplier_shopId_deletedAt_idx"
  ON "Supplier"("shopId", "deletedAt");

CREATE INDEX IF NOT EXISTS "Supplier_shopId_updatedAt_id_idx"
  ON "Supplier"("shopId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "PurchaseHistory_shopId_updatedAt_id_idx"
  ON "PurchaseHistory"("shopId", "updatedAt", "id");
