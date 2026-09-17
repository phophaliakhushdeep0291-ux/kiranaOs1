// Refresh default selling-unit costs left stale by receipts that never mirrored.
//
// Billing costs a line through sellingUnitCostPrice, which takes the DEFAULT selling
// unit's own costPrice whenever it is set. That unit is created by legacySellingUnit
// as a MIRROR of the product's costPerRateUnit, and syncDefaultSellingUnitPricing
// keeps it fresh — but only on the product EDIT path. Receiving stock recomputes the
// product's weighted-average cost without going through it, so until the fix in
// incrementLocationInventory a product kept quoting its creation-day cost forever.
//
// Effect on a real shop: toor dal seeded from the starter catalogue at Rs 137.95 and
// bought at Rs 120 still booked Rs 137.95 of cost on every bill, reporting a Rs 35/kg
// margin as Rs 17.05. Revenue, stock and the ledger were all correct — only the cost
// side was wrong, which is why it survived so long.
//
// The fix corrects a product on its NEXT receipt. This script corrects the ones that
// are not about to be bought again, by applying the same assignment the edit path
// already makes: default unit costPrice := product costPerRateUnit.
//
// Only DEFAULT units are touched. Alternate packs (pack, dozen, bag) carry a cost the
// shopkeeper typed for that size and are left alone — the same division of
// responsibility syncDefaultSellingUnitPricing documents. A default unit cannot hold
// a deliberately different cost anyway: any product edit already overwrites it.
//
// Usage:
//   node scripts/selling-unit-cost-backfill.js                # dry run, report only
//   node scripts/selling-unit-cost-backfill.js --shop <id>    # dry run, one shop
//   ALLOW_SELLING_UNIT_COST_BACKFILL=true node scripts/selling-unit-cost-backfill.js --write
//
// Products with no known cost (costPerRateUnit null or 0) are skipped: there is
// nothing to mirror, and blanking the pack would discard the only figure present.

import process from "node:process";
import { PrismaClient } from "../src/db.js";
import { moneyEquals, moneyShadows, round2 } from "../src/utils/money.js";

const WRITE = process.argv.includes("--write");
const shopArgIndex = process.argv.indexOf("--shop");
const SHOP_FILTER = shopArgIndex >= 0 ? process.argv[shopArgIndex + 1] : null;

if (WRITE && process.env.ALLOW_SELLING_UNIT_COST_BACKFILL !== "true") {
  console.error("Refusing to write: set ALLOW_SELLING_UNIT_COST_BACKFILL=true to apply changes.");
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const shops = SHOP_FILTER
    ? await db.shop.findMany({ where: { id: SHOP_FILTER }, select: { id: true, name: true } })
    : await db.shop.findMany({ select: { id: true, name: true } });
  if (shops.length === 0) {
    console.log(SHOP_FILTER ? `No shop found for id ${SHOP_FILTER}` : "No shops in database.");
    return;
  }

  let scanned = 0;
  let skippedNoCost = 0;
  let mismatched = 0;
  let written = 0;

  for (const shop of shops) {
    const units = await db.productSellingUnit.findMany({
      where: { shopId: shop.id, isDefault: true },
      select: {
        id: true,
        costPrice: true,
        product: { select: { id: true, name: true, rateUnit: true, costPerRateUnit: true, deletedAt: true } },
      },
    });

    for (const unit of units) {
      const product = unit.product;
      if (!product || product.deletedAt) continue;
      scanned += 1;

      const productCost = round2(Number(product.costPerRateUnit ?? 0));
      if (!(productCost > 0)) { skippedNoCost += 1; continue; }
      if (moneyEquals(productCost, unit.costPrice ?? 0)) continue;
      mismatched += 1;

      console.log(
        `[${shop.name}] ${product.name}: pack cost Rs ${unit.costPrice ?? "unset"}` +
          ` -> Rs ${productCost}/${product.rateUnit}`,
      );

      if (WRITE) {
        await db.productSellingUnit.update({
          where: { id: unit.id },
          data: { costPrice: productCost, ...moneyShadows({ costPrice: productCost }) },
        });
        written += 1;
      }
    }
  }

  console.log("");
  console.log(`Scanned ${scanned} default selling unit(s) across ${shops.length} shop(s); skipped ${skippedNoCost} with no product cost.`);
  console.log(`${mismatched} pack cost(s) disagree with their product's current cost.`);
  console.log(WRITE ? `Applied ${written} update(s).` : "Dry run — nothing written. Re-run with --write and ALLOW_SELLING_UNIT_COST_BACKFILL=true to apply.");
}

main()
  .catch((error) => {
    console.error("Selling-unit cost backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
