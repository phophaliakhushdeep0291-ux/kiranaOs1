import assert from "assert";
import { isCustomerOrderingEnabled, toCustomerSafeProduct } from "../src/modules/public/public.service.js";

// The public customer catalog is owner-opt-in and must NEVER expose cost/margin/stock/min-price
// or any internal field. These two pure helpers are the privacy boundary; this guards them.

// ── Opt-in gate: only an explicit settingsJson.customerOrdering.enabled === true opens it ──
assert.equal(isCustomerOrderingEnabled(null), false, "null settings -> off");
assert.equal(isCustomerOrderingEnabled(""), false, "empty settings -> off");
assert.equal(isCustomerOrderingEnabled("{not json"), false, "malformed json -> off");
assert.equal(isCustomerOrderingEnabled("{}"), false, "no flag -> off (default)");
assert.equal(
  isCustomerOrderingEnabled(JSON.stringify({ customerOrdering: { enabled: false } })),
  false,
  "explicit false -> off",
);
assert.equal(
  isCustomerOrderingEnabled(JSON.stringify({ customerOrdering: { enabled: "yes" } })),
  false,
  "non-boolean truthy must NOT enable (strict === true)",
);
assert.equal(
  isCustomerOrderingEnabled(JSON.stringify({ customerOrdering: { enabled: true } })),
  true,
  "explicit true -> on",
);

// ── Safe mapping: only storefront fields survive; sensitive fields are dropped ──
const fullProduct = {
  id: "p1",
  name: "Tata Salt 1kg",
  category: "Grocery",
  unit: "kg",
  displayUnit: "packet",
  rateUnit: "packet",
  defaultPricePerRateUnit: 28,
  mrp: 30,
  imageUrl: "https://img/x.png",
  // sensitive — must never appear:
  costPerRateUnit: 22,
  costPrice: 22,
  averageCostPrice: 21.5,
  minPricePerRateUnit: 24,
  minimumSellingPrice: 24,
  stockBaseQty: 5000,
  stockQuantity: 5,
  gstRate: 5,
  hsn: "2501",
  wholesalePricePerRateUnit: 25,
  customerSpecificPricing: { c1: 26 },
  shopId: "shop_secret",
};

const safe = toCustomerSafeProduct(fullProduct);
assert.deepEqual(
  Object.keys(safe).sort(),
  ["category", "id", "imageUrl", "mrp", "name", "price", "unit"],
  "safe product must expose exactly the storefront fields",
);
assert.equal(safe.price, 28, "price comes from defaultPricePerRateUnit");
assert.equal(safe.unit, "packet", "unit prefers displayUnit");
assert.equal(safe.mrp, 30, "mrp preserved");

const SENSITIVE = [
  "costPerRateUnit", "costPrice", "averageCostPrice", "minPricePerRateUnit",
  "minimumSellingPrice", "stockBaseQty", "stockQuantity", "gstRate", "hsn",
  "wholesalePricePerRateUnit", "customerSpecificPricing", "shopId",
];
for (const field of SENSITIVE) {
  assert.ok(!(field in safe), `sensitive field "${field}" must NOT be exposed in the public catalog`);
}

// unit falls back through rateUnit -> unit -> "piece" when displayUnit is absent
assert.equal(toCustomerSafeProduct({ id: "a", name: "x", rateUnit: "box" }).unit, "box", "unit falls back to rateUnit");
assert.equal(toCustomerSafeProduct({ id: "a", name: "x", unit: "litre" }).unit, "litre", "unit falls back to unit");
assert.equal(toCustomerSafeProduct({ id: "a", name: "x" }).unit, "piece", "unit defaults to piece");
assert.equal(toCustomerSafeProduct({ id: "a", name: "x" }).mrp, null, "absent mrp -> null");
assert.equal(toCustomerSafeProduct({ id: "a", name: "x" }).price, 0, "absent price -> 0");

console.log("public-catalog.examples.js OK");
