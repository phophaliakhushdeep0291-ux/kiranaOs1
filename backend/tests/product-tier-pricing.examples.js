import assert from "node:assert/strict";
import { createProductSchema, updateProductSchema } from "../src/modules/products/products.schema.js";
import { deserializeProduct } from "../src/modules/products/products.service.js";

const tiered = createProductSchema.parse({
  name: "Tiered rice",
  defaultPricePerRateUnit: 45,
  retailPricePerRateUnit: 45,
  retailFromQuantity: 1,
  wholesalePricePerRateUnit: 42,
  wholesaleFromQuantity: 10,
});

assert.equal(tiered.wholesalePricePerRateUnit, 42, "create validation must retain wholesale price");
assert.equal(tiered.wholesaleFromQuantity, 10, "create validation must retain wholesale threshold");

const update = updateProductSchema.parse({
  retailPricePerRateUnit: 44,
  wholesalePricePerRateUnit: 40,
  wholesaleFromQuantity: 12,
});
assert.deepEqual(update, {
  retailPricePerRateUnit: 44,
  wholesalePricePerRateUnit: 40,
  wholesaleFromQuantity: 12,
});

const hydrated = deserializeProduct({
  id: "product-1",
  aliasesJson: "[]",
  variantAxesJson: "[]",
  attributesJson: "{}",
  defaultPricePerRateUnit: 45,
  retailPricePerRateUnit: 44,
  retailFromQuantity: 1,
  wholesalePricePerRateUnit: 40,
  wholesaleFromQuantity: 12,
});
assert.equal(hydrated.retailPrice, 44, "API alias must expose the persisted retail tier");
assert.equal(hydrated.wholesalePrice, 40, "API alias must expose the persisted wholesale tier");

const legacy = deserializeProduct({
  aliasesJson: "[]",
  variantAxesJson: "[]",
  attributesJson: "{}",
  defaultPricePerRateUnit: 45,
  retailPricePerRateUnit: null,
  wholesalePricePerRateUnit: null,
});
assert.equal(legacy.retailPrice, 45, "legacy products must inherit the default retail price");
assert.equal(legacy.wholesalePrice, 45, "legacy products must inherit the default wholesale price");

console.log("Product tier pricing contract examples passed");
