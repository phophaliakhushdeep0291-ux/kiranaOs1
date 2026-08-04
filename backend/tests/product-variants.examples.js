import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createProductSchema } from "../src/modules/products/products.schema.js";

// Size × colour variants for clothing and footwear.
//
// A variant is a ProductSellingUnit row tagged with its position on the parent's
// declared axes. What it replaces is the shopkeeper hand-typing one Product per
// size and colour — twenty near-identical rows for one shirt, and no way to see
// that L-blue is out while XS sits dead on the shelf.

// ── a garment declares its grid, and each row knows where it sits ───
const shirt = createProductSchema.parse({
  name: "Cotton Shirt",
  defaultPricePerRateUnit: 350,
  packagingMode: "per_pack",
  variantAxes: [
    { name: "Size", values: ["S", "M", "L"] },
    { name: "Colour", values: ["Blue", "White"] },
  ],
  sellingUnits: [
    { name: "L / Blue", unitType: "piece", unitCode: "l-blue", conversionToBase: 1, defaultPrice: 350, onHandQty: 4, variantValue1: "L", variantValue2: "Blue", isDefault: true },
    { name: "S / White", unitType: "piece", unitCode: "s-white", conversionToBase: 1, defaultPrice: 350, onHandQty: 0, variantValue1: "S", variantValue2: "White" },
  ],
});

assert.equal(shirt.variantAxes.length, 2);
assert.deepEqual(shirt.variantAxes[0], { name: "Size", values: ["S", "M", "L"] });
const [lBlue, sWhite] = shirt.sellingUnits;
assert.equal(lBlue.variantValue1, "L", "axis 1 is the size");
assert.equal(lBlue.variantValue2, "Blue", "axis 2 is the colour");
assert.equal(sWhite.onHandQty, 0, "each row holds its own stock");

// The question the old one-Product-per-SKU workaround could never answer.
const sellable = shirt.sellingUnits.filter((unit) => unit.variantValue1 === "L" && unit.onHandQty > 0);
assert.deepEqual(sellable.map((u) => u.unitCode), ["l-blue"], "per-size availability is answerable");

// ── an ordinary product is untouched ────────────────────────────────
const rice = createProductSchema.parse({ name: "Loose Rice", defaultPricePerRateUnit: 58 });
assert.deepEqual(rice.variantAxes, [], "a kirana product declares no axes");

// A packaging row is not a variant row: it has no axis position.
const noodles = createProductSchema.parse({
  name: "Maggi",
  defaultPricePerRateUnit: 14,
  packagingMode: "per_pack",
  sellingUnits: [{ name: "70 g packet", unitType: "packet", unitCode: "pkt70", packSizeValue: 70, packSizeUnit: "gram", conversionToBase: 1, defaultPrice: 14, isDefault: true }],
});
assert.equal(noodles.sellingUnits[0].variantValue1, undefined, "packaging rows carry no axis value");

// ── a whole-record payload states an empty column as null ───────────
// createProductSchema is reused by the sync push path, where a snapshot sends
// every column including the empty ones. .optional() alone rejects null.
const fromSnapshot = createProductSchema.parse({
  name: "Snapshot",
  defaultPricePerRateUnit: 10,
  sellingUnits: [{ name: "piece", unitType: "piece", unitCode: "pc", conversionToBase: 1, defaultPrice: 10, variantValue1: null, variantValue2: null, isDefault: true }],
});
assert.equal(fromSnapshot.sellingUnits[0].variantValue1, null, "an explicit null is accepted, not rejected");

// ── the grid cap fits a real matrix ─────────────────────────────────
// 6 sizes × 6 colours is 36 rows. The old .max(30) rejected that outright, so a
// shop could not enter its own catalogue.
const sixBySix = Array.from({ length: 36 }, (_, i) => ({
  name: `v${i}`, unitType: "piece", unitCode: `v${i}`, conversionToBase: 1, defaultPrice: 100,
  variantValue1: ["XS", "S", "M", "L", "XL", "XXL"][i % 6],
  variantValue2: ["Black", "White", "Blue", "Red", "Green", "Grey"][Math.floor(i / 6)],
}));
assert.ok(
  createProductSchema.safeParse({ name: "Full Matrix", defaultPricePerRateUnit: 100, packagingMode: "per_pack", sellingUnits: sixBySix }).success,
  "a 6 × 6 grid is accepted",
);

// The cap is a real limit on sync payload size, not decoration.
assert.equal(
  createProductSchema.safeParse({
    name: "Too Many", defaultPricePerRateUnit: 100,
    sellingUnits: Array.from({ length: 101 }, (_, i) => ({ name: `v${i}`, unitType: "piece", unitCode: `v${i}`, conversionToBase: 1, defaultPrice: 1 })),
  }).success,
  false,
  "beyond 100 rows is still rejected",
);

// ── two axes at most ────────────────────────────────────────────────
assert.equal(
  createProductSchema.safeParse({
    name: "Three Axes", defaultPricePerRateUnit: 100,
    variantAxes: [
      { name: "Size", values: ["S"] }, { name: "Colour", values: ["Blue"] }, { name: "Fit", values: ["Slim"] },
    ],
  }).success,
  false,
  "a third axis is rejected — there are only two variantValue columns to hold it",
);

// An axis with no values is a grid with no rows.
assert.equal(
  createProductSchema.safeParse({ name: "Empty Axis", defaultPricePerRateUnit: 100, variantAxes: [{ name: "Size", values: [] }] }).success,
  false,
  "an axis must offer at least one value",
);

// ── the two whitelists that silently drop fields ────────────────────
// normalizeSellingUnits and writeSellingUnits each name every column they carry,
// and anything unnamed is dropped on the floor. That already cost this codebase
// the per-pack stock quantities once; these guard the same shape for variants.
const service = readFileSync(new URL("../src/modules/products/products.service.js", import.meta.url), "utf8");
for (const field of ["variantValue1", "variantValue2"]) {
  assert.equal(
    (service.match(new RegExp(field, "g")) || []).length >= 2,
    true,
    `${field} must be carried by BOTH normalizeSellingUnits and writeSellingUnits`,
  );
}
assert.match(service, /variantAxesJson: JSON\.stringify/, "the grid must be serialized on create");
assert.match(service, /variantAxes: parseVariantAxes/, "the grid must be parsed back out for the client");

// ── a variant grid forces per-pack stock ────────────────────────────
// On "pooled" every size would draw from one number and report availability that
// is simply untrue, so declaring axes decides the packaging mode.
assert.match(service, /packagingModeForAxes/, "the coercion must exist");
assert.match(
  service,
  /function packagingModeForAxes\(axes, fallback\) \{\s*return Array\.isArray\(axes\) && axes\.length > 0 \? "per_pack" : fallback;/,
  "axes must map to per_pack, and no axes must leave the caller's mode alone",
);

console.log("product-variants.examples.js OK");
