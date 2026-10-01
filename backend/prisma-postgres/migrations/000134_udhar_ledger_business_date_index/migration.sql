-- @replay-safe: CREATE INDEX IF NOT EXISTS, no data change.
--
-- Shop-wide udhar reads by date had no index to sit on. Daily closing, the
-- payment-mode report, P&L and the payment summary all read UdharLedger by shopId
-- plus a businessDate window with neither a customerId nor a locationId to narrow
-- it, and the two existing composites cannot serve that shape because their second
-- column is unconstrained. The read degraded with the shop's ledger history rather
-- than with the size of the window it asked for.
CREATE INDEX IF NOT EXISTS "UdharLedger_shopId_businessDate_idx"
    ON "UdharLedger"("shopId", "businessDate");
