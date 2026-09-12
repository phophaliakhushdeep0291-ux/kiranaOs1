-- Indexes here are guarded; the two ADD COLUMNs are not, because SQLite has no
-- ADD COLUMN IF NOT EXISTS — the same convention the other SQLite migrations in
-- this repo follow. An order may now ship in more than
-- one consignment, so the one-dispatch-per-order unique index is dropped, each
-- dispatch carries its own invoice, and an allocation records which consignment
-- shipped it. Prisma created that constraint as a standalone unique INDEX, so it
-- can be dropped outright — SQLite would otherwise need a full table rebuild.
DROP INDEX IF EXISTS "TradeDispatch_orderId_key";

CREATE INDEX IF NOT EXISTS "TradeDispatch_shopId_orderId_idx"
ON "TradeDispatch"("shopId", "orderId");

ALTER TABLE "TradeDispatch" ADD COLUMN "billId" TEXT;

ALTER TABLE "TradeOrderAllocation" ADD COLUMN "dispatchId" TEXT;

-- Open reservations (dispatchId NULL) and shipped ones must be able to share a
-- line and batch, so the uniqueness now includes the consignment.
DROP INDEX IF EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_dispatchId_key"
ON "TradeOrderAllocation"("orderItemId", "inventoryLotId", "dispatchId");

CREATE INDEX IF NOT EXISTS "TradeOrderAllocation_shopId_dispatchId_idx"
ON "TradeOrderAllocation"("shopId", "dispatchId");
