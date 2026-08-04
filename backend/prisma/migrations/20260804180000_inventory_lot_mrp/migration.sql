-- Per-batch MRP, so a medicine is capped against the strip in hand.
--
-- A product carries one `mrp`, but a manufacturer revises the printed price
-- between batches: the box on the shelf from March and the box from August are
-- the same product at two different MRPs. Billing caps every line against
-- Product.mrp today, which means whichever batch FEFO actually dispensed, the
-- ceiling came from the product record. That is wrong in both directions —
-- it permits charging above the strip the customer is holding, and it rejects
-- an honest price on a batch whose MRP was raised.
--
-- Nullable on purpose: an existing lot has no batch price and must keep
-- resolving to Product.mrp exactly as before. Only a lot received with its own
-- printed MRP overrides the ceiling, so this is additive for every shop that
-- never touches it.
--
-- Paise shadow mirrors costPerRateUnit/costPerRateUnitPaise on the same table and
-- is registered in scripts/money-paise-reconciliation.js.
ALTER TABLE "InventoryLot" ADD COLUMN "mrp" REAL;
ALTER TABLE "InventoryLot" ADD COLUMN "mrpPaise" BIGINT;
