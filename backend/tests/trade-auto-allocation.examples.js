/**
 * What auto-allocation actually reserves, and from which batch.
 *
 * This decides which physical stock leaves the warehouse against a wholesale
 * order, so the rules it follows are commercial, not cosmetic:
 *
 *   first to expire is first to ship   · a batch near its date must go before
 *                                        one with months left, or it is written off
 *   another order's hold is real       · two orders must never reserve the same
 *                                        units, or one buyer is short at dispatch
 *   this order's own hold is not       · re-running allocation must not treat the
 *                                        reservation it is replacing as taken
 *   packaging is respected             · a line ordered in a pack takes untagged
 *                                        stock or that pack's own, never another's
 *
 * The routine was rewritten from a per-batch query loop into two batched reads.
 * Nothing above was covered by a test at the time, which is the only reason this
 * file exists: the arithmetic is unchanged, and these assertions are what says so.
 */
import assert from "node:assert/strict";
import db from "../src/db.js";
import { autoAllocateTradeOrder, getTradeOrder } from "../src/verticals/manufacturing/trade-orders.service.js";

const ok = (label) => console.log(`  ok ${label}`);
const day = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const at = (isoDate) => new Date(`${isoDate}T00:00:00.000Z`);

const shop = await db.shop.create({ data: { name: "Trade allocation test", ownerName: "Test", city: "Test", address: "Test" } });
try {
  const location = await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true } });
  const rice = await db.product.create({ data: { shopId: shop.id, name: "Rice", baseUnit: "kg", rateUnit: "kg", batchTrackingEnabled: true, stockBaseQty: 1000 } });
  const dal = await db.product.create({ data: { shopId: shop.id, name: "Dal", baseUnit: "kg", rateUnit: "kg", batchTrackingEnabled: true, stockBaseQty: 1000 } });
  const bag = await db.productSellingUnit.create({ data: { shopId: shop.id, productId: rice.id, name: "25kg Bag", unitType: "bag", unitCode: "bag", conversionToBase: 25, defaultPrice: 1000 } });
  const otherBag = await db.productSellingUnit.create({ data: { shopId: shop.id, productId: rice.id, name: "50kg Bag", unitType: "bag", unitCode: "bag50", conversionToBase: 50, defaultPrice: 1900 } });

  const lot = async (product, batchNumber, expiresOn, availableBaseQty, sellingUnitId = null) => db.inventoryLot.create({
    data: { shopId: shop.id, locationId: location.id, productId: product.id, sellingUnitId, batchNumber, expiresOn: at(expiresOn), receivedBaseQty: availableBaseQty, availableBaseQty, costPerRateUnit: 30 },
  });

  // Deliberately created newest-first, so a routine that returned rows in
  // insertion order rather than expiry order would fail the first assertion.
  const late = await lot(rice, "RICE-LATE", day(180), 100);
  const soon = await lot(rice, "RICE-SOON", day(30), 60);
  const dalLot = await lot(dal, "DAL-1", day(90), 40);

  let orderSeq = 0;
  const order = async (items, status = "confirmed") => db.tradeOrder.create({
    data: {
      shopId: shop.id, locationId: location.id, orderNumber: `TO-${++orderSeq}`, customerName: "Wholesale buyer", status,
      items: { create: items.map((row) => ({
        shopId: shop.id, productId: row.product.id, sellingUnitId: row.sellingUnitId ?? null,
        description: row.product.name, quantity: row.quantityBaseQty, quantityBaseQty: row.quantityBaseQty,
        unitPrice: 40, lineTotal: 40 * row.quantityBaseQty,
      })) },
    },
    include: { items: true },
  });

  /* ------------------------------------------------------- expiry first */
  const first = await order([{ product: rice, quantityBaseQty: 80 }]);
  const allocatedFirst = await autoAllocateTradeOrder(shop.id, first.id);
  // Keyed by batch rather than compared as a list: the rows are read back
  // through an include with no ordering of its own, so their sequence is the
  // database's business. What matters is which batch gave up how much.
  const byLot = (item) => Object.fromEntries(item.allocations.map((row) => [row.inventoryLotId, Number(row.quantityBaseQty)]));
  assert.deepEqual(byLot(allocatedFirst.items[0]), {
    [soon.id]: 60,
    [late.id]: 20,
  }, "the batch expiring soonest must be emptied before the one expiring later is touched");
  ok("first to expire is first to ship");

  /* --------------------------------- another live order's hold is honoured */
  // `first` is now `allocated`, which is a reserving status, so its 60+20 is
  // held away from everyone else. 100 of 160 base units remain.
  const second = await order([{ product: rice, quantityBaseQty: 200 }]);
  const allocatedSecond = await autoAllocateTradeOrder(shop.id, second.id);
  const secondTotal = allocatedSecond.items[0].allocations.reduce((sum, row) => sum + Number(row.quantityBaseQty), 0);
  assert.equal(secondTotal, 80, "only what the first order left may be reserved");
  assert.deepEqual(
    allocatedSecond.items[0].allocations.map((row) => row.inventoryLotId),
    [late.id],
    "the soonest batch is fully held by the first order, so only the later one is left",
  );
  ok("a batch another live order is holding is not reserved twice");

  /* ------------------------ re-running does not count its own reservation */
  const reRun = await autoAllocateTradeOrder(shop.id, second.id);
  const reRunTotal = reRun.items[0].allocations.reduce((sum, row) => sum + Number(row.quantityBaseQty), 0);
  assert.equal(reRunTotal, 80, "re-allocating an order must replace its own hold, not compete with it");
  ok("an order's own open reservation does not block its re-allocation");

  /* ------------------------------------------------------------ packaging */
  const packLot = await lot(rice, "RICE-PACK", day(10), 500, bag.id);
  const wrongPackLot = await lot(rice, "RICE-WRONG", day(5), 500, otherBag.id);
  const packed = await order([{ product: rice, quantityBaseQty: 100, sellingUnitId: bag.id }]);
  const allocatedPacked = await autoAllocateTradeOrder(shop.id, packed.id);
  const usedLots = new Set(allocatedPacked.items[0].allocations.map((row) => row.inventoryLotId));
  assert.ok(usedLots.has(packLot.id), "a line ordered in a pack may take that pack's own batches");
  assert.ok(!usedLots.has(wrongPackLot.id), "a batch tied to a different pack must never be reserved, however soon it expires");
  ok("a line only takes untagged stock or its own packaging's stock");

  /* --------------------------- two lines never double-spend one batch */
  const shared = await order([
    { product: dal, quantityBaseQty: 30 },
    { product: dal, quantityBaseQty: 30 },
  ]);
  const allocatedShared = await autoAllocateTradeOrder(shop.id, shared.id);
  const sharedTotal = allocatedShared.items.flatMap((item) => item.allocations).reduce((sum, row) => sum + Number(row.quantityBaseQty), 0);
  assert.equal(sharedTotal, 40, "two lines on one batch may reserve its stock once between them, not once each");
  ok("two lines competing for one batch share it rather than overdraw it");

  /* ------------------------------------- nothing available is an error */
  const hopeless = await order([{ product: dal, quantityBaseQty: 10 }]);
  await assert.rejects(
    autoAllocateTradeOrder(shop.id, hopeless.id),
    { code: "TRADE_ALLOCATION_STOCK_SHORT" },
    "an order that could reserve nothing at all must say so rather than save an empty allocation",
  );
  ok("an order with no available stock is refused, not silently emptied");

  /* ------------------------------------ a partial reserve is a back-order */
  // Its own product, because every batch created above is by now either held by
  // an earlier order or tied to a packaging this line does not use — which is
  // itself the packaging rule working, but it makes for an unreadable fixture.
  const atta = await db.product.create({ data: { shopId: shop.id, name: "Atta", baseUnit: "kg", rateUnit: "kg", batchTrackingEnabled: true, stockBaseQty: 1000 } });
  await lot(atta, "ATTA-1", day(45), 70);
  const backOrder = await order([{ product: atta, quantityBaseQty: 500 }]);
  const allocatedBack = await autoAllocateTradeOrder(shop.id, backOrder.id);
  const backTotal = allocatedBack.items[0].allocations.reduce((sum, row) => sum + Number(row.quantityBaseQty), 0);
  assert.equal(backTotal, 70, "reserving what exists and leaving the rest owed is a back-order, not a failure");
  assert.equal((await getTradeOrder(shop.id, backOrder.id)).status, "allocated");
  ok("reserving short leaves the rest as a back-order");

  console.log("Trade auto-allocation examples passed");
} finally {
  await db.tradeOrderAllocation.deleteMany({ where: { shopId: shop.id } });
  await db.tradeOrderItem.deleteMany({ where: { shopId: shop.id } });
  await db.tradeOrder.deleteMany({ where: { shopId: shop.id } });
  await db.inventoryLot.deleteMany({ where: { shopId: shop.id } });
  await db.productSellingUnit.deleteMany({ where: { shopId: shop.id } });
  await db.locationStock.deleteMany({ where: { shopId: shop.id } });
  await db.product.deleteMany({ where: { shopId: shop.id } });
  await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
  await db.shop.deleteMany({ where: { id: shop.id } });
}
