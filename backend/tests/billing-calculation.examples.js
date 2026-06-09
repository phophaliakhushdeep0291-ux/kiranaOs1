import assert from "node:assert/strict";
import { round2 } from "../src/utils/money.js";
import { toBaseQty, baseQtyToRateQty } from "../src/utils/units.js";

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

console.log("Billing calculation examples passed");
