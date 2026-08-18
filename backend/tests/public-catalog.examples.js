import assert from "assert";
import fs from "fs";
import {
  baseQtyPerSellingUnit,
  hasSellableStock,
  isCustomerOrderingEnabled,
  toCustomerSafeProduct,
} from "../src/modules/public/public.service.js";

// ── Regression: enabling customer QR ordering must persist WITHOUT an owner PIN ──
// The shop settings save is a debounced background autosave that can't prompt for a PIN, so
// gating settingsJson behind the blanket requireOwnerPin made it silently 403 in production
// (OWNER_PIN_REQUIRED=true) — the customerOrdering flag never reached the server and the public
// catalog returned "shop not available". settingsJson must NOT be a PIN-protected field; the
// shop's legal identity fields still must be.
const shopsRoutes = fs.readFileSync(new URL("../src/modules/shops/shops.routes.js", import.meta.url), "utf8");
// Inspect the PATCH route line itself (not comments, which legitimately mention the old guard).
// Match the shop root route specifically: /setup-status is a second PATCH that is role-gated
// rather than PIN-gated, and it sits above this one — matching on "router.patch" alone read
// that line instead and failed on a guard it was never meant to check.
const patchLine = shopsRoutes.split("\n").find((line) => /router\.patch\(\s*["']\/["']/.test(line));
assert.ok(patchLine, "shops.routes must define a PATCH route for the shop root");
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

// ── Regression: a QR order must convert quantities the way the till does ──────
// The storefront counts a product in its SELLING unit (a bag, a 10-tablet strip)
// while stock is kept in base units, and the two only line up through that unit's
// conversionToBase — the same number bills.service.js converts with. The public
// order path instead ran toBaseQty(qty, rateUnit, baseUnit), which knows eighteen
// units and THROWS on the rest. Every product sold by the bag, strip, pair, plate
// or bottle — legitimate primary units for six of the trades — made the whole
// order 400 with "Unsupported unit", so nothing in that cart could be ordered.
const bagOfAtta = {
  name: "Aashirvaad Atta 5kg", rateUnit: "bag", displayUnit: "bag", baseUnit: "bag", stockBaseQty: 18,
  sellingUnits: [{ unitCode: "bag", conversionToBase: 1, isDefault: true, isActive: true }],
};
assert.equal(baseQtyPerSellingUnit(bagOfAtta), 1, "a bag is its own base unit, not a thrown 400");
assert.equal(hasSellableStock(bagOfAtta), true, "18 bags in stock must be orderable");

const stripOfParacetamol = {
  name: "Paracetamol 500 mg", rateUnit: "strip", displayUnit: "strip 10 piece", baseUnit: "piece", stockBaseQty: 100,
  sellingUnits: [{ unitCode: "strip-10-piece", conversionToBase: 10, isDefault: true, isActive: true }],
};
// 100 tablets is TEN strips. toBaseQty would have thrown on "strip"; ignoring the
// selling unit and comparing 1:1 would have sold a hundred.
assert.equal(baseQtyPerSellingUnit(stripOfParacetamol), 10, "a strip costs ten pieces of stock");
assert.equal(hasSellableStock(stripOfParacetamol), true, "ten strips left is in stock");
assert.equal(
  hasSellableStock({ ...stripOfParacetamol, stockBaseQty: 9 }),
  false,
  "nine loose tablets cannot fill one strip, so the strip must not be offered",
);

// A product sold by the kilo with five grams left is not in stock. Showing it and
// then refusing at checkout is the same disagreement, moved one screen later.
const looseSugar = {
  name: "Shakkar (Sugar)", rateUnit: "kg", displayUnit: "kg", baseUnit: "g", stockBaseQty: 5, sellingUnits: [],
};
assert.equal(baseQtyPerSellingUnit(looseSugar), 1000, "no selling unit -> fall back to the unit table");
assert.equal(hasSellableStock(looseSugar), false, "5 g of a product sold by the kg is out of stock");
assert.equal(hasSellableStock({ ...looseSugar, stockBaseQty: 5000 }), true, "5 kg is five sellable kilos");

// The default packaging is what the storefront prices, so it is what stock is
// measured against — an inactive or non-default row must not stand in for it.
assert.equal(
  baseQtyPerSellingUnit({
    rateUnit: "packet", baseUnit: "g",
    sellingUnits: [
      { unitCode: "8-pack", conversionToBase: 4000, isDefault: false, isActive: true },
      { unitCode: "500-g-packet", conversionToBase: 500, isDefault: true, isActive: true },
    ],
  }),
  500,
  "the default packaging decides, not the first row",
);
assert.equal(
  baseQtyPerSellingUnit({
    rateUnit: "kg", baseUnit: "g",
    sellingUnits: [{ unitCode: "retired", conversionToBase: 250, isDefault: true, isActive: false }],
  }),
  1000,
  "a retired packaging must not set the storefront's stock rule",
);

// Never zero: a divide by it decides how many the guest may order.
assert.equal(
  baseQtyPerSellingUnit({ rateUnit: "piece", baseUnit: "piece", sellingUnits: [{ conversionToBase: 0, isDefault: true, isActive: true }] }),
  1,
  "a zero conversion falls back to 1:1 rather than dividing by zero",
);
assert.equal(baseQtyPerSellingUnit({ rateUnit: "plate", baseUnit: "plate" }), 1, "an unknown unit is its own base unit");

console.log("public-catalog.examples.js OK");
