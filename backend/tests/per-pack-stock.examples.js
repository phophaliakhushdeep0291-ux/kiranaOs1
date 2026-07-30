import assert from "node:assert/strict";
import { createProductSchema } from "../src/modules/products/products.schema.js";

// Per-packaging stock, Stage 2: the API must accept and preserve a quantity per
// packaging. Everything here is pure schema behaviour — no database needed.
//
// The rule that matters: anything normalizeSellingUnits does not name explicitly
// is dropped, so a regression would silently discard the counts the shopkeeper
// typed per pack and leave every size reading empty.

// ── a per-pack product carries its own count on each packaging ──────
const perPack = createProductSchema.parse({
  name: "Maggi Noodles",
  defaultPricePerRateUnit: 14,
  packagingMode: "per_pack",
  sellingUnits: [
    { name: "70 g packet", unitType: "packet", unitCode: "pkt70", packSizeValue: 70, packSizeUnit: "gram", conversionToBase: 1, defaultPrice: 14, onHandQty: 24, lowStockThreshold: 6, reorderLevel: 48, isDefault: true },
    { name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 8, defaultPrice: 108, onHandQty: 1, lowStockThreshold: 2, reorderLevel: 12 },
  ],
});

assert.equal(perPack.packagingMode, "per_pack");
const [packet, box] = perPack.sellingUnits;
assert.equal(packet.onHandQty, 24, "the 70 g packet keeps its own count");
assert.equal(box.onHandQty, 1, "the 8-pack keeps a different count");
assert.equal(packet.reorderLevel, 48);
assert.equal(box.lowStockThreshold, 2);

// The whole point: answer "which size do I need to order?" per packaging.
const low = perPack.sellingUnits.filter(
  (unit) => unit.onHandQty != null && unit.lowStockThreshold != null && unit.onHandQty <= unit.lowStockThreshold,
);
assert.deepEqual(low.map((unit) => unit.unitCode), ["box8"], "only the 8-pack is below its alert level");

// ── an existing product is untouched ────────────────────────────────
// Loose goods must stay pooled: 1 kg and a 5 kg bag come out of the same sack,
// so splitting their stock would strand it and block valid sales.
const pooled = createProductSchema.parse({ name: "Loose Rice", defaultPricePerRateUnit: 58, stockBaseQty: 40000 });
assert.equal(pooled.packagingMode, "pooled", "products default to today's pooled behaviour");

// ── the mode is a closed set ────────────────────────────────────────
assert.throws(
  () => createProductSchema.parse({ name: "X", defaultPricePerRateUnit: 1, packagingMode: "per-pack" }),
  "an unknown packaging mode is rejected rather than silently stored",
);

console.log("per-pack-stock.examples.js OK");
