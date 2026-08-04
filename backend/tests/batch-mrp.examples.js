import test from "node:test";
import assert from "node:assert/strict";
import { sellingUnitMaxPrice } from "../src/modules/products/selling-unit-pricing.js";
import { batchMrpCeilings } from "../src/modules/inventory-lots/inventoryLots.service.js";

/**
 * A medicine's price ceiling belongs to the strip in hand, not to the product row.
 *
 * A manufacturer revises the printed MRP between batches, so the same product sits
 * on the shelf at two lawful prices at once. Before this, billing capped every line
 * against Product.mrp whichever batch FEFO actually dispensed — which both permitted
 * charging above the strip the customer is holding and rejected an honest price on a
 * batch whose MRP had been raised.
 */

const DEFAULT_PACK = { id: "strip", isDefault: true, conversionToBase: 10 };
const BOX_OF_10 = { id: "box", isDefault: false, conversionToBase: 100 };

test("with no batch price, the ceiling is exactly what it was before", () => {
  const product = { mrp: 55 };
  // Product MRP, default pack.
  assert.equal(sellingUnitMaxPrice(DEFAULT_PACK, product, DEFAULT_PACK), 55);
  // Product MRP scaled to a pack ten times the default.
  assert.equal(sellingUnitMaxPrice(BOX_OF_10, product, DEFAULT_PACK), 550);
  // The pack's own configured maximum still wins over the product MRP.
  assert.equal(sellingUnitMaxPrice({ ...BOX_OF_10, maximumPrice: 500 }, product, DEFAULT_PACK), 500);
  // No MRP anywhere means uncapped, same as a product with no MRP today.
  assert.equal(sellingUnitMaxPrice(DEFAULT_PACK, { mrp: 0 }, DEFAULT_PACK), 0);
});

test("the batch price replaces the product price, in both directions", () => {
  const product = { mrp: 55 };
  // Revised DOWN: the product row still says 55, but this strip is printed 48.
  assert.equal(sellingUnitMaxPrice(DEFAULT_PACK, product, DEFAULT_PACK, 48), 48);
  // Revised UP: an honest 62 must not be rejected against a stale product MRP.
  assert.equal(sellingUnitMaxPrice(DEFAULT_PACK, product, DEFAULT_PACK, 62), 62);
});

test("a batch price scales onto the pack being sold, like the product price", () => {
  // One rule, not two: batch MRP is stored on the same basis as Product.mrp.
  assert.equal(sellingUnitMaxPrice(BOX_OF_10, { mrp: 55 }, DEFAULT_PACK, 48), 480);
});

test("when both a batch price and a configured maximum apply, the lower wins", () => {
  const product = { mrp: 55 };
  // Printed MRP is the legal ceiling: a shop cannot lift it with its own config.
  assert.equal(sellingUnitMaxPrice({ ...DEFAULT_PACK, maximumPrice: 60 }, product, DEFAULT_PACK, 48), 48);
  // A stricter shop policy still binds below the printed price.
  assert.equal(sellingUnitMaxPrice({ ...DEFAULT_PACK, maximumPrice: 45 }, product, DEFAULT_PACK, 48), 45);
});

/** A transaction stub that serves lots for one product and honours the where filter. */
function fakeTx(lotsByProduct) {
  return {
    inventoryLot: {
      findMany: async ({ where }) => (lotsByProduct[where.productId] ?? [])
        .filter((lot) => lot.availableBaseQty > 0),
    },
  };
}

const lot = (id, batchNumber, availableBaseQty, mrp) => ({ id, batchNumber, availableBaseQty, mrp });

test("an unnamed batch takes the lowest price FEFO would actually consume", async () => {
  const tx = fakeTx({ p1: [lot("a", "B1", 10, 48), lot("b", "B2", 10, 55)] });

  // Fits inside the first batch: only that batch's price binds.
  const within = await batchMrpCeilings(tx, { shopId: "s", locationId: "l", requests: [{ productId: "p1", quantityBaseQty: 6 }] });
  assert.equal(within.get("p1"), 48);

  // Spans both: a single line at one rate cannot exceed the cheaper strip it covers.
  const across = await batchMrpCeilings(tx, { shopId: "s", locationId: "l", requests: [{ productId: "p1", quantityBaseQty: 15 }] });
  assert.equal(across.get("p1"), 48);
});

test("a batch carrying no printed price imposes no ceiling of its own", async () => {
  // These fall back to Product.mrp — the exact pre-batch behaviour.
  const tx = fakeTx({ p1: [lot("a", "B1", 10, null)] });
  const ceilings = await batchMrpCeilings(tx, { shopId: "s", locationId: "l", requests: [{ productId: "p1", quantityBaseQty: 5 }] });
  assert.equal(ceilings.has("p1"), false);
});

test("a named batch sets the ceiling regardless of what FEFO would have picked", async () => {
  // FEFO would take B1 at 48; the operator dispensed B2, so 55 is the lawful cap.
  const tx = fakeTx({ p1: [lot("a", "B1", 10, 48), lot("b", "B2", 10, 55)] });
  const ceilings = await batchMrpCeilings(tx, {
    shopId: "s", locationId: "l",
    requests: [{ productId: "p1", quantityBaseQty: 5, inventoryLotId: "b" }],
  });
  assert.equal(ceilings.get("p1"), 55);
});

test("a named batch that cannot serve the line is refused, not quietly topped up", async () => {
  const tx = fakeTx({ p1: [lot("a", "B1", 10, 48), lot("b", "B2", 3, 55)] });

  // Short: filling the remainder from B1 would span two printed MRPs while the
  // line carries only B2's ceiling.
  await assert.rejects(
    () => batchMrpCeilings(tx, { shopId: "s", locationId: "l", requests: [{ productId: "p1", quantityBaseQty: 5, inventoryLotId: "b" }] }),
    (error) => error.code === "BATCH_STOCK_INSUFFICIENT",
  );

  // Gone entirely — quarantined, recalled, expired or sold out under the operator.
  await assert.rejects(
    () => batchMrpCeilings(tx, { shopId: "s", locationId: "l", requests: [{ productId: "p1", quantityBaseQty: 1, inventoryLotId: "missing" }] }),
    (error) => error.code === "BATCH_NOT_SELLABLE",
  );
});

test("each product resolves its own ceiling", async () => {
  const tx = fakeTx({ p1: [lot("a", "B1", 10, 48)], p2: [lot("c", "B9", 10, 120)] });
  const ceilings = await batchMrpCeilings(tx, {
    shopId: "s", locationId: "l",
    requests: [{ productId: "p1", quantityBaseQty: 2 }, { productId: "p2", quantityBaseQty: 2 }],
  });
  assert.equal(ceilings.get("p1"), 48);
  assert.equal(ceilings.get("p2"), 120);
});
