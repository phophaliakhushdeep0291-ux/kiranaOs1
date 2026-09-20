/**
 * Bring every DEFAULT selling unit's stored cost back into line with its product.
 *
 *   node scripts/backfill-default-pack-cost.js --dry-run
 *   node scripts/backfill-default-pack-cost.js
 *   node scripts/backfill-default-pack-cost.js --shop <shopId>
 *
 * `Product.costPerRateUnit` is the weighted average a purchase recomputes.
 * `ProductSellingUnit.costPrice` on the DEFAULT row is a COPY of it — derived by
 * legacySellingUnit, copied back by applyDefaultSellingUnitToProduct, held equal by
 * syncDefaultSellingUnitPricing. No purchase path wrote the copy, so on any shop
 * that has ever taken in stock the two disagree: a starter-catalogue item still says
 * 137.95 while the shop has been paying 120.
 *
 * Billing no longer trusts the copy (sellingUnitCostPrice prefers the product's cost
 * for the default pack) and incrementLocationInventory now keeps it in step, so this
 * is not needed to bill correctly. It is needed because plenty of other code reads
 * the row directly and cannot tell that it is stale:
 *
 *   - the per-pack inventory rows and the pricing preview quote cost and margin from it
 *   - the product form opens on it, so the shopkeeper is shown a price they stopped paying
 *   - touchProductFromDefaultUnit (pricing.service.js) copies the default unit back ONTO
 *     the product, so saving the pricing editor without touching the cost box would push
 *     the stale figure over the correct weighted average
 *
 * Only rows that actually disagree are written, and only where the product carries a
 * cost at all: where it does not, the row's own figure is the only one there is and
 * the reader falls back to it, so overwriting it with NULL would destroy the last
 * record of what the item cost. Alternate packs are never touched — their costPrice
 * is what the shopkeeper typed for THAT size.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/db.js";
import { moneyShadows, round2 } from "../src/utils/money.js";

const samePrice = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

/**
 * `shopId` is not just a convenience for operators repairing one tenant: it is what
 * lets this be tested at all. The DB examples share one database when the full suite
 * runs them, so an unscoped sweep from inside a test would rewrite rows belonging to
 * every other example in the run.
 */
export async function backfillDefaultPackCost({ shopId = null, dryRun = false, onChange = null, client = db } = {}) {
  const units = await client.productSellingUnit.findMany({
    where: { isDefault: true, ...(shopId && { shopId }) },
    select: {
      id: true, shopId: true, costPrice: true,
      product: { select: { id: true, name: true, costPerRateUnit: true } },
    },
  });

  let corrected = 0;
  let alreadyInStep = 0;
  let noProductCost = 0;

  for (const unit of units) {
    const productCost = round2(Number(unit.product?.costPerRateUnit ?? 0));
    if (!(productCost > 0)) {
      noProductCost += 1;
      continue;
    }
    if (samePrice(unit.costPrice, productCost)) {
      alreadyInStep += 1;
      continue;
    }

    onChange?.({ name: unit.product.name, from: unit.costPrice, to: productCost });
    if (!dryRun) {
      await client.productSellingUnit.update({
        where: { id: unit.id },
        data: { costPrice: productCost, ...moneyShadows({ costPrice: productCost }) },
      });
    }
    corrected += 1;
  }

  return { corrected, alreadyInStep, noProductCost, examined: units.length };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const shopAt = args.indexOf("--shop");
  const shopId = shopAt >= 0 && args[shopAt + 1] && !args[shopAt + 1].startsWith("--") ? args[shopAt + 1] : null;

  const result = await backfillDefaultPackCost({
    shopId,
    dryRun,
    onChange: ({ name, from, to }) => console.log(`  ${name}: ${from ?? "null"} -> ${to}`),
  });

  console.log(
    `Default-pack cost backfill ${dryRun ? "(dry run) " : ""}complete: `
    + `${result.corrected} ${dryRun ? "would be corrected" : "corrected"}, `
    + `${result.alreadyInStep} already in step, `
    + `${result.noProductCost} left alone (no product-level cost to copy).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
