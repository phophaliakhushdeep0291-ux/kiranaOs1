import assert from "node:assert/strict";
import db from "../src/db.js";
import { recordPurchase } from "../src/modules/inventory/inventory.service.js";
import { sellingUnitCostPrice } from "../src/modules/products/selling-unit-pricing.js";

// Receiving stock recomputes the product's weighted-average cost, but billing does
// not read that number: sellingUnitCostPrice takes the DEFAULT selling unit's own
// costPrice whenever it is set, and legacySellingUnit creates that unit as a mirror
// of the product. Nothing refreshed the mirror when a purchase moved the cost, so a
// product quoted its creation-day cost for the life of the shop.
//
// Found by selling from a shop loaded from the starter catalogue: Loose Toor Dal
// seeds at Rs 137.95, 50 kg was bought at Rs 120, and the bill still booked cost
// 137.95 — a Rs 35/kg margin reported as Rs 17.05, with the owner's profit tile
// reading half of what the shop earned. Revenue, stock and the ledger were all
// correct, which is what made it survive: only the cost side was wrong.
//
// Runs against the real database because the bug lives between two tables.

async function main() {
  const shop = await db.shop.create({ data: { name: `Cost ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    // A catalogue-seeded loose item: product cost and default-unit cost agree on
    // the seed value, which is exactly the state `legacySellingUnit` produces.
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Toor Dal (per kg)", category: "Loose Dal",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 155, costPerRateUnit: 137.95,
        isLooseItem: true,
      },
    });
    const defaultUnit = await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: product.id, name: "kg", unitType: "kg", unitCode: "kg",
        conversionToBase: 1000, defaultPrice: 155, costPrice: 137.95, onHandQty: 0, isDefault: true,
      },
    });
    // An alternate pack carries a cost the shopkeeper typed for THAT size. The edit
    // path leaves it alone on purpose; receiving stock must not touch it either.
    const bag = await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: product.id, name: "5 kg bag", unitType: "bag", unitCode: "bag5",
        conversionToBase: 5000, defaultPrice: 740, costPrice: 690, onHandQty: 0,
      },
    });

    // ── buy 50 kg at Rs 120/kg ──────────────────────────────────────
    await recordPurchase(shop.id, {
      productId: product.id, supplierName: "Mandi Trader",
      quantity: 50, enteredUnit: "kg",
      billAmount: 6000, updateCost: true, updateMinPrice: false,
    });

    const afterProduct = await db.product.findUnique({ where: { id: product.id } });
    const afterDefault = await db.productSellingUnit.findUnique({ where: { id: defaultUnit.id } });
    const afterBag = await db.productSellingUnit.findUnique({ where: { id: bag.id } });

    assert.equal(afterProduct.stockBaseQty, 50000, "50 kg lands as base units");
    assert.equal(afterProduct.costPerRateUnit, 120, "the weighted average is the price just paid, from an empty shelf");

    // The regression itself.
    assert.equal(
      afterDefault.costPrice, 120,
      "the default selling unit must follow the product's cost — billing reads it, not the product row",
    );
    assert.equal(
      Number(afterDefault.costPricePaise), 12000,
      "and its paise shadow must move with it, or the two money columns disagree",
    );

    // What billing will actually charge the sale against.
    assert.equal(
      sellingUnitCostPrice(afterDefault, afterProduct, afterDefault), 120,
      "a 1 kg sale must be costed at what the shop paid, not at the catalogue seed",
    );
    assert.equal(
      155 - sellingUnitCostPrice(afterDefault, afterProduct, afterDefault), 35,
      "so the reported margin is the real one (this read 17.05 before the fix)",
    );

    // The carve-out the edit path documents: alternate packs are the shopkeeper's.
    assert.equal(afterBag.costPrice, 690, "an alternate pack keeps the cost typed for that size");

    console.log("Stock-in selling-unit cost examples passed");
  } finally {
    // Same teardown order as per-pack-stock-in.examples.js: the ledger's intentional
    // restrictive foreign keys make a bare shop delete fail even when every
    // assertion above succeeded.
    await db.journalLine.deleteMany({ where: { shopId: shop.id } });
    await db.journalEntry.deleteMany({ where: { shopId: shop.id } });
    await db.financialLedger.deleteMany({ where: { shopId: shop.id } });
    await db.chartOfAccount.deleteMany({ where: { shopId: shop.id } });
    await db.stockLedger.deleteMany({ where: { shopId: shop.id } });
    await db.purchaseHistory.deleteMany({ where: { shopId: shop.id } });
    await db.auditLog.deleteMany({ where: { shopId: shop.id } });
    await db.locationStock.deleteMany({ where: { shopId: shop.id } });
    await db.productSellingUnit.deleteMany({ where: { shopId: shop.id } });
    await db.product.deleteMany({ where: { shopId: shop.id } });
    await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
  }
}

await main();
