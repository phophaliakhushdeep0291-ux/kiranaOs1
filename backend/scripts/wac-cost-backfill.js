// Repair weighted-average product costs poisoned by the pre-guard formula.
//
// Until commit b1739db1, weightedAvgCost averaged purchases against NEGATIVE on-hand
// stock (overselling is supported), which could store absurd costs (e.g. -10000g @40
// + 10001g @50 => Rs 100,050/kg) that silently corrupt every later profit figure.
// The formula is fixed for new purchases; this script repairs the stored costs by
// replaying each product's purchase ledger through the FIXED formula.
//
// Replay model: poisoning requires a purchase made while on-hand stock was <= 0 — at
// exactly such a purchase the FIXED formula resets cost to that purchase's price,
// wiping earlier history. So the replay anchors at the LAST non-positive-stock
// purchase (cost := its calculatedBuyRate) and replays the purchases after it:
//   cost := weightedAvgCost(oldStockBaseQty, cost, changeBaseQty, calculatedBuyRate)
// StockLedger records the stock level BEFORE each purchase (oldStockBaseQty), so the
// replay does not depend on reconstructing sales/damage history — and products whose
// purchases all happened with positive stock are SKIPPED: the old formula computed
// them correctly against a manually-seeded cost this script cannot know.
//
// Usage:
//   node scripts/wac-cost-backfill.js                 # dry run, report only
//   node scripts/wac-cost-backfill.js --shop <id>     # dry run, one shop
//   ALLOW_WAC_BACKFILL=true node scripts/wac-cost-backfill.js --write   # apply
//
// Products with no purchase rows are never touched (their cost was set manually).

import process from "node:process";
import { PrismaClient } from "../src/db.js";
import { weightedAvgCost, moneyEquals, moneyShadows } from "../src/utils/money.js";

const WRITE = process.argv.includes("--write");
const shopArgIndex = process.argv.indexOf("--shop");
const SHOP_FILTER = shopArgIndex >= 0 ? process.argv[shopArgIndex + 1] : null;

if (WRITE && process.env.ALLOW_WAC_BACKFILL !== "true") {
  console.error("Refusing to write: set ALLOW_WAC_BACKFILL=true to apply changes.");
  process.exit(1);
}

const db = new PrismaClient();

/** Returns the corrected cost, or null when the product was never exposed to the bug. */
function replayCost(purchaseRows) {
  let anchor = -1;
  for (let i = 0; i < purchaseRows.length; i += 1) {
    if ((Number(purchaseRows[i].oldStockBaseQty) || 0) <= 0) anchor = i;
  }
  if (anchor === -1) return null; // all purchases had positive stock — old math was fine

  // At the anchor the fixed formula returns the purchase price itself; replay onward.
  let cost = Number(purchaseRows[anchor].calculatedBuyRate) || 0;
  for (let i = anchor + 1; i < purchaseRows.length; i += 1) {
    const row = purchaseRows[i];
    cost = weightedAvgCost(
      Number(row.oldStockBaseQty) || 0,
      cost,
      Number(row.changeBaseQty) || 0,
      Number(row.calculatedBuyRate) || 0,
    );
  }
  return cost;
}

async function main() {
  const shops = SHOP_FILTER
    ? await db.shop.findMany({ where: { id: SHOP_FILTER }, select: { id: true, name: true } })
    : await db.shop.findMany({ select: { id: true, name: true } });
  if (shops.length === 0) {
    console.log(SHOP_FILTER ? `No shop found for id ${SHOP_FILTER}` : "No shops in database.");
    return;
  }

  let scanned = 0;
  let withPurchases = 0;
  let mismatched = 0;
  let written = 0;

  for (const shop of shops) {
    const products = await db.product.findMany({
      where: { shopId: shop.id, deletedAt: null },
      select: { id: true, name: true, costPerRateUnit: true, rateUnit: true },
    });
    for (const product of products) {
      scanned += 1;
      const purchases = await db.stockLedger.findMany({
        where: { shopId: shop.id, productId: product.id, action: "purchase" },
        orderBy: { createdAt: "asc" },
        select: { oldStockBaseQty: true, changeBaseQty: true, calculatedBuyRate: true, createdAt: true },
      });
      if (purchases.length === 0) continue;
      withPurchases += 1;

      const replayed = replayCost(purchases);
      if (replayed === null) continue; // never bought on non-positive stock — trustworthy
      if (moneyEquals(replayed, product.costPerRateUnit)) continue;
      mismatched += 1;

      console.log(
        `[${shop.name}] ${product.name}: stored Rs ${product.costPerRateUnit}/${product.rateUnit}` +
          ` -> replayed Rs ${replayed}/${product.rateUnit} (${purchases.length} purchase${purchases.length === 1 ? "" : "s"})`,
      );

      if (WRITE) {
        await db.product.update({
          where: { id: product.id },
          data: { costPerRateUnit: replayed, ...moneyShadows({ costPerRateUnit: replayed }) },
        });
        written += 1;
      }
    }
  }

  console.log("");
  console.log(`Scanned ${scanned} products across ${shops.length} shop(s); ${withPurchases} have purchase history.`);
  console.log(`${mismatched} stored cost(s) differ from the fixed-formula replay.`);
  console.log(WRITE ? `Applied ${written} update(s).` : "Dry run — nothing written. Re-run with --write and ALLOW_WAC_BACKFILL=true to apply.");
}

main()
  .catch((error) => {
    console.error("WAC backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
