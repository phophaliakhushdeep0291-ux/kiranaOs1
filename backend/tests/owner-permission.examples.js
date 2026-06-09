import assert from "node:assert/strict";
import { doesBodyTouchProtectedFields, purchaseChangesProtectedPrice } from "../src/utils/permissionRules.js";

const protectedProductFields = [
  "defaultPricePerRateUnit",
  "costPerRateUnit",
  "minPricePerRateUnit",
  "gstRate",
  "hsn",
];

assert.equal(
  doesBodyTouchProtectedFields({ name: "Sugar" }, protectedProductFields),
  false,
  "Changing only product name should not require owner PIN"
);

assert.equal(
  doesBodyTouchProtectedFields({ category: "grocery", aliases: ["chini"] }, protectedProductFields),
  false,
  "Changing non-sensitive product metadata should not require owner PIN"
);

assert.equal(
  doesBodyTouchProtectedFields({ defaultPricePerRateUnit: 48 }, protectedProductFields),
  true,
  "Changing selling price should require owner PIN/owner role"
);

assert.equal(
  doesBodyTouchProtectedFields({ costPerRateUnit: 40 }, protectedProductFields),
  true,
  "Changing cost price should require owner PIN/owner role"
);

assert.equal(
  doesBodyTouchProtectedFields({ minPricePerRateUnit: 44 }, protectedProductFields),
  true,
  "Changing minimum price should require owner PIN/owner role"
);

assert.equal(
  doesBodyTouchProtectedFields({ gstRate: 5 }, protectedProductFields),
  true,
  "Changing GST should require owner PIN/owner role"
);

assert.equal(
  doesBodyTouchProtectedFields({ hsn: "1701" }, protectedProductFields),
  true,
  "Changing HSN should require owner PIN/owner role"
);

assert.equal(
  purchaseChangesProtectedPrice({ updateCost: false }),
  false,
  "Stock purchase with cost update disabled should not require owner PIN"
);

assert.equal(
  purchaseChangesProtectedPrice({}),
  true,
  "Stock purchase with default updateCost=true should require owner PIN"
);

assert.equal(
  purchaseChangesProtectedPrice({ updateCost: false, updateMinPrice: true }),
  true,
  "Stock purchase updating minimum price should require owner PIN"
);

console.log("Owner permission examples passed");
