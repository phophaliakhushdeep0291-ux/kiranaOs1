-- @replay-safe: every statement is guarded, and the added columns use
-- ADD COLUMN IF NOT EXISTS. An order may now ship in more than one consignment,
-- so the one-dispatch-per-order uniqueness is dropped, each dispatch carries its
-- own invoice, and an allocation records which consignment shipped it.
--
-- The two uniques being dropped here were created differently in 000108, and in
-- PostgreSQL that difference decides how they can be removed:
--   TradeDispatch.orderId was an inline column UNIQUE, which PostgreSQL makes a
--     CONSTRAINT. Its backing index cannot be dropped on its own — "cannot drop
--     index ... because constraint ... requires it" — so the constraint goes.
--   TradeOrderAllocation's was a standalone CREATE UNIQUE INDEX, a bare index,
--     so DROP INDEX is what removes it.
-- Both forms are attempted for each, guarded, so this is correct either way and
-- stays replay-safe. SQLite has no constraint/index split, which is why its
-- migration drops plain indexes and this one cannot.
ALTER TABLE "TradeDispatch" DROP CONSTRAINT IF EXISTS "TradeDispatch_orderId_key";
DROP INDEX IF EXISTS "TradeDispatch_orderId_key";

CREATE INDEX IF NOT EXISTS "TradeDispatch_shopId_orderId_idx"
ON "TradeDispatch"("shopId", "orderId");

ALTER TABLE "TradeDispatch" ADD COLUMN IF NOT EXISTS "billId" TEXT;

ALTER TABLE "TradeOrderAllocation" ADD COLUMN IF NOT EXISTS "dispatchId" TEXT;

-- Open reservations (dispatchId NULL) and shipped ones must be able to share a
-- line and batch, so the uniqueness now includes the consignment.
ALTER TABLE "TradeOrderAllocation" DROP CONSTRAINT IF EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_key";
DROP INDEX IF EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_dispatchId_key"
ON "TradeOrderAllocation"("orderItemId", "inventoryLotId", "dispatchId");

CREATE INDEX IF NOT EXISTS "TradeOrderAllocation_shopId_dispatchId_idx"
ON "TradeOrderAllocation"("shopId", "dispatchId");
