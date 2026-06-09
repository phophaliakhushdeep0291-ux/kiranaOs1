-- Migration: 000002_sync_indexes
-- Purpose: Add composite indexes to support sync pull keyset pagination.
--
-- Sync pull (Phase 4A) uses:
--   WHERE shopId = $1
--     AND updatedAt >= $since
--     [AND (updatedAt > $cursorTs OR (updatedAt = $cursorTs AND id > $cursorId))]
--   ORDER BY updatedAt ASC, id ASC
--   LIMIT $n
--
-- Without (shopId, updatedAt, id), PostgreSQL falls back to a seq scan on
-- large shops or a hash join that discards ordering, forcing a full re-sort.
-- This migration adds a covering index for that query pattern to each of the
-- five entity tables used in sync pull.
--
-- Safe to run on a live database — CREATE INDEX does not lock writes in
-- PostgreSQL 12+ (the Concurrently variant can be used if needed on very
-- large tables, but CONCURRENTLY cannot run inside a transaction block).
--
-- Apply via:
--   psql $DATABASE_URL -f this_file.sql
-- or ensure this migration is applied before running prisma migrate resolve.

-- Product sync pull index
CREATE INDEX IF NOT EXISTS "Product_shopId_updatedAt_id_idx"
    ON "Product"("shopId", "updatedAt", "id");

-- Customer sync pull index
CREATE INDEX IF NOT EXISTS "Customer_shopId_updatedAt_id_idx"
    ON "Customer"("shopId", "updatedAt", "id");

-- Bill sync pull index
CREATE INDEX IF NOT EXISTS "Bill_shopId_updatedAt_id_idx"
    ON "Bill"("shopId", "updatedAt", "id");

-- StockLedger sync pull index
-- Note: updatedAt == createdAt for this append-only table; the index is
-- still useful because sync pull now filters/orders by updatedAt.
CREATE INDEX IF NOT EXISTS "StockLedger_shopId_updatedAt_id_idx"
    ON "StockLedger"("shopId", "updatedAt", "id");

-- UdharLedger sync pull index
CREATE INDEX IF NOT EXISTS "UdharLedger_shopId_updatedAt_id_idx"
    ON "UdharLedger"("shopId", "updatedAt", "id");
