-- Phase 27: add non-breaking integer paise shadow columns for financial correctness.
-- Existing rupee Float columns remain for API/backward compatibility.
-- These columns allow migration/reconciliation before switching runtime reads/writes.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "costPerRateUnitPaise" BIGINT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "minPricePerRateUnitPaise" BIGINT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultPricePerRateUnitPaise" BIGINT;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "udharAmountPaise" BIGINT;

ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "subtotalPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "discountPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "gstPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "grandTotalPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "actualAmountPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "buyerPaidAmountPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "waivedAmountPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "grossProfitPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "paidAmountPaise" BIGINT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "creditAmountPaise" BIGINT;

ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "ratePerRateUnitPaise" BIGINT;
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "costPerRateUnitPaise" BIGINT;
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "lineTotalPaise" BIGINT;
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "lineCostPaise" BIGINT;
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "lineProfitPaise" BIGINT;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "amountPaise" BIGINT;

ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "purchaseBillAmountPaise" BIGINT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "calculatedBuyRatePaise" BIGINT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "damageLossValuePaise" BIGINT;

ALTER TABLE "UdharLedger" ADD COLUMN IF NOT EXISTS "amountPaise" BIGINT;

ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "pricePerRateUnitPaise" BIGINT;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "totalCostPaise" BIGINT;
ALTER TABLE "PurchaseHistory" ADD COLUMN IF NOT EXISTS "billAmountPaise" BIGINT;

-- Backfill only rows where the shadow value is still null. Runtime can safely rerun
-- scripts/money-paise-reconciliation.js later to check and repair mismatches.
UPDATE "Product" SET
  "costPerRateUnitPaise" = ROUND((COALESCE("costPerRateUnit", 0)::numeric * 100))::bigint,
  "minPricePerRateUnitPaise" = ROUND((COALESCE("minPricePerRateUnit", 0)::numeric * 100))::bigint,
  "defaultPricePerRateUnitPaise" = ROUND((COALESCE("defaultPricePerRateUnit", 0)::numeric * 100))::bigint
WHERE "costPerRateUnitPaise" IS NULL
   OR "minPricePerRateUnitPaise" IS NULL
   OR "defaultPricePerRateUnitPaise" IS NULL;

UPDATE "Customer" SET
  "udharAmountPaise" = ROUND((COALESCE("udharAmount", 0)::numeric * 100))::bigint
WHERE "udharAmountPaise" IS NULL;

UPDATE "Bill" SET
  "subtotalPaise" = ROUND((COALESCE("subtotal", 0)::numeric * 100))::bigint,
  "discountPaise" = ROUND((COALESCE("discount", 0)::numeric * 100))::bigint,
  "gstPaise" = ROUND((COALESCE("gst", 0)::numeric * 100))::bigint,
  "grandTotalPaise" = ROUND((COALESCE("grandTotal", 0)::numeric * 100))::bigint,
  "actualAmountPaise" = ROUND((COALESCE("actualAmount", 0)::numeric * 100))::bigint,
  "buyerPaidAmountPaise" = ROUND((COALESCE("buyerPaidAmount", 0)::numeric * 100))::bigint,
  "waivedAmountPaise" = ROUND((COALESCE("waivedAmount", 0)::numeric * 100))::bigint,
  "grossProfitPaise" = ROUND((COALESCE("grossProfit", 0)::numeric * 100))::bigint,
  "paidAmountPaise" = ROUND((COALESCE("paidAmount", 0)::numeric * 100))::bigint,
  "creditAmountPaise" = ROUND((COALESCE("creditAmount", 0)::numeric * 100))::bigint
WHERE "subtotalPaise" IS NULL
   OR "discountPaise" IS NULL
   OR "gstPaise" IS NULL
   OR "grandTotalPaise" IS NULL
   OR "actualAmountPaise" IS NULL
   OR "buyerPaidAmountPaise" IS NULL
   OR "waivedAmountPaise" IS NULL
   OR "grossProfitPaise" IS NULL
   OR "paidAmountPaise" IS NULL
   OR "creditAmountPaise" IS NULL;

UPDATE "BillItem" SET
  "ratePerRateUnitPaise" = ROUND((COALESCE("ratePerRateUnit", 0)::numeric * 100))::bigint,
  "costPerRateUnitPaise" = ROUND((COALESCE("costPerRateUnit", 0)::numeric * 100))::bigint,
  "lineTotalPaise" = ROUND((COALESCE("lineTotal", 0)::numeric * 100))::bigint,
  "lineCostPaise" = ROUND((COALESCE("lineCost", 0)::numeric * 100))::bigint,
  "lineProfitPaise" = ROUND((COALESCE("lineProfit", 0)::numeric * 100))::bigint
WHERE "ratePerRateUnitPaise" IS NULL
   OR "costPerRateUnitPaise" IS NULL
   OR "lineTotalPaise" IS NULL
   OR "lineCostPaise" IS NULL
   OR "lineProfitPaise" IS NULL;

UPDATE "Payment" SET
  "amountPaise" = ROUND((COALESCE("amount", 0)::numeric * 100))::bigint
WHERE "amountPaise" IS NULL;

UPDATE "StockLedger" SET
  "purchaseBillAmountPaise" = ROUND((COALESCE("purchaseBillAmount", 0)::numeric * 100))::bigint,
  "calculatedBuyRatePaise" = ROUND((COALESCE("calculatedBuyRate", 0)::numeric * 100))::bigint,
  "damageLossValuePaise" = ROUND((COALESCE("damageLossValue", 0)::numeric * 100))::bigint
WHERE "purchaseBillAmountPaise" IS NULL
   OR "calculatedBuyRatePaise" IS NULL
   OR "damageLossValuePaise" IS NULL;

UPDATE "UdharLedger" SET
  "amountPaise" = ROUND((COALESCE("amount", 0)::numeric * 100))::bigint
WHERE "amountPaise" IS NULL;

UPDATE "PurchaseHistory" SET
  "pricePerRateUnitPaise" = ROUND((COALESCE("pricePerRateUnit", 0)::numeric * 100))::bigint,
  "totalCostPaise" = ROUND((COALESCE("totalCost", 0)::numeric * 100))::bigint,
  "billAmountPaise" = ROUND((COALESCE("billAmount", 0)::numeric * 100))::bigint
WHERE "pricePerRateUnitPaise" IS NULL
   OR "totalCostPaise" IS NULL
   OR "billAmountPaise" IS NULL;
