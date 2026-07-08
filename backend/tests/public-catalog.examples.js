import assert from "assert";
import fs from "fs";
import { isCustomerOrderingEnabled, toCustomerSafeProduct } from "../src/modules/public/public.service.js";

// ── Regression: enabling customer QR ordering must persist WITHOUT an owner PIN ──
// The shop settings save is a debounced background autosave that can't prompt for a PIN, so
// gating settingsJson behind the blanket requireOwnerPin made it silently 403 in production
// (OWNER_PIN_REQUIRED=true) — the customerOrdering flag never reached the server and the public
// catalog returned "shop not available". settingsJson must NOT be a PIN-protected field; the
// shop's legal identity fields still must be.
const shopsRoutes = fs.readFileSync(new URL("../src/modules/shops/shops.routes.js", import.meta.url), "utf8");
// Inspect the PATCH route line itself (not comments, which legitimately mention the old guard).
const patchLine = shopsRoutes.split("\n").find((line) => line.includes("router.patch"));
assert.ok(patchLine, "shops.routes must define a PATCH route");
assert.ok(
  patchLine.includes("requireOwnerPinForFields(PIN_PROTECTED_SHOP_FIELDS)"),
  "shop PATCH must PIN-gate only sensitive fields, not the whole request",
);
assert.ok(!/\brequireOwnerPin\b(?!ForFields)/.test(patchLine), "shop PATCH must not use the blanket requireOwnerPin middleware");
const protectedList = shopsRoutes.match(/PIN_PROTECTED_SHOP_FIELDS\s*=\s*\[([^\]]*)\]/);
assert.ok(protectedList, "PIN_PROTECTED_SHOP_FIELDS must be defined");
assert.ok(!/settingsJson/.test(protectedList[1]), "settingsJson must NOT be PIN-protected (background autosave)");
for (const identity of ["name", "gstNumber", "address"]) {
  assert.ok(protectedList[1].includes(`"${identity}"`), `${identity} must stay PIN-protected`);
}

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
