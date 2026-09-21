-- "What stock did this bill move" had no index to sit on.
--
-- StockLedger carried a billId column and not one index containing it, so every
-- read keyed on a single sale scanned the shop's whole movement history:
--
--   cancelBill     count(shopId, billId, action='sale')
--   restoreBill    count(shopId, billId, action='cancel_reversal')
--   the sync echo  findMany(shopId, billId, action='sale'), on every replayed sale
--   assurance      findMany(shopId, billId)
--
-- `action` goes third so the two-column prefix still serves the assurance read,
-- which does not filter on it. The cost of all four grew with how long the shop
-- had been trading rather than with the one bill being asked about.
CREATE INDEX IF NOT EXISTS "StockLedger_shopId_billId_action_idx"
    ON "StockLedger"("shopId", "billId", "action");
