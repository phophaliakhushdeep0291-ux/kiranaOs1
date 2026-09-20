-- Shop-wide udhar reads by date had no index to sit on.
--
-- Daily closing, the payment-mode report, P&L and the payment summary all read
-- UdharLedger by shopId plus a businessDate window, with neither a customerId nor
-- a locationId to narrow it. UdharLedger_shopId_customerId_businessDate_idx and
-- UdharLedger_shopId_locationId_businessDate_idx cannot serve that shape — their
-- second column is unconstrained — so the planner seeked on the shopId prefix of
-- a unique key and then date-filtered the shop's whole ledger history in the
-- engine. End of day therefore got slower every day the shop traded.
CREATE INDEX IF NOT EXISTS "UdharLedger_shopId_businessDate_idx"
    ON "UdharLedger"("shopId", "businessDate");
