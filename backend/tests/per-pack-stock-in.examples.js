import assert from "node:assert/strict";
import db from "../src/db.js";
import { recordPurchase } from "../src/modules/inventory/inventory.service.js";
import { purchaseSchema } from "../src/modules/inventory/inventory.schema.js";

// Receiving stock against a specific packaging — "12 boxes of the 8-pack" — so the
// shopkeeper can later see WHICH size is running low, which was the whole point:
// "for this product this size is now less so we need to order this size".
//
// Runs against the real database because the interesting behaviour is DB-resolved:
// the pack is looked up and validated against the product, base quantity is derived
// from the pack's own conversion, and both the pooled total and the pack count have
// to land in the same transaction.

// The schema must carry the pack through validation at all.
const baseInput = { productId: "p1", supplierName: "S", enteredUnit: "piece", billAmount: 1200, idempotencyKey: "idem-per-pack-schema-1" };
const parsed = purchaseSchema.parse({ ...baseInput, quantity: 12, sellingUnitId: "su_box8" });
assert.equal(parsed.sellingUnitId, "su_box8", "stock-in must accept the packaging received");
assert.equal(purchaseSchema.parse({ ...baseInput, quantity: 5 }).sellingUnitId, undefined, "pooled stock-in still omits it");

async function main() {
  const shop = await db.shop.create({ data: { name: `PP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Maggi Noodles", category: "instant",
        baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
        stockBaseQty: 0, defaultPricePerRateUnit: 14, costPerRateUnit: 11,
        packagingMode: "per_pack",
      },
    });
    const packet = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "70 g packet", unitType: "packet", unitCode: "pkt70", conversionToBase: 70, defaultPrice: 14, onHandQty: 0, isDefault: true },
    });
    const box = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 0 },
    });

    // ── receive 12 boxes ────────────────────────────────────────────
    await recordPurchase(shop.id, {
      productId: product.id, supplierName: "Nestle Distributor",
      quantity: 12, enteredUnit: "piece", sellingUnitId: box.id,
      billAmount: 1104, updateCost: true, updateMinPrice: false,
    });

    const afterBox = await db.productSellingUnit.findUnique({ where: { id: box.id } });
    const otherPack = await db.productSellingUnit.findUnique({ where: { id: packet.id } });
    const pooled = await db.product.findUnique({ where: { id: product.id } });

    assert.equal(afterBox.onHandQty, 12, "the box count goes up by the boxes received");
    assert.equal(otherPack.onHandQty, 0, "the packet count is untouched — that is the entire feature");
    // 12 boxes x 560 g. The pooled total stays authoritative and must agree with the
    // packs, or the two numbers start drifting from the first receipt.
    assert.equal(pooled.stockBaseQty, 6720, "base units derive from the pack's own conversion, not enteredUnit");

    // ── the ledger records which size was received ──────────────────
    const ledger = await db.stockLedger.findFirst({ where: { shopId: shop.id, productId: product.id, action: "purchase" } });
    assert.equal(ledger.sellingUnitId, box.id, "the movement remembers the packaging");
    assert.equal(ledger.sellingUnitQty, 12, "and how many of it, which base units cannot recover");
    assert.equal(ledger.changeBaseQty, 6720);

    // ── receiving the other size moves only that one ────────────────
    await recordPurchase(shop.id, {
      productId: product.id, supplierName: "Nestle Distributor",
      quantity: 24, enteredUnit: "piece", sellingUnitId: packet.id,
      billAmount: 264, updateCost: false, updateMinPrice: false,
    });
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: packet.id } })).onHandQty, 24);
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 12, "the earlier size is unaffected");
    assert.equal((await db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 6720 + 24 * 70);

    // ── a pack from another product is refused ──────────────────────
    // Otherwise a stale id from an offline queue could post stock onto a different
    // product's packaging, which no report would ever reveal as wrong.
    const other = await db.product.create({
      data: { shopId: shop.id, name: "Yippee", category: "instant", baseUnit: "g", rateUnit: "piece", displayUnit: "piece", stockBaseQty: 0, defaultPricePerRateUnit: 14 },
    });
    const foreign = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: other.id, name: "70 g packet", unitType: "packet", unitCode: "y70", conversionToBase: 70, defaultPrice: 14 },
    });
    await assert.rejects(
      () => recordPurchase(shop.id, { productId: product.id, supplierName: "S", quantity: 1, enteredUnit: "piece", sellingUnitId: foreign.id, billAmount: 14 }),
      /does not belong to this product/,
      "a packaging from another product must be rejected",
    );

    // ── pooled goods are completely unaffected ──────────────────────
    const rice = await db.product.create({
      data: { shopId: shop.id, name: "Loose Rice", category: "staples", baseUnit: "g", rateUnit: "kg", displayUnit: "kg", stockBaseQty: 0, defaultPricePerRateUnit: 58 },
    });
    await recordPurchase(shop.id, { productId: rice.id, supplierName: "Mandi", quantity: 25, enteredUnit: "kg", billAmount: 1150 });
    assert.equal((await db.product.findUnique({ where: { id: rice.id } })).stockBaseQty, 25000, "pooled stock-in still converts from enteredUnit");

    console.log("per-pack-stock-in.examples.js OK");
  } finally {
    // A direct stock receipt now posts immutable financial-ledger and
    // double-entry journal evidence in the same transaction. Remove that
    // evidence in dependency order before deleting this test tenant; otherwise
    // the ledger's intentional restrictive foreign keys make teardown fail
    // even though the stock-in assertions succeeded.
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
