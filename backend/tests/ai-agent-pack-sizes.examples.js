/**
 * Pack sizes: the tool that can corrupt a shop's stock if it is careless.
 *
 * `stock moved = quantity sold x conversionToBase`. Get that number wrong and
 * nothing throws — the pack looks right on the till, sells at a sensible price,
 * and quietly takes the wrong amount off the shelf until a stock count weeks
 * later says the shop is short. So the arithmetic and the refusals are tested
 * directly, without a model, against real rows.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import db from "../src/db.js";
import { CORE_WRITE_TOOLS } from "../src/modules/ai/agent/tools/core-write.js";
import { UNIT_FACTOR_TO_BASE, sellingUnitConversion } from "../src/modules/products/pack-units.js";
import { getProduct } from "../src/modules/products/products.service.js";

const ok = (label) => console.log(`  ok ${label}`);
const setPack = CORE_WRITE_TOOLS.find((tool) => tool.name === "set_pack_size");
assert.ok(setPack, "set_pack_size must exist");

/* ------------------------------------------------ the two tables must agree */

// The till computes a pack's conversion in product-pricing.ts and this side now
// computes it too. If they drift, one of them writes packs the other prices
// wrongly — and neither throws. Pinned by reading the frontend's own table.
const frontendSource = readFileSync(
  new URL("../../frontend/src/features/core/products/pages/product-pricing.ts", import.meta.url),
  "utf8",
);
const block = frontendSource.match(/UNIT_FACTOR_TO_BASE[^=]*=\s*\{([\s\S]*?)\};/);
assert.ok(block, "the frontend factor table must still be findable");
const frontendFactors = {};
for (const [, key, value] of block[1].matchAll(/([a-z]+)\s*:\s*(\d+(?:\.\d+)?)/g)) {
  frontendFactors[key] = Number(value);
}
assert.ok(Object.keys(frontendFactors).length > 20, "parsed the frontend table, not a fragment");
for (const [unit, factor] of Object.entries(frontendFactors)) {
  assert.equal(
    UNIT_FACTOR_TO_BASE[unit], factor,
    `pack factor for "${unit}" has drifted from the till: ${UNIT_FACTOR_TO_BASE[unit]} here, ${factor} there`,
  );
}
ok(`the pack factor table matches the till's, all ${Object.keys(frontendFactors).length} measures`);

assert.equal(sellingUnitConversion(500, "gram"), 500);
assert.equal(sellingUnitConversion(1, "kg"), 1000, "a 1 kg pack is 1000 base grams");
assert.equal(sellingUnitConversion(1, "litre"), 1000);
assert.equal(sellingUnitConversion(1, "dozen"), 12, "a dozen is twelve, not one");
ok("pack conversions are computed, not guessed");

/* -------------------------------------------------------------- fixtures */

const shop = await db.shop.create({
  data: { name: "Pack Test Kirana", ownerName: "Owner", city: "Indore", address: "Test" },
});
const ctx = { shopId: shop.id, userId: null, role: "owner", deviceId: null, businessType: "kirana" };

const sugar = await db.product.create({
  data: {
    shopId: shop.id, name: "Sugar", baseUnit: "gram", rateUnit: "kg",
    defaultPricePerRateUnit: 42, stockBaseQty: 50000,
    sellingUnits: {
      create: [
        { shopId: shop.id, name: "kg", unitType: "kg", unitCode: "kg", conversionToBase: 1000, defaultPrice: 42, isDefault: true, isActive: true },
        { shopId: shop.id, name: "packet 1000 gram", unitType: "packet", unitCode: "packet-1000-gram", packSizeValue: 1000, packSizeUnit: "gram", conversionToBase: 1000, defaultPrice: 41, isActive: true },
      ],
    },
  },
});
const soap = await db.product.create({
  data: { shopId: shop.id, name: "Soap Bar", baseUnit: "piece", rateUnit: "piece", defaultPricePerRateUnit: 30, stockBaseQty: 100 },
});

/* ------------------------------------------------------- adding a new pack */

const added = await setPack.handler(
  { productId: sugar.id, packSize: 500, packUnit: "gram", price: 25, packType: "packet" },
  ctx,
);
assert.equal(added.action, "added");
assert.equal(added.pack.conversionToBase, 500, "a 500 gram packet is 500 base units");

// The whole reason this tool reads before it writes: writeSellingUnits retires
// every unit it is NOT given, so a tool that sent only the new pack would
// silently stop the shop selling by the kg and by the 1 kg packet.
const afterAdd = await getProduct(shop.id, sugar.id);
const liveCodes = afterAdd.sellingUnits.filter((u) => u.isActive !== false).map((u) => u.unitCode).sort();
assert.ok(liveCodes.includes("kg"), "the existing kg unit must survive");
assert.ok(liveCodes.includes("packet-1000-gram"), "the existing 1 kg packet must survive");
assert.equal(liveCodes.length, 3, "three sizes are now sold, not one");
ok("a new pack size is added without retiring the ones already sold");

// The till reaches for the default; a new pack must not seize it.
assert.equal(afterAdd.sellingUnits.find((u) => u.isDefault)?.unitCode, "kg", "the default did not move");
ok("adding a pack does not change what the counter reaches for by default");

/* ---------------------------------------------------- updating an existing */

const updated = await setPack.handler(
  { productId: sugar.id, packSize: 500, packUnit: "gram", price: 27, packType: "packet" },
  ctx,
);
assert.equal(updated.action, "updated", "the same size again is a price change, not a duplicate");
const afterUpdate = await getProduct(shop.id, sugar.id);
const five = afterUpdate.sellingUnits.find((u) => Number(u.packSizeValue) === 500 && u.unitType === "packet");
assert.equal(five.defaultPrice, 27);
assert.equal(afterUpdate.sellingUnits.filter((u) => u.isActive !== false).length, 3, "still three, not four");
ok("the same pack size again updates its price instead of duplicating it");

/* ------------------------------------------------------------- refusals */

// "500 gm" unrecognised would fall back to a factor of 1 and build a 500-PIECE
// pack. One sale takes 500 off the shelf. Refused, with the accepted list.
await assert.rejects(
  setPack.handler({ productId: sugar.id, packSize: 500, packUnit: "gm", price: 25 }, ctx),
  (error) => error.code === "PACK_UNIT_UNKNOWN" && /gram/.test(error.message),
  "an unknown measure must be refused, not silently treated as a count",
);
ok("an unrecognised measure is refused rather than turned into pieces");

// A gram pack on a product counted in pieces would take 500 pieces per sale.
await assert.rejects(
  setPack.handler({ productId: soap.id, packSize: 500, packUnit: "gram", price: 25 }, ctx),
  (error) => error.code === "PACK_UNIT_MISMATCH",
  "a pack must be counted in the same measure as the product's stock",
);
ok("a pack measure that disagrees with the product's stock is refused");

await assert.rejects(
  setPack.handler({ productId: "no-such-product", packSize: 1, packUnit: "kg", price: 10 }, ctx),
  (error) => error.statusCode === 404,
);
ok("a product that does not exist is a refusal, not a new one");

/* ------------------------------------------------------------ the gate */

assert.equal(setPack.risk, "owner_pin", "pack sizes change what the shop sells and at what price");
assert.equal(
  setPack.summarize({ productId: sugar.id, packSize: 500, packUnit: "gram", price: 25, packType: "packet" }, { labelFor: () => "Sugar" }),
  "Sell Sugar in a 500 gram packet at ₹25",
  "the confirmation says the real size and the real price",
);
ok("it sits behind the owner PIN and says what it will do");

await db.$disconnect();
console.log("ai-agent-pack-sizes.examples.js OK");
