/**
 * Putting items on a bill: the part that must be right without a model.
 *
 * The model decides that "2 kilo chini" is an item and a quantity. Everything
 * after that — which catalogue row it is, what it costs, whether the shop even
 * stocks it — is this handler's job, and it is the half that can put the wrong
 * thing on a real bill. So it is tested directly against a seeded catalogue,
 * with no provider involved and nothing to be flaky about.
 *
 * The shape of the trap is always the same: a shop that stocks "Sugar" also
 * stocks "Sugar Free Gold", and "sugar" must mean the first one.
 */
import assert from "node:assert/strict";
import db from "../src/db.js";
import { CORE_WRITE_TOOLS } from "../src/modules/ai/agent/tools/core-write.js";

const ok = (label) => console.log(`  ok ${label}`);
const addItems = CORE_WRITE_TOOLS.find((tool) => tool.name === "add_items_to_bill");
assert.ok(addItems, "add_items_to_bill must exist");

const shop = await db.shop.create({
  data: { name: "Bill Test Kirana", ownerName: "Owner", city: "Indore", address: "Test" },
});
const other = await db.shop.create({
  data: { name: "Neighbour Kirana", ownerName: "Other", city: "Indore", address: "Test" },
});

for (const data of [
  { name: "Sugar", baseUnit: "kg", rateUnit: "kg", defaultPricePerRateUnit: 42, stockBaseQty: 50 },
  { name: "Sugar Free Gold", baseUnit: "piece", rateUnit: "piece", defaultPricePerRateUnit: 220, stockBaseQty: 12 },
  { name: "Maggi Noodles", baseUnit: "packet", rateUnit: "packet", defaultPricePerRateUnit: 14, stockBaseQty: 80 },
]) await db.product.create({ data: { shopId: shop.id, ...data } });

// The neighbour stocks something this shop does not. It must stay invisible.
await db.product.create({
  data: { shopId: other.id, name: "Dragon Fruit", baseUnit: "kg", rateUnit: "kg", defaultPricePerRateUnit: 400, stockBaseQty: 9 },
});

const ctx = { shopId: shop.id, userId: null, role: "owner", deviceId: null, businessType: "kirana" };
const run = (items) => addItems.handler({ items }, ctx);

/* ------------------------------------------------------------------ basics */

const two = await run([
  { query: "sugar", quantity: 2, unit: "kg" },
  { query: "maggi", quantity: 3, unit: "packet" },
]);
assert.equal(two.clientAction, "add_bill_lines");
assert.equal(two.lines.length, 2);
assert.equal(two.problems.length, 0);

const [sugarLine, maggiLine] = two.lines;
assert.equal(sugarLine.name, "Sugar");
assert.equal(sugarLine.quantity, 2);
assert.equal(sugarLine.unit, "kg");
// The price comes from the catalogue, never from the sentence: a shopkeeper who
// says "do kilo chini" has not quoted a rate, and inventing one bills wrong.
assert.equal(sugarLine.rate, 42, "the rate is the shop's own price");
assert.equal(maggiLine.name, "Maggi Noodles");
assert.equal(maggiLine.rate, 14);
ok("two spoken items resolve to catalogue rows at catalogue prices");

/* ------------------------------------------------- the sugar / sugar-free trap */

// "sugar" in a shop that also stocks "Sugar Free Gold" is the plain item. Left
// to whatever the database returned first, this is a coin flip that occasionally
// bills a ₹220 sweetener as ₹42 of sugar.
const plain = await run([{ query: "sugar", quantity: 1, unit: "kg" }]);
assert.equal(plain.lines[0].name, "Sugar", "the plain word must not match the longer variant");
assert.equal(plain.lines[0].rate, 42);

// Naming the variant still reaches it.
const variant = await run([{ query: "Sugar Free Gold", quantity: 1 }]);
assert.equal(variant.lines[0].name, "Sugar Free Gold");
assert.equal(variant.lines[0].rate, 220);
ok("a shorter name wins its own word, and the variant is still reachable by name");

/* ---------------------------------------------------------------- unknowns */

const missing = await run([{ query: "dragon fruit", quantity: 5, unit: "kg" }]);
assert.equal(missing.lines.length, 0, "nothing this shop does not stock reaches the bill");
assert.equal(missing.problems[0].reason, "no_match");
// The neighbouring shop stocks it. A tool that reached across would have found it.
assert.ok(!JSON.stringify(missing).includes("Dragon Fruit"), "another shop's catalogue must be invisible");
ok("an item the shop does not stock is reported, not invented");

/* ---------------------------------------------------- partial success */

const mixed = await run([
  { query: "maggi", quantity: 2, unit: "packet" },
  { query: "dragon fruit", quantity: 1 },
]);
assert.equal(mixed.lines.length, 1, "the item that resolved still goes on the bill");
assert.equal(mixed.problems.length, 1, "the one that did not is reported alongside it");
ok("one bad item does not throw away the good ones");

/* ------------------------------------------------------------------- units */

// The shopkeeper said nothing about units, so the product's own unit is used
// rather than a guess like "piece".
const noUnit = await run([{ query: "sugar", quantity: 2 }]);
assert.equal(noUnit.lines[0].unit, "kg", "an unspoken unit falls back to the product's own");
ok("an unspoken unit comes from the product, not from a default");

await db.$disconnect();
console.log("ai-agent-bill-items.examples.js OK");
