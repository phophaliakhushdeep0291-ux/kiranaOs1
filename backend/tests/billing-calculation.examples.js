import assert from "node:assert/strict";
import { round2 } from "../src/utils/money.js";
import { toBaseQty, fromBaseQty, rateUnitToBase, baseQtyToRateQty } from "../src/utils/units.js";

function calculateLine({ quantity, enteredUnit, baseUnit, rateUnit, ratePerRateUnit, costPerRateUnit }) {
  const qtyInBase = toBaseQty(quantity, enteredUnit, baseUnit);
  const qtyInRateUnit = baseQtyToRateQty(qtyInBase, rateUnit, baseUnit);
  const lineTotal = round2(ratePerRateUnit * qtyInRateUnit);
  const lineCost = round2(costPerRateUnit * qtyInRateUnit);
  const lineProfit = round2(lineTotal - lineCost);

  return { qtyInBase, qtyInRateUnit, lineTotal, lineCost, lineProfit };
}

const sugar = {
  baseUnit: "g",
  rateUnit: "kg",
  ratePerRateUnit: 46,
  costPerRateUnit: 40,
};

assert.deepEqual(calculateLine({ ...sugar, quantity: 1, enteredUnit: "kg" }), {
  qtyInBase: 1000,
  qtyInRateUnit: 1,
  lineTotal: 46,
  lineCost: 40,
  lineProfit: 6,
});

assert.deepEqual(calculateLine({ ...sugar, quantity: 500, enteredUnit: "g" }), {
  qtyInBase: 500,
  qtyInRateUnit: 0.5,
  lineTotal: 23,
  lineCost: 20,
  lineProfit: 3,
});

assert.deepEqual(calculateLine({ ...sugar, quantity: 250, enteredUnit: "g" }), {
  qtyInBase: 250,
  qtyInRateUnit: 0.25,
  lineTotal: 11.5,
  lineCost: 10,
  lineProfit: 1.5,
});

const oil = {
  baseUnit: "ml",
  rateUnit: "ltr",
  ratePerRateUnit: 160,
  costPerRateUnit: 140,
};

assert.deepEqual(calculateLine({ ...oil, quantity: 500, enteredUnit: "ml" }), {
  qtyInBase: 500,
  qtyInRateUnit: 0.5,
  lineTotal: 80,
  lineCost: 70,
  lineProfit: 10,
});

// A legacy pharmacy catalogue counts and prices whole strips without a pack
// row. Identity works; converting that strip into tablets still needs a size.
assert.deepEqual(calculateLine({ quantity: 2, enteredUnit: "strip", baseUnit: "strip", rateUnit: "strip", ratePerRateUnit: 50, costPerRateUnit: 30 }), {
  qtyInBase: 2, qtyInRateUnit: 2, lineTotal: 100, lineCost: 60, lineProfit: 40,
});
assert.equal(fromBaseQty(3, "Strip", " strip "), 3);
assert.equal(rateUnitToBase(" bottle ", "Bottle"), 1);
for (const convert of [toBaseQty, fromBaseQty]) {
  assert.throws(() => convert(1, "strip", "piece"), /Unsupported unit/);
  assert.throws(() => convert(1, "", ""), /required/);
}
assert.throws(() => rateUnitToBase("strip", "piece"), /Unsupported unit/);
assert.throws(() => rateUnitToBase("", ""), /required/);

console.log("Billing calculation examples passed");
