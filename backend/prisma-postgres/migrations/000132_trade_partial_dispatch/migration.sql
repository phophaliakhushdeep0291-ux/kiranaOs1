-- @replay-safe: every statement is guarded, and the added columns use
-- ADD COLUMN IF NOT EXISTS. An order may now ship in more than one consignment,
-- so the one-dispatch-per-order unique index is dropped, each dispatch carries
-- its own invoice, and an allocation records which consignment shipped it.
DROP INDEX IF EXISTS "TradeDispatch_orderId_key";

CREATE INDEX IF NOT EXISTS "TradeDispatch_shopId_orderId_idx"
ON "TradeDispatch"("shopId", "orderId");

ALTER TABLE "TradeDispatch" ADD COLUMN IF NOT EXISTS "billId" TEXT;

ALTER TABLE "TradeOrderAllocation" ADD COLUMN IF NOT EXISTS "dispatchId" TEXT;

-- Open reservations (dispatchId NULL) and shipped ones must be able to share a
-- line and batch, so the uniqueness now includes the consignment.
DROP INDEX IF EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_dispatchId_key"
ON "TradeOrderAllocation"("orderItemId", "inventoryLotId", "dispatchId");

CREATE INDEX IF NOT EXISTS "TradeOrderAllocation_shopId_dispatchId_idx"
ON "TradeOrderAllocation"("shopId", "dispatchId");
