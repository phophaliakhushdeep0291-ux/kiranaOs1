import assert from "node:assert/strict";
import db from "../src/db.js";
import { planRepack, recordRepack } from "../src/modules/inventory/repack.service.js";

// Breaking bulk: a 50 kg sack becomes fifty 1 kg packets. Both are packagings of
// one product, so the pooled total must not move — only which pack holds it — and
// anything spilled has to be declared rather than quietly absorbed.

// ── pure arithmetic ─────────────────────────────────────────────────
const sack = { conversionToBase: 50_000, name: "50 kg sack" };
const packet = { conversionToBase: 1_000, name: "1 kg packet" };

const clean = planRepack({ fromUnit: sack, toUnit: packet, fromQuantity: 1 });
assert.equal(clean.consumedBaseQty, 50_000);
assert.equal(clean.producedBaseQty, 50_000);
assert.equal(clean.producedUnits, 50);
assert.equal(clean.remainderBaseQty, 0);
assert.equal(clean.exact, true);

// Declared spillage comes off the produced side, never off the consumed side.
const spilled = planRepack({ fromUnit: sack, toUnit: packet, fromQuantity: 1, wastageBaseQty: 2_000 });
assert.equal(spilled.consumedBaseQty, 50_000);
assert.equal(spilled.producedBaseQty, 48_000);
assert.equal(spilled.producedUnits, 48);
assert.equal(spilled.exact, true);

// A repack that would leave a part-packet is refused rather than rounded, because
// a fractional packet is a count that cannot exist on a shelf.
const ragged = planRepack({ fromUnit: sack, toUnit: { conversionToBase: 3_000, name: "3 kg bag" }, fromQuantity: 1 });
assert.equal(ragged.producedUnits, 16);
assert.equal(ragged.remainderBaseQty, 2_000);
assert.equal(ragged.exact, false);

assert.equal(planRepack({ fromUnit: sack, toUnit: packet, fromQuantity: 0 }).exact, false);

async function expectFailure(promise, code, message) {
  const result = await promise.then(() => null, (error) => error);
  assert.ok(result, `${message} — expected a rejection`);
  assert.equal(result.code, code, `${message} — got ${result.code}: ${result.message}`);
}

async function main() {
  const shop = await db.shop.create({ data: { name: `Repack ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true } });
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Sona Masoori Rice", category: "staples",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 150_000, defaultPricePerRateUnit: 62, costPerRateUnit: 54,
        packagingMode: "per_pack",
      },
    });
    const sackUnit = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "50 kg sack", unitType: "bag", unitCode: "sack50", conversionToBase: 50_000, defaultPrice: 3100, onHandQty: 3 },
    });
    const packetUnit = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "1 kg packet", unitType: "packet", unitCode: "pkt1", conversionToBase: 1_000, defaultPrice: 66, onHandQty: 0, isDefault: true },
    });

    const readCounts = async () => {
      const [prod, from, to] = await Promise.all([
        db.product.findUnique({ where: { id: product.id }, select: { stockBaseQty: true } }),
        db.productSellingUnit.findUnique({ where: { id: sackUnit.id }, select: { onHandQty: true } }),
        db.productSellingUnit.findUnique({ where: { id: packetUnit.id }, select: { onHandQty: true } }),
      ]);
      return { pooled: Number(prod.stockBaseQty), sacks: Number(from.onHandQty), packets: Number(to.onHandQty) };
    };
    assert.deepEqual(await readCounts(), { pooled: 150_000, sacks: 3, packets: 0 });

    // ── a clean repack conserves the pooled total ─────────────────────
    const done = await recordRepack(shop.id, {
      productId: product.id, fromSellingUnitId: sackUnit.id, toSellingUnitId: packetUnit.id, quantity: 1,
    });
    assert.equal(done.to.quantity, 50);
    assert.equal(done.consumedBaseQty, 50_000);
    assert.equal(done.producedBaseQty, 50_000);
    assert.deepEqual(await readCounts(), { pooled: 150_000, sacks: 2, packets: 50 },
      "breaking bulk moves stock between packs and must not change the pooled total");

    // ── declared wastage is the only thing that reduces the total ─────
    const withWastage = await recordRepack(shop.id, {
      productId: product.id, fromSellingUnitId: sackUnit.id, toSellingUnitId: packetUnit.id,
      quantity: 1, wastageBaseQty: 2_000, note: "torn sack",
    });
    assert.equal(withWastage.to.quantity, 48);
    assert.equal(withWastage.wastageBaseQty, 2_000);
    assert.deepEqual(await readCounts(), { pooled: 148_000, sacks: 1, packets: 98 },
      "the pooled total drops by exactly the declared wastage and nothing else");

    // ── the refusals ──────────────────────────────────────────────────
    await expectFailure(
      recordRepack(shop.id, { productId: product.id, fromSellingUnitId: sackUnit.id, toSellingUnitId: sackUnit.id, quantity: 1 }),
      "REPACK_SAME_PACKAGING",
      "repacking a pack into itself is not a movement",
    );
    const oddUnit = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "3 kg bag", unitType: "bag", unitCode: "bag3", conversionToBase: 3_000, defaultPrice: 190, onHandQty: 0 },
    });
    await expectFailure(
      recordRepack(shop.id, { productId: product.id, fromSellingUnitId: sackUnit.id, toSellingUnitId: oddUnit.id, quantity: 1 }),
      "REPACK_NOT_WHOLE_UNITS",
      "a leftover part-pack must be refused, not rounded away",
    );
    await expectFailure(
      recordRepack(shop.id, { productId: product.id, fromSellingUnitId: sackUnit.id, toSellingUnitId: packetUnit.id, quantity: 1, wastageBaseQty: 50_000 }),
      "REPACK_WASTAGE_TOO_LARGE",
      "wastage cannot swallow the whole repack",
    );
    await expectFailure(
      recordRepack(shop.id, { productId: product.id, fromSellingUnitId: sackUnit.id, toSellingUnitId: packetUnit.id, quantity: 99 }),
      "INSUFFICIENT_LOCATION_STOCK",
      "cannot repack more sacks than the branch holds",
    );
    assert.deepEqual(await readCounts(), { pooled: 148_000, sacks: 1, packets: 98 }, "no rejected repack may have moved stock");

    // A pooled product has nothing to move between its packagings.
    const pooled = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Sugar", category: "staples", baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 10_000, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
      },
    });
    const pooledA = await db.productSellingUnit.create({ data: { shopId: shop.id, productId: pooled.id, name: "1 kg", unitType: "packet", unitCode: "s1", conversionToBase: 1_000, defaultPrice: 45, onHandQty: 0 } });
    const pooledB = await db.productSellingUnit.create({ data: { shopId: shop.id, productId: pooled.id, name: "5 kg", unitType: "bag", unitCode: "s5", conversionToBase: 5_000, defaultPrice: 220, onHandQty: 0 } });
    await expectFailure(
      recordRepack(shop.id, { productId: pooled.id, fromSellingUnitId: pooledB.id, toSellingUnitId: pooledA.id, quantity: 1 }),
      "REPACK_REQUIRES_PER_PACK",
      "a shared stock pool has no per-pack stock to repack",
    );

    // ── the trail ─────────────────────────────────────────────────────
    const ledger = await db.stockLedger.findMany({ where: { shopId: shop.id, productId: product.id }, orderBy: { createdAt: "asc" } });
    const out = ledger.filter((row) => row.action === "repack_out");
    const into = ledger.filter((row) => row.action === "repack_in");
    assert.equal(out.length, 2);
    assert.equal(into.length, 2);
    assert.equal(out[0].sellingUnitId, sackUnit.id, "the out leg records which pack was broken");
    assert.equal(into[0].sellingUnitId, packetUnit.id, "the in leg records which pack was made");
    const netBase = ledger.reduce((sum, row) => sum + Number(row.changeBaseQty), 0);
    assert.equal(Math.round(netBase), -2_000, "the ledger nets to the declared wastage alone");

    const audits = await db.auditLog.findMany({ where: { shopId: shop.id, action: "STOCK_REPACKED" } });
    assert.equal(audits.length, 2, "every repack is audited");

    console.log("Stock repack examples passed");
  } finally {
    await db.auditLog.deleteMany({ where: { shopId: shop.id } });
    await db.stockLedger.deleteMany({ where: { shopId: shop.id } });
    await db.locationStock.deleteMany({ where: { shopId: shop.id } });
    await db.productSellingUnit.deleteMany({ where: { shopId: shop.id } });
    await db.product.deleteMany({ where: { shopId: shop.id } });
    await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.$disconnect();
  }
}

await main();
