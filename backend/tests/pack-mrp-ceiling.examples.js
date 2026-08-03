import assert from "node:assert/strict";
import { sellingUnitMaxPrice } from "../src/modules/products/selling-unit-pricing.js";

// The bug this file pins down, in the shopkeeper's words:
// "when i add various packaging their value do not exceed the mrp of the other packet".
//
// A product's `mrp` describes its DEFAULT pack. Billing used to read that raw
// number as the ceiling for EVERY pack, so the moment a second, bigger packaging
// was added it became unsellable: a 5 kg bag at Rs 450 was rejected with
// "exceeds the configured maximum of Rs 55" — the 500 g packet's MRP.

const product = { mrp: 55 };                                    // Rs 55 per 500 g packet
const defaultPack = { conversionToBase: 500, isDefault: true }; // 500 g
const bagPack = { conversionToBase: 5000 };                     // 5 kg
const kiloPack = { conversionToBase: 1000 };                    // 1 kg

// ── the default pack keeps the product MRP exactly ──────────────────
assert.equal(sellingUnitMaxPrice(defaultPack, product, defaultPack), 55);

// ── a bigger pack is measured against ITS OWN size ──────────────────
// 10x the goods, so 10x the ceiling. Rs 450 for the bag is now sellable; the old
// behaviour compared it against Rs 55 and refused the bill.
assert.equal(sellingUnitMaxPrice(bagPack, product, defaultPack), 550);
assert.equal(sellingUnitMaxPrice(kiloPack, product, defaultPack), 110);

// ── a pack that carries its own MRP wins outright ───────────────────
// A printed bag MRP is a fact, not something to derive: the shopkeeper's number
// must never be overridden by arithmetic on another pack.
assert.equal(sellingUnitMaxPrice({ ...bagPack, maximumPrice: 499 }, product, defaultPack), 499);
// Even when it is HIGHER than the scaled figure — bulk packs are often priced
// above the strict multiple.
assert.equal(sellingUnitMaxPrice({ ...bagPack, maximumPrice: 600 }, product, defaultPack), 600);

// ── no MRP anywhere means no ceiling ────────────────────────────────
// 0 is "uncapped" throughout billing; a product with no MRP has never been capped
// and adding a second pack must not start capping it.
assert.equal(sellingUnitMaxPrice(bagPack, { mrp: 0 }, defaultPack), 0);
assert.equal(sellingUnitMaxPrice(bagPack, {}, defaultPack), 0);

// ── degenerate data falls back to the product MRP, never to zero ────
// A missing/zero conversion cannot be scaled with. Returning 0 there would silently
// REMOVE the ceiling and let anything be sold above MRP, which is the dangerous
// direction to fail in.
assert.equal(sellingUnitMaxPrice(bagPack, product, { conversionToBase: 0 }), 55);
assert.equal(sellingUnitMaxPrice({ conversionToBase: 0 }, product, defaultPack), 55);
assert.equal(sellingUnitMaxPrice(null, product, defaultPack), 55);

// ── same size as the default pack ⇒ same ceiling, no rounding drift ─
assert.equal(sellingUnitMaxPrice({ conversionToBase: 500 }, product, defaultPack), 55);

// ── piece-based packs scale the same way ────────────────────────────
// A 12-piece carton of a product whose default pack is 1 piece at Rs 14.
assert.equal(
  sellingUnitMaxPrice({ conversionToBase: 12 }, { mrp: 14 }, { conversionToBase: 1, isDefault: true }),
  168,
);

// ── the result is money, rounded to paise ───────────────────────────
// 33.333... per pack must not reach the price ceiling as a long float, or the
// comparison in bills.service drifts by fractions of a paisa.
assert.equal(
  sellingUnitMaxPrice({ conversionToBase: 100 }, { mrp: 33.335 }, { conversionToBase: 300, isDefault: true }),
  11.11,
);

console.log("pack-mrp-ceiling.examples.js OK");
