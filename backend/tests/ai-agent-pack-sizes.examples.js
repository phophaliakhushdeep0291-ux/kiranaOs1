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
// Both directions. Checking only one let a measure this side knew and the till
// did not slip through, which is the same divergence wearing the other hat.
assert.deepEqual(
  Object.keys(UNIT_FACTOR_TO_BASE).sort(), Object.keys(frontendFactors).sort(),
  "the two pack tables must know exactly the same measures",
);
ok(`the pack factor table matches the till's, all ${Object.keys(frontendFactors).length} measures`);

assert.equal(sellingUnitConversion(500, "gram"), 500);
assert.equal(sellingUnitConversion(1, "kg"), 1000, "a 1 kg pack is 1000 base grams");
assert.equal(sellingUnitConversion(1, "litre"), 1000);
// "ltr" is what this app actually writes: the AI command schema enumerates it and
// the voice parsers normalise to it. It was missing from both tables and from
// legacySellingUnit, so an ltr/ml product's loose unit converted at 1 — selling
// one litre took one millilitre off the shelf. Found by building a shop and
// adding an oil to it.
assert.equal(sellingUnitConversion(1, "ltr"), 1000, "a litre written as ltr is still 1000 ml");
assert.equal(sellingUnitConversion(1, "l"), 1000);
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


/* --------------------------------- a product with no explicit selling units */

// The case every fixture above missed, and the common one: most of a kirana
// catalogue is sold loose by its rate unit with no ProductSellingUnit row at
// all. Found by running this against a real shop — adding a 500 g packet to
// "Shakkar (Sugar)" left it sold ONLY in packets, with rateUnit rewritten from
// kg to packet and the price from Rs45 to Rs24. The shop could no longer weigh
// sugar out loose, and nothing errored.
//
// normalizeSellingUnits marks the first unit default when none is flagged, and
// applyDefaultSellingUnitToProduct then copies that unit's type and price onto
// the Product itself. So the loose unit has to be sent along with the new pack.
const loose = await db.product.create({
  data: {
    shopId: shop.id, name: "Atta", baseUnit: "gram", rateUnit: "kg",
    defaultPricePerRateUnit: 34, stockBaseQty: 80000,
  },
});
assert.equal((await getProduct(shop.id, loose.id)).sellingUnits.length, 0, "starts with no explicit units");

await setPack.handler({ productId: loose.id, packSize: 5, packUnit: "kg", price: 160, packType: "packet" }, ctx);
const afterLoose = await getProduct(shop.id, loose.id);

assert.equal(afterLoose.rateUnit, "kg", "the product must still be priced per kg");
assert.equal(afterLoose.defaultPricePerRateUnit, 34, "and still at its own price, not the packet's");

const codes = afterLoose.sellingUnits.filter((u) => u.isActive !== false).map((u) => u.unitCode).sort();
assert.deepEqual(codes, ["kg", "packet-5-kg"], "loose kg survives alongside the new packet");
assert.equal(afterLoose.sellingUnits.find((u) => u.isDefault)?.unitCode, "kg", "loose stays the default");
assert.equal(afterLoose.sellingUnits.find((u) => u.unitCode === "kg").conversionToBase, 1000, "a kg of a gram-counted product is 1000");
assert.equal(afterLoose.sellingUnits.find((u) => u.unitCode === "packet-5-kg").conversionToBase, 5000, "a 5 kg packet is 5000 grams");
ok("adding a pack to a loose-sold product keeps it sellable loose, at its own price");


/* ------------------------------------------- the app's own litre abbreviation */

const oil = await db.product.create({
  data: {
    shopId: shop.id, name: "Sarson Tel", baseUnit: "ml", rateUnit: "ltr",
    defaultPricePerRateUnit: 155, stockBaseQty: 20000,
  },
});
await setPack.handler({ productId: oil.id, packSize: 1, packUnit: "litre", price: 158, packType: "bottle" }, ctx);
const afterOil = await getProduct(shop.id, oil.id);

const looseLitre = afterOil.sellingUnits.find((u) => u.unitCode === "ltr");
assert.ok(looseLitre, "the loose litre unit is materialised alongside the bottle");
assert.equal(looseLitre.conversionToBase, 1000, "one ltr of an ml-counted product is 1000, not 1");
assert.equal(afterOil.sellingUnits.find((u) => u.unitCode === "bottle-1-litre").conversionToBase, 1000);
assert.equal(afterOil.rateUnit, "ltr", "and the product is still priced per litre");
ok("a product written in ltr converts at 1000, not 1");

await db.$disconnect();
console.log("ai-agent-pack-sizes.examples.js OK");
