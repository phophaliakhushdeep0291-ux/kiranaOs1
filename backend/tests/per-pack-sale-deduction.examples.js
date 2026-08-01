import assert from "node:assert/strict";
import { aggregateStockUpdates } from "../src/modules/bills/bills.service.js";

// Selling the same product in two pack sizes on one bill is the case that makes
// per-packaging stock hard: base units merge into a single movement (they are the
// same goods out of the same shelf) but two different packs have to come down.
//
// The shopkeeper's ask: "when I select the particular packaging size the qty
// should deduct from that".

const maggi = { id: "prod_maggi", name: "Maggi Noodles", packagingMode: "per_pack" };
const packet70 = { id: "su_packet70", name: "70 g packet", conversionToBase: 70 };
const box8 = { id: "su_box8", name: "8-pack box", conversionToBase: 560 };

// ── one bill, same product, two pack sizes ──────────────────────────
// 2 packets (140 g) + 1 box (560 g) = 700 g off the shelf.
const merged = aggregateStockUpdates([
  { product: maggi, qtyInBase: 140, lineProfit: 6, sellingUnit: packet70, sellingUnitQty: 2 },
  { product: maggi, qtyInBase: 560, lineProfit: 16, sellingUnit: box8, sellingUnitQty: 1 },
]);

assert.equal(merged.size, 1, "base-unit stock is still one movement per product");
const entry = merged.get("prod_maggi");
assert.equal(entry.qtyInBase, 700, "base units are summed exactly as before");

const packs = entry.sellingUnitQtyById;
assert.equal(packs.size, 2, "but each pack is tracked separately");
assert.equal(packs.get("su_packet70").qty, 2, "two packets leave the packet count");
assert.equal(packs.get("su_box8").qty, 1, "one box leaves the box count");

// ── repeated lines of the SAME pack accumulate ──────────────────────
// Scanning the same packet three times as three lines must remove three packets,
// not one.
const repeated = aggregateStockUpdates([
  { product: maggi, qtyInBase: 70, sellingUnit: packet70, sellingUnitQty: 1 },
  { product: maggi, qtyInBase: 140, sellingUnit: packet70, sellingUnitQty: 2 },
]);
assert.equal(repeated.get("prod_maggi").qtyInBase, 210);
assert.equal(repeated.get("prod_maggi").sellingUnitQtyById.get("su_packet70").qty, 3);

// ── loose goods are untouched ───────────────────────────────────────
// 1 kg and a 5 kg bag come out of the same sack, so rice keeps one pooled number.
// A pooled product must produce no pack breakdown at all, or a later reader could
// mistake an empty breakdown for "this pack is at zero".
const rice = { id: "prod_rice", name: "Loose Rice", packagingMode: "pooled" };
const pooled = aggregateStockUpdates([
  { product: rice, qtyInBase: 2500, lineProfit: 30, sellingUnit: null, sellingUnitQty: 0 },
]);
assert.equal(pooled.get("prod_rice").qtyInBase, 2500);
assert.equal(pooled.get("prod_rice").sellingUnitQtyById.size, 0, "pooled products carry no pack breakdown");

// ── separate products stay separate ─────────────────────────────────
const both = aggregateStockUpdates([
  { product: maggi, qtyInBase: 70, sellingUnit: packet70, sellingUnitQty: 1 },
  { product: rice, qtyInBase: 1000, sellingUnit: null, sellingUnitQty: 0 },
]);
assert.equal(both.size, 2);
assert.equal(both.get("prod_maggi").sellingUnitQtyById.size, 1);
assert.equal(both.get("prod_rice").sellingUnitQtyById.size, 0);

// ── a zero-quantity line contributes nothing ────────────────────────
// Guards against a returned/voided line silently registering a pack movement.
const zeroed = aggregateStockUpdates([
  { product: maggi, qtyInBase: 0, sellingUnit: packet70, sellingUnitQty: 0 },
]);
assert.equal(zeroed.get("prod_maggi").sellingUnitQtyById.size, 0, "a zero-quantity line moves no packs");

console.log("per-pack-sale-deduction.examples.js OK");
