import assert from "node:assert/strict";
import db from "../src/db.js";
import { createProduct } from "../src/modules/products/products.service.js";
import { resolveOperationalLocation, setLocationInventory } from "../src/modules/stores/location-context.service.js";

// Standard retail systems solve "different pack sizes" one of two ways:
//   1. One stock pool in a base unit + unit-of-measure conversions (Odoo, SAP, Vyapar).
//   2. Physically distinct packs that are counted and reordered separately are
//      separate SKUs (Shopify, Square, Lightspeed).
// `per_pack` is a third option — two counts on ONE product — which is only safe
// while every path that moves stock maintains both. It was refused outright until
// sale, cancellation, sale return and stock-in all did.
//
// Some paths still cannot: purchase-order receipt, damage, stock counts, absolute
// stock edits, supplier returns. The property this file now protects is that those
// FAIL LOUDLY instead of moving the pooled total while the per-size counts stand
// still. A refusal is recoverable; silent drift turns the counts into confident
// fiction that the shopkeeper then reorders against.

async function main() {
  const shop = await db.shop.create({ data: { name: `PMG ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    // ── per_pack is now accepted ────────────────────────────────────
    const product = await createProduct(shop.id, {
      name: "Maggi Noodles",
      category: "instant",
      baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
      defaultPricePerRateUnit: 108,
      packagingMode: "per_pack",
      sellingUnits: [
        { name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 10, lowStockThreshold: 3, isDefault: true },
        { name: "70 g packet", unitType: "packet", unitCode: "pkt70", packSizeValue: 70, packSizeUnit: "gram", conversionToBase: 70, defaultPrice: 14, onHandQty: 50, lowStockThreshold: 12 },
      ],
    });
    assert.equal(product.packagingMode, "per_pack", "per-packaging stock is no longer refused");

    const units = await db.productSellingUnit.findMany({ where: { productId: product.id }, orderBy: { unitCode: "asc" } });
    assert.deepEqual(
      units.map((unit) => [unit.unitCode, unit.onHandQty]),
      [["box8", 10], ["pkt70", 50]],
      "each pack keeps its own count",
    );

    // ── an absolute total is refused, not guessed ───────────────────
    // "there are 6720 g of Maggi" says nothing about how many are boxes and how
    // many are packets. Any split invented here lands in reorder data.
    const location = await resolveOperationalLocation(shop.id, null);
    const full = await db.product.findUnique({ where: { id: product.id } });
    await assert.rejects(
      () => setLocationInventory(db, { shopId: shop.id, location, product: full, newStockBaseQty: 9999 }),
      (error) => {
        assert.equal(error.code, "PACKAGING_STOCK_PATH_UNSUPPORTED", "the refusal needs a stable machine-readable code");
        assert.match(error.message, /counted per packaging/, "and must say why, in the shopkeeper's terms");
        return true;
      },
      "setting one absolute total for a per-packaging product must be refused",
    );

    // A refused movement must leave the data exactly as it was — a half-applied
    // write would be worse than the drift it was meant to prevent.
    const after = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(after.stockBaseQty, full.stockBaseQty, "a refused movement changes nothing");

    // ── pooled products keep working unchanged ──────────────────────
    const rice = await createProduct(shop.id, {
      name: "Loose Rice", category: "staples",
      baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
      defaultPricePerRateUnit: 58, stockBaseQty: 40000,
    });
    assert.equal(rice.packagingMode, "pooled", "pooled remains the default");
    const riceRow = await db.product.findUnique({ where: { id: rice.id } });
    const set = await setLocationInventory(db, { shopId: shop.id, location, product: riceRow, newStockBaseQty: 35000 });
    assert.equal(set.newStock, 35000, "absolute stock edits still work for pooled goods");

    console.log("packaging-mode-guard.examples.js OK");
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
