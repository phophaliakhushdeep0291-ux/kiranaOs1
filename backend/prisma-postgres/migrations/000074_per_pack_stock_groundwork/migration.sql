-- Per-packaging stock: groundwork only. No behaviour change.
--
-- A product can already be sold in several packagings, but stock is a single
-- pooled base-unit number on Product. That is correct for loose goods (1 kg and a
-- 5 kg bag come out of the same sack) and wrong for distinct pre-packed SKUs
-- (70 g packet vs 8-pack), which sit separately on the shelf and are reordered
-- separately. packagingMode lets each product say which it is, defaulting to the
-- pooled behaviour every existing product already has.

ALTER TABLE "Product"
  ADD COLUMN "packagingMode" TEXT NOT NULL DEFAULT 'pooled';

-- Per-packaging counts, held in the unit's own counts (packets, boxes) rather
-- than product base units, so "4 of the 500 g packs left" needs no conversion.
-- NULL means "this packaging does not carry its own stock" — the pooled default.
ALTER TABLE "ProductSellingUnit"
  ADD COLUMN "onHandQty" DOUBLE PRECISION,
  ADD COLUMN "lowStockThreshold" DOUBLE PRECISION,
  ADD COLUMN "reorderLevel" DOUBLE PRECISION;

-- Attribute a stock movement to a packaging, so a per-pack balance can be
-- rebuilt and audited from the ledger. NULL on pooled products and legacy rows.
ALTER TABLE "StockLedger"
  ADD COLUMN "sellingUnitId" TEXT,
  ADD COLUMN "sellingUnitQty" DOUBLE PRECISION;

CREATE INDEX "StockLedger_shopId_sellingUnitId_idx"
  ON "StockLedger"("shopId", "sellingUnitId");
