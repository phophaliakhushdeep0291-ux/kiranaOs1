import assert from "node:assert/strict";
import db from "../src/db.js";
import { getDailyClosing } from "../src/modules/reports/reports.service.js";
import { createProduct } from "../src/modules/products/products.service.js";

// The payoff for per-packaging stock, in the shopkeeper's words: "for this product
// this size is now less so we need to order this size of this product".
//
// The case that makes it worth building is a product that looks completely fine in
// total while one size has run out. The pooled number cannot say so, because it has
// already added the sizes together.

async function main() {
  const shop = await db.shop.create({ data: { name: `PPLS ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    // 48 packets (3,360 g) + 1 box (560 g) = 3,920 g. Plenty in total, and the
    // product-level alert never fires — but there is one box left.
    const maggi = await createProduct(shop.id, {
      name: "Maggi Noodles",
      category: "instant",
      baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
      defaultPricePerRateUnit: 14,
      stockBaseQty: 3920,
      lowStockThreshold: 500,
      packagingMode: "per_pack",
      sellingUnits: [
        { name: "70 g packet", unitType: "packet", unitCode: "pkt70", packSizeValue: 70, packSizeUnit: "gram", conversionToBase: 70, defaultPrice: 14, onHandQty: 48, lowStockThreshold: 12, isDefault: true },
        { name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 1, lowStockThreshold: 3, reorderLevel: 12 },
      ],
    });

    const summary = await getDailyClosing(shop.id, { allLocations: true });

    // The product-level list stays quiet: 3,920 g is well above its 500 g alert.
    assert.equal(
      summary.lowStock.some((row) => row.productId === maggi.id),
      false,
      "the pooled total looks healthy, which is exactly why it cannot answer this",
    );

    // The per-size list names the size that actually needs ordering.
    const packs = summary.lowStockPacks.filter((row) => row.productId === maggi.id);
    assert.equal(packs.length, 1, "only the size below its own alert is listed");
    assert.equal(packs[0].packName, "8-pack box", "and it names WHICH size to order");
    assert.equal(packs[0].onHandQty, 1);
    assert.equal(packs[0].lowStockThreshold, 3);
    assert.equal(packs[0].reorderLevel, 12, "with how many to buy back up to");
    assert.equal(packs[0].productName, "Maggi Noodles", "a size alone is not orderable — it needs its product");

    // ── a pack with no alert set is never nagged about ──────────────
    // Threshold 0 means "do not track this size", not "alert at zero".
    const untracked = await createProduct(shop.id, {
      name: "Yippee Noodles", category: "instant",
      baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
      defaultPricePerRateUnit: 14, packagingMode: "per_pack",
      sellingUnits: [
        { name: "70 g packet", unitType: "packet", unitCode: "y70", packSizeValue: 70, packSizeUnit: "gram", conversionToBase: 70, defaultPrice: 14, onHandQty: 0, isDefault: true },
      ],
    });
    const after = await getDailyClosing(shop.id, { allLocations: true });
    assert.equal(
      after.lowStockPacks.some((row) => row.productId === untracked.id),
      false,
      "a size with no alert level set is not reported, even at zero",
    );

    // ── pooled products never appear here ───────────────────────────
    // Their sizes share one pool, so "which size is low" is meaningless for them.
    const rice = await createProduct(shop.id, {
      name: "Loose Rice", category: "staples",
      baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
      defaultPricePerRateUnit: 58, stockBaseQty: 100, lowStockThreshold: 5000,
    });
    const withRice = await getDailyClosing(shop.id, { allLocations: true });
    assert.ok(
      withRice.lowStock.some((row) => row.productId === rice.id),
      "a pooled product still reports low stock the usual way",
    );
    assert.equal(
      withRice.lowStockPacks.some((row) => row.productId === rice.id),
      false,
      "but never appears in the per-size list",
    );

    console.log("per-pack-low-stock.examples.js OK");
  } finally {
    for (const remove of [
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();
