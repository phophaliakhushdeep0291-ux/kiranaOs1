import test from "node:test";
import assert from "node:assert/strict";
import { resolveBillLineUnit as resolve } from "../src/modules/ai/agent/tools/bill-line-units.js";

const sugar = { baseUnit: "gram", rateUnit: "kg", defaultPricePerRateUnit: 42 };
const loose = { id: "kg", name: "kg", unitType: "kg", unitCode: "kg", defaultPrice: 42, conversionToBase: 1000 };
const bag = { id: "bag", name: "500g bag", unitType: "packet", unitCode: "bag-500", packSizeValue: 500, packSizeUnit: "gram", defaultPrice: 25, conversionToBase: 500 };
const large = { ...bag, id: "large", name: "1kg bag", unitCode: "bag-1000", packSizeValue: 1000, defaultPrice: 48, conversionToBase: 1000 };

test("500 grams is half a kg at the catalogue kg price", () => {
  for (const product of [sugar, { ...sugar, sellingUnits: [loose, bag] }]) {
    const line = resolve(product, "grams", 500);
    assert.equal(line.resolved, true); assert.equal(line.quantity, 0.5);
    assert.equal(line.rate, 42); assert.equal(line.unit, "kg");
    assert.equal(line.quantity * line.rate, 21);
  }
});
test("volume converts to the priced unit without a thousand-fold overcharge", () => {
  assert.deepEqual(resolve({ rateUnit: "ltr", baseUnit: "ml", defaultPricePerRateUnit: 120 }, "ml", 250), { resolved: true, quantity: 0.25, unit: "ltr", rate: 120 });
});
test("a named pack carries its own price, identity and stock conversion", () => {
  assert.deepEqual(resolve({ ...sugar, sellingUnits: [loose, bag, large] }, "bag-1000", 2), { resolved: true, quantity: 2, unit: "1kg bag", rate: 48, sellingUnitId: "large", conversionToBase: 1000 });
});
test("a generic packet cannot pick among sizes even with a default", () => {
  assert.equal(resolve({ ...sugar, rateUnit: "packet", sellingUnits: [{ ...bag, isDefault: true }, large] }, "packet", 2).reason, "ambiguous_unit");
  assert.equal(resolve({ ...sugar, rateUnit: "packet", sellingUnits: [bag, large] }, undefined, 2).reason, "ambiguous_unit");
});
test("weight cannot mean a pack count, and volume cannot mean weight", () => {
  assert.equal(resolve({ ...sugar, sellingUnits: [bag] }, "gram", 500).resolved, false);
  assert.equal(resolve(sugar, "ml", 500).resolved, false);
  assert.equal(resolve(sugar, "carton", 2).resolved, false);
});
test("a retired pack cannot be selected and per-pack stock cannot use loose conversion", () => {
  assert.equal(resolve({ ...sugar, sellingUnits: [loose, { ...bag, isActive: false }] }, "bag-500", 1).resolved, false);
  assert.equal(resolve({ ...sugar, packagingMode: "per_pack", sellingUnits: [loose] }, "gram", 500).resolved, false);
});
test("unrepresentable quantities stay for review instead of rounding a sale away", () => {
  for (const quantity of [0, NaN, Infinity, -1, 1e10]) assert.equal(resolve(sugar, "kg", quantity).resolved, false);
  assert.equal(resolve(sugar, "gram", 0.1).reason, "quantity_precision");
});
test("missing prices cannot become free items, while a configured zero is valid", () => {
  assert.equal(resolve({ ...sugar, defaultPricePerRateUnit: null }, "kg", 1).reason, "price_not_available");
  assert.equal(resolve({ ...sugar, defaultPricePerRateUnit: 0 }, "kg", 1).rate, 0);
});
