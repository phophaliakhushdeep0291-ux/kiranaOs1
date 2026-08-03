import assert from "node:assert/strict";
import db from "../src/db.js";
import { recordDamage } from "../src/modules/inventory/inventory.service.js";
import { damageSchema } from "../src/modules/inventory/inventory.schema.js";

// Removing stock against a specific packaging — "2 of the 8-pack went bad" — the
// mirror of per-pack-stock-in. Until this worked, a per_pack product could be
// stocked IN per size but never OUT: every write-off was refused outright with
// PACKAGING_STOCK_PATH_UNSUPPORTED, because base units alone cannot say which size
// left the shelf.
//
// Runs against the real database: the pack is resolved and validated there, base
// units come from the pack's own conversion, and the pooled total and the pack
// count must land in the same transaction or they drift apart on the first loss.

const baseInput = { productId: "p1", enteredUnit: "piece", idempotencyKey: "idem-per-pack-out-1" };
assert.equal(damageSchema.parse({ ...baseInput, quantity: 2, sellingUnitId: "su_box8" }).sellingUnitId, "su_box8");
assert.equal(damageSchema.parse({ ...baseInput, quantity: 2 }).sellingUnitId, undefined, "pooled write-offs still omit it");

async function main() {
  const shop = await db.shop.create({ data: { name: `PPO ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Maggi Noodles", category: "instant",
        baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
        stockBaseQty: 10_000, defaultPricePerRateUnit: 14, costPerRateUnit: 11,
        packagingMode: "per_pack",
      },
    });
    const packet = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "70 g packet", unitType: "packet", unitCode: "pkt70", conversionToBase: 70, defaultPrice: 14, onHandQty: 40, isDefault: true },
    });
    const box = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 12 },
    });

    // ── two boxes are damaged ───────────────────────────────────────
    await recordDamage(shop.id, {
      productId: product.id, quantity: 2, enteredUnit: "piece",
      sellingUnitId: box.id, note: "Water damage",
    }, { idempotencyKey: `dmg-box-${shop.id}` });

    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 10, "the box count drops by the boxes lost");
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: packet.id } })).onHandQty, 40, "the packet count is untouched — that is the entire feature");
    // 2 boxes x 560 g off the pooled total, derived from the pack's conversion and
    // NOT from enteredUnit, which would have removed 2 g.
    assert.equal((await db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10_000 - 1120);

    // ── the ledger remembers which size was written off ─────────────
    const ledger = await db.stockLedger.findFirst({ where: { shopId: shop.id, productId: product.id, action: "damage" } });
    assert.equal(ledger.sellingUnitId, box.id, "the movement remembers the packaging");
    assert.equal(ledger.sellingUnitQty, 2, "and how many of it, which base units cannot recover");
    assert.equal(ledger.changeBaseQty, -1120);

    // ── a replay does not remove the stock twice ────────────────────
    // The offline outbox retries; the replay check derives base units the same way
    // the original write did, or a per-pack retry looks like a different movement
    // and fails forever with IDEMPOTENCY_KEY_REUSED.
    await recordDamage(shop.id, {
      productId: product.id, quantity: 2, enteredUnit: "piece",
      sellingUnitId: box.id, note: "Water damage",
    }, { idempotencyKey: `dmg-box-${shop.id}` });
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 10, "a replayed write-off moves nothing");
    assert.equal((await db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10_000 - 1120);

    // ── the other size moves on its own ─────────────────────────────
    await recordDamage(shop.id, {
      productId: product.id, quantity: 5, enteredUnit: "piece",
      sellingUnitId: packet.id, note: "Expired",
    }, { idempotencyKey: `dmg-pkt-${shop.id}` });
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: packet.id } })).onHandQty, 35);
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 10, "the earlier size is unaffected");
    assert.equal((await db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 10_000 - 1120 - 350);

    // ── a pack from another product is refused ──────────────────────
    const other = await db.product.create({
      data: { shopId: shop.id, name: "Yippee", category: "instant", baseUnit: "g", rateUnit: "piece", displayUnit: "piece", stockBaseQty: 5000, defaultPricePerRateUnit: 14 },
    });
    const foreign = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: other.id, name: "70 g packet", unitType: "packet", unitCode: "y70", conversionToBase: 70, defaultPrice: 14 },
    });
    await assert.rejects(
      () => recordDamage(shop.id, { productId: product.id, quantity: 1, enteredUnit: "piece", sellingUnitId: foreign.id }, { idempotencyKey: `dmg-foreign-${shop.id}` }),
      /does not belong to this product/,
      "a packaging from another product must be rejected",
    );

    // ── a per_pack write-off with NO pack is still refused ──────────
    // Silently moving the pooled total while the per-size counts stand still is the
    // failure this whole design exists to prevent.
    await assert.rejects(
      () => recordDamage(shop.id, { productId: product.id, quantity: 1, enteredUnit: "g" }, { idempotencyKey: `dmg-nopack-${shop.id}` }),
      (error) => {
        assert.equal(error.code, "PACKAGING_STOCK_PATH_UNSUPPORTED");
        return true;
      },
      "an unattributable write-off must fail loudly, not drift",
    );

    // ── pooled goods are completely unaffected ──────────────────────
    const rice = await db.product.create({
      data: { shopId: shop.id, name: "Loose Rice", category: "staples", baseUnit: "g", rateUnit: "kg", displayUnit: "kg", stockBaseQty: 25_000, defaultPricePerRateUnit: 58, costPerRateUnit: 46 },
    });
    await recordDamage(shop.id, { productId: rice.id, quantity: 2, enteredUnit: "kg" }, { idempotencyKey: `dmg-rice-${shop.id}` });
    assert.equal((await db.product.findUnique({ where: { id: rice.id } })).stockBaseQty, 23_000, "pooled write-offs still convert from enteredUnit");

    console.log("per-pack-stock-out.examples.js OK");
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
