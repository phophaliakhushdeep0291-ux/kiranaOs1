-- @replay-safe
-- Stock movements omit money fields that do not apply to their action.
-- Match each rupee default with its paise default and preserve existing paise values.
ALTER TABLE "StockLedger" ALTER COLUMN "purchaseBillAmountPaise" SET DEFAULT 0;
UPDATE "StockLedger" SET "purchaseBillAmountPaise" = ROUND("purchaseBillAmount"::numeric * 100)::bigint
WHERE "purchaseBillAmountPaise" IS NULL;

ALTER TABLE "StockLedger" ALTER COLUMN "calculatedBuyRatePaise" SET DEFAULT 0;
UPDATE "StockLedger" SET "calculatedBuyRatePaise" = ROUND("calculatedBuyRate"::numeric * 100)::bigint
WHERE "calculatedBuyRatePaise" IS NULL;

ALTER TABLE "StockLedger" ALTER COLUMN "purchasePaidAmountPaise" SET DEFAULT 0;
UPDATE "StockLedger" SET "purchasePaidAmountPaise" = ROUND("purchasePaidAmount"::numeric * 100)::bigint
WHERE "purchasePaidAmountPaise" IS NULL;

ALTER TABLE "StockLedger" ALTER COLUMN "purchaseDueAmountPaise" SET DEFAULT 0;
UPDATE "StockLedger" SET "purchaseDueAmountPaise" = ROUND("purchaseDueAmount"::numeric * 100)::bigint
WHERE "purchaseDueAmountPaise" IS NULL;

ALTER TABLE "StockLedger" ALTER COLUMN "damageLossValuePaise" SET DEFAULT 0;
UPDATE "StockLedger" SET "damageLossValuePaise" = ROUND("damageLossValue"::numeric * 100)::bigint
WHERE "damageLossValuePaise" IS NULL;
