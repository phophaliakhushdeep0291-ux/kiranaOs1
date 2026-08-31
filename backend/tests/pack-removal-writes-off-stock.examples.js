/**
 * Removing a pack size that still holds stock.
 *
 * It used to be refused with PACKAGING_UNIT_HAS_STOCK: count the pack to zero,
 * save, then remove it — two saves and an error to stop selling a size. The
 * refusal was protecting something real. perPackStockTotal is computed from the
 * INCOMING units, so a removed pack lowers the product's total on its own, and
 * without a matching ledger row the movement has no explanation and
 * reconciliation fails.
 *
 * So the drop is recorded rather than forbidden, and that recording is the whole
 * point of these tests: the stock must fall by exactly the pack's worth, the
 * other packs must be untouched, and the ledger must be able to answer "where
 * did ten litres go?" six weeks later.
 */
import assert from "node:assert/strict";
import db from "../src/db.js";
import { createProduct, updateProduct, getProduct } from "../src/modules/products/products.service.js";

const ok = (label) => console.log(`  ok ${label}`);

const shop = await db.shop.create({
  data: { name: "Pack Removal Kirana", ownerName: "Owner", city: "Indore", address: "Test" },
});
const actor = { actorUserId: null };

/** A per-pack product sold in three sizes, each carrying its own count. */
const packs = [
  { name: "piece 100 ml", unitType: "piece", unitCode: "piece-100-ml", packSizeValue: 100, packSizeUnit: "ml", conversionToBase: 100, defaultPrice: 70, onHandQty: 20, isDefault: true, isActive: true },
  { name: "piece 200 ml", unitType: "piece", unitCode: "piece-200-ml", packSizeValue: 200, packSizeUnit: "ml", conversionToBase: 200, defaultPrice: 130, onHandQty: 20, isActive: true },
  { name: "piece 500 ml", unitType: "piece", unitCode: "piece-500-ml", packSizeValue: 500, packSizeUnit: "ml", conversionToBase: 500, defaultPrice: 350, onHandQty: 20, isActive: true },
];
const created = await createProduct(shop.id, {
  name: "Almond Drop", baseUnit: "ml", rateUnit: "piece",
  defaultPricePerRateUnit: 70, costPerRateUnit: 60,
  packagingMode: "per_pack",
  sellingUnits: packs,
  stockBaseQty: 20 * 100 + 20 * 200 + 20 * 500,
}, { actor });

const before = await getProduct(shop.id, created.id);
assert.equal(before.stockBaseQty, 16000, "20x100 + 20x200 + 20x500 ml");
assert.equal(before.sellingUnits.filter((u) => u.isActive !== false).length, 3);
ok("a per-pack product starts with three sizes and 16000 ml");

/* ------------------------------------------------- removing a stocked pack */

const keep = before.sellingUnits
  .filter((u) => u.unitCode !== "piece-500-ml" && u.isActive !== false)
  .map((u) => ({
    id: u.id, name: u.name, unitType: u.unitType, unitCode: u.unitCode,
    packSizeValue: u.packSizeValue, packSizeUnit: u.packSizeUnit,
    conversionToBase: u.conversionToBase, defaultPrice: u.defaultPrice,
    onHandQty: u.onHandQty, isDefault: u.isDefault, isActive: true,
  }));

// The 500 ml pack is simply dropped from the payload, exactly as the form sends
// it after the shopkeeper clicks the bin. It still holds 20.
await updateProduct(shop.id, created.id, { sellingUnits: keep, packagingMode: "per_pack" }, { actor });

const after = await getProduct(shop.id, created.id);
assert.equal(after.stockBaseQty, 6000, "16000 minus the 10000 ml that pack held");
ok("removing a pack that held stock takes exactly its worth off the product");

const live = after.sellingUnits.filter((u) => u.isActive !== false).map((u) => u.unitCode).sort();
assert.deepEqual(live, ["piece-100-ml", "piece-200-ml"], "the other two sizes are untouched");
const removed = after.sellingUnits.find((u) => u.unitCode === "piece-500-ml");
assert.ok(removed, "the row is kept, not deleted — old bills still resolve through it");
assert.equal(removed.isActive, false);
ok("the other packs survive and the removed one is retired, not deleted");

/* ------------------------------------------------------------- the ledger */

const rows = await db.stockLedger.findMany({
  where: { shopId: shop.id, productId: created.id },
  orderBy: { createdAt: "asc" },
});
const writeOff = rows.find((row) => Number(row.changeBaseQty) === -10000);
assert.ok(writeOff, "the 10000 ml drop must have a ledger row of its own");
assert.equal(Number(writeOff.sellingUnitQty), -20, "and say it was twenty packs");
assert.match(writeOff.note, /piece-500-ml/, "naming the pack that went");
assert.match(writeOff.note, /removed from sale/, "and that it was a removal, not a recount");
assert.equal(Number(writeOff.newStockBaseQty), 6000, "landing on the new product total");
ok("the write-off is on the ledger, naming the pack and the amount");

// The point of the whole exercise: the movements must add up to the total, or
// the shop's books and its shelf disagree.
const summed = rows.reduce((total, row) => total + Number(row.changeBaseQty), 0);
assert.equal(summed, after.stockBaseQty, "every movement together equals what is on the shelf");
ok("the ledger reconciles to the product's stock");

/* ------------------------------------------- removing an empty pack is quiet */

const beforeEmpty = await getProduct(shop.id, created.id);
const emptyPack = beforeEmpty.sellingUnits.find((u) => u.unitCode === "piece-200-ml");
await updateProduct(shop.id, created.id, {
  sellingUnits: [
    ...beforeEmpty.sellingUnits.filter((u) => u.unitCode === "piece-100-ml" && u.isActive !== false).map((u) => ({
      id: u.id, name: u.name, unitType: u.unitType, unitCode: u.unitCode,
      packSizeValue: u.packSizeValue, packSizeUnit: u.packSizeUnit,
      conversionToBase: u.conversionToBase, defaultPrice: u.defaultPrice,
      onHandQty: u.onHandQty, isDefault: true, isActive: true,
    })),
    { id: emptyPack.id, name: emptyPack.name, unitType: emptyPack.unitType, unitCode: emptyPack.unitCode,
      packSizeValue: emptyPack.packSizeValue, packSizeUnit: emptyPack.packSizeUnit,
      conversionToBase: emptyPack.conversionToBase, defaultPrice: emptyPack.defaultPrice,
      onHandQty: 0, isDefault: false, isActive: true },
  ],
  packagingMode: "per_pack",
}, { actor });
const zeroed = await getProduct(shop.id, created.id);
assert.equal(zeroed.stockBaseQty, 2000, "counting the 200 ml pack to zero drops its 4000 ml");

const rowsBefore = await db.stockLedger.count({ where: { shopId: shop.id, productId: created.id } });
await updateProduct(shop.id, created.id, {
  sellingUnits: zeroed.sellingUnits.filter((u) => u.unitCode === "piece-100-ml" && u.isActive !== false).map((u) => ({
    id: u.id, name: u.name, unitType: u.unitType, unitCode: u.unitCode,
    packSizeValue: u.packSizeValue, packSizeUnit: u.packSizeUnit,
    conversionToBase: u.conversionToBase, defaultPrice: u.defaultPrice,
    onHandQty: u.onHandQty, isDefault: true, isActive: true,
  })),
  packagingMode: "per_pack",
}, { actor });
const finalProduct = await getProduct(shop.id, created.id);
assert.equal(finalProduct.stockBaseQty, 2000, "removing an already-empty pack moves nothing");
assert.equal(
  await db.stockLedger.count({ where: { shopId: shop.id, productId: created.id } }), rowsBefore,
  "and writes no ledger row, because nothing moved",
);
ok("removing a pack that was already empty changes nothing and logs nothing");

await db.$disconnect();
console.log("pack-removal-writes-off-stock.examples.js OK");
