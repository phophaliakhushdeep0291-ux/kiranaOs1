import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  applyStockCount,
  cancelStockCount,
  createStockCount,
  submitStockCount,
  updateStockCountLines,
} from "../src/modules/inventory/stockCounts.service.js";

/**
 * The workflows a per-pack product cannot take part in, and where it finds out.
 *
 * Counting each pack size separately is the point of `per_pack`, and it is exactly
 * what a couple of shop-wide workflows cannot express. Both used to accept such a
 * product and refuse it at the very last step, after the real-world work was already
 * done. These guards move the refusal to the moment of choosing, and name the path
 * that does work.
 *
 * A product counted per pack size cannot take part in a whole-shelf stock count,
 * and the shop has to learn that BEFORE it walks the aisle.
 *
 * A count line carries one `countedBaseQty` for the product. For a per-pack
 * product that number says nothing about how many 1 kg packets and how many 5 kg
 * bags are on the shelf, so applying it is refused at the movement choke point.
 *
 * Nothing used to stop such a product being selected, so the refusal arrived at
 * APPLY — after the counting was done and sent for approval. Because a count
 * applies atomically, the honest products in the same session lost their figures
 * too, and the session stayed open holding the branch's unique active-count key,
 * blocking every future count until somebody found it and cancelled it.
 *
 * Runs against the real database: the exclusion has to survive the same
 * transaction that snapshots the lines, and the active-count key is a DB
 * constraint rather than anything the service can assert on its own.
 */

const suffix = `stock-count-per-pack-${Date.now()}`;
let shop;
let location;
let counter;

async function makeProduct(name, packagingMode, stockBaseQty) {
  const product = await db.product.create({
    data: {
      shopId: shop.id, name, category: "staples", baseUnit: "g", rateUnit: "packet",
      displayUnit: "packet 1 kg", stockBaseQty, packagingMode,
      defaultPricePerRateUnit: 280, costPerRateUnit: 240,
    },
  });
  if (packagingMode === "per_pack") {
    await db.productSellingUnit.createMany({
      data: [
        { shopId: shop.id, productId: product.id, name: "packet 1 kg", unitType: "packet",
          unitCode: "packet-1-kg", conversionToBase: 1000, defaultPrice: 280, onHandQty: 20, isDefault: true },
        { shopId: shop.id, productId: product.id, name: "packet 5 kg", unitType: "packet",
          unitCode: "packet-5-kg", conversionToBase: 5000, defaultPrice: 1350, onHandQty: 10, isDefault: false },
      ],
    });
  }
  return product;
}

before(async () => {
  shop = await db.shop.create({ data: { name: `SCPP ${suffix}`, ownerName: "o", city: "c", address: "a" } });
  location = await db.storeLocation.create({
    data: { shopId: shop.id, code: "MAIN", name: "Main Counter", isPrimary: true },
  });
  counter = await db.user.create({
    data: { shopId: shop.id, name: "Counter", passwordHash: "test", role: "staff" },
  });
});

after(async () => {
  try {
    await db.auditLog.deleteMany({ where: { shopId: shop.id } });
    await db.stockCountSession.deleteMany({ where: { shopId: shop.id } });
    await db.stockLedger.deleteMany({ where: { shopId: shop.id } });
    await db.productSellingUnit.deleteMany({ where: { shopId: shop.id } });
    await db.product.deleteMany({ where: { shopId: shop.id } });
    await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
    await db.user.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
  } catch (cleanupError) {
    console.error("cleanup failed", cleanupError);
  }
  await db.$disconnect();
});

test("a per-pack product is left out of the count, and named so the shop knows why", async () => {
  const perPack = await makeProduct(`Atta per pack ${suffix}`, "per_pack", 70_000);
  const pooled = await makeProduct(`Rice pooled ${suffix}`, "pooled", 70_000);

  const session = await createStockCount(shop.id, location.id, {
    name: `Monthly ${suffix}`, blindCount: false, productIds: [perPack.id, pooled.id],
  }, { userId: counter.id });

  assert.deepEqual(session.lines.map((line) => line.productId), [pooled.id],
    "only the pooled product can be counted as one total");
  assert.deepEqual(session.excludedPerPackProducts, [{ id: perPack.id, name: perPack.name }],
    "the skipped product is reported by name — the shop has to know before it counts");

  // And the count it CAN do still completes: this is the failure that used to take
  // the honest products down with it.
  await updateStockCountLines(shop.id, location.id, session.id, {
    lines: [{ productId: pooled.id, countedBaseQty: 65_000, reason: "counted" }],
  }, { userId: counter.id });
  await submitStockCount(shop.id, location.id, session.id, { userId: counter.id });
  const applied = await applyStockCount(shop.id, location.id, session.id, { note: "approved" }, { userId: counter.id });

  assert.equal(applied.status, "applied");
  assert.equal((await db.product.findUnique({ where: { id: pooled.id } })).stockBaseQty, 65_000,
    "the pooled product's counted figure lands");
  assert.equal((await db.product.findUnique({ where: { id: perPack.id } })).stockBaseQty, 70_000,
    "the per-pack product is untouched rather than silently overwritten");
});

test("the branch is not left jammed behind a count that can never apply", async () => {
  // The previous count applied, so the branch's active key is free. Before the
  // exclusion existed this is exactly where a shop got stuck: a session frozen in
  // review, and no way to start next month's count without finding and cancelling it.
  const pooled = await makeProduct(`Sugar pooled ${suffix}`, "pooled", 40_000);
  const next = await createStockCount(shop.id, location.id, {
    name: `Next month ${suffix}`, blindCount: false, productIds: [pooled.id],
  }, { userId: counter.id });
  assert.equal(next.status, "counting");
  // One open count per branch is the whole point of the key being unique, so put
  // it back before the next case asks for one.
  await cancelStockCount(shop.id, location.id, next.id, { note: "test cleanup" }, { userId: counter.id });
});

test("selecting only per-pack products is an error, not an empty count", async () => {
  const onlyPerPack = await makeProduct(`Dal per pack ${suffix}`, "per_pack", 10_000);
  await assert.rejects(
    createStockCount(shop.id, location.id, {
      name: `Per pack only ${suffix}`, blindCount: false, productIds: [onlyPerPack.id],
    }, { userId: counter.id }),
    (error) => {
      assert.equal(error.code, "STOCK_COUNT_PER_PACK_ONLY");
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /per pack size/i, "the message says what to do instead");
      return true;
    },
    "counting nothing is not what the shopkeeper asked for",
  );
});

test("a shop with no per-pack products is completely unaffected", async () => {
  const a = await makeProduct(`Poha ${suffix}`, "pooled", 5_000);
  const b = await makeProduct(`Besan ${suffix}`, "pooled", 6_000);
  const session = await createStockCount(shop.id, location.id, {
    name: `Ordinary ${suffix}`, blindCount: false, productIds: [a.id, b.id],
  }, { userId: counter.id });

  assert.equal(session.lines.length, 2);
  assert.deepEqual(session.excludedPerPackProducts, [], "nothing to report when nothing was skipped");
});

/**
 * A purchase order has the same shape of problem, at the other end of the shop.
 *
 * Its line carries `orderedBaseQty` and nothing else, so there is no way to say
 * how many 1 kg packets and how many 5 kg bags were ordered — and receiving one
 * cannot attribute the goods to a pack. The refusal used to arrive at the
 * RECEIVING DESK, with the order already sent to the supplier and the stock
 * physically standing there unbookable. Stock In takes a pack and works for these
 * products today, so the order is refused up front and points there instead.
 */
test("a per-pack product cannot be put on a purchase order at all", async () => {
  const { createPurchaseOrder } = await import("../src/modules/purchase-orders/purchaseOrders.service.js");
  const perPack = await makeProduct(`Maida per pack ${suffix}`, "per_pack", 30_000);

  await assert.rejects(
    createPurchaseOrder(shop.id, {
      supplierName: "Local mill",
      expectedOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      items: [{ productId: perPack.id, orderedBaseQty: 3_000, expectedRate: 240 }],
    }, { userId: counter.id }),
    (error) => {
      assert.equal(error.code, "PURCHASE_ORDER_PER_PACK_UNSUPPORTED");
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /Stock In/, "the message names the path that does work");
      return true;
    },
    "ordering it would only fail once the goods had arrived",
  );
});

test("an ordinary product still orders normally", async () => {
  const { createPurchaseOrder } = await import("../src/modules/purchase-orders/purchaseOrders.service.js");
  const pooled = await makeProduct(`Suji pooled ${suffix}`, "pooled", 30_000);
  const order = await createPurchaseOrder(shop.id, {
    supplierName: "Local mill",
    expectedOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    items: [{ productId: pooled.id, orderedBaseQty: 3_000, expectedRate: 240 }],
  }, { userId: counter.id });

  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].orderedBaseQty, 3_000);
});
