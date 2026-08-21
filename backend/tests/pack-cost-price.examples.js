import assert from "node:assert/strict";
import { sellingUnitCostPrice } from "../src/modules/products/selling-unit-pricing.js";

// The mirror of pack-mrp-ceiling, for the other end of the line: what a pack COST.
//
// A product's `costPerRateUnit` describes its DEFAULT pack. Billing used to read
// that raw number as the cost of every pack, so every smaller size looked like a
// loss the moment a second packaging was added: a 500 g packet sold at Rs 55 was
// booked against the Rs 80 kilo cost and reported minus Rs 25 on a sale that
// actually earned Rs 15. Nothing rejected the bill — the profit was simply wrong,
// on the line, on the day's report and on every margin rule measured against cost.

const product = { costPerRateUnit: 80 };                         // Rs 80 per 1 kg packet
const defaultPack = { conversionToBase: 1000, isDefault: true }; // 1 kg
const halfKilo = { conversionToBase: 500 };                      // 500 g
const bagPack = { conversionToBase: 5000 };                      // 5 kg

// ── the default pack keeps the product cost exactly ─────────────────
assert.equal(sellingUnitCostPrice(defaultPack, product, defaultPack), 80);

// ── every other pack is costed at ITS OWN size ──────────────────────
assert.equal(sellingUnitCostPrice(halfKilo, product, defaultPack), 40);
assert.equal(sellingUnitCostPrice(bagPack, product, defaultPack), 400);

// ── a pack that carries its own cost wins outright ──────────────────
// What the shopkeeper typed for THIS size is a fact about a real purchase, not
// something to derive from another pack — including when it beats the multiple,
// which is exactly why bulk packs are worth buying.
assert.equal(sellingUnitCostPrice({ ...bagPack, costPrice: 370 }, product, defaultPack), 370);
assert.equal(sellingUnitCostPrice({ ...halfKilo, costPrice: 44 }, product, defaultPack), 44);

// ── no cost anywhere means no cost, not a fabricated one ────────────
assert.equal(sellingUnitCostPrice(halfKilo, { costPerRateUnit: 0 }, defaultPack), 0);
assert.equal(sellingUnitCostPrice(halfKilo, {}, defaultPack), 0);
assert.equal(sellingUnitCostPrice(null, product, defaultPack), 80);

// ── a restaurant portion is not a pack ──────────────────────────────
// Its conversion is how much recipe stock one portion consumes, so scaling a
// rupee cost through it invents a number. Same carve-out sellingUnitMaxPrice makes.
assert.equal(sellingUnitCostPrice({ unitType: "portion", conversionToBase: 1.4 }, { costPerRateUnit: 120 }, defaultPack), 120);
assert.equal(sellingUnitCostPrice({ unitType: "portion", conversionToBase: 1.4, costPrice: 150 }, { costPerRateUnit: 120 }, defaultPack), 150);

// ── unusable conversions fall back rather than divide by zero ───────
assert.equal(sellingUnitCostPrice(halfKilo, product, { conversionToBase: 0 }), 80);
assert.equal(sellingUnitCostPrice({ conversionToBase: 0 }, product, defaultPack), 80);
// Same size as the default pack is the default pack's cost, no arithmetic.
assert.equal(sellingUnitCostPrice({ conversionToBase: 1000 }, product, defaultPack), 80);

// ── the result is money, rounded to paise ───────────────────────────
// A long float reaching the bill line drifts the stored profit by fractions of a
// paisa, and the money-integrity assurance rules compare exact figures.
assert.equal(sellingUnitCostPrice({ conversionToBase: 100 }, { costPerRateUnit: 33.335 }, { conversionToBase: 300, isDefault: true }), 11.11);

console.log("pack-cost-price.examples.js OK");
