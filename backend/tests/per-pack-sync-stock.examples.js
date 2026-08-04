import assert from "node:assert/strict";
import db from "../src/db.js";
import { pushOfflineActions } from "../src/modules/sync/sync.service.js";

// The offline path for per-packaging stock.
//
// A device that has been offline sends a stock movement in BASE units — the shape
// every pooled movement has always used — which cannot say WHICH size moved, and a
// per-pack product refuses any movement it cannot attribute to a size. So the
// outbox states the movement a second time, in the pack's own counts, and the
// server resolves the pack by its CODE: a device may only know a locally generated
// id that means nothing here.
//
// This is the path a real shop actually uses (the app is offline-first), so it is
// worth pinning down separately from the online REST calls.

async function main() {
  const shop = await db.shop.create({ data: { name: `PPS ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  const user = await db.user.create({
    data: { shopId: shop.id, name: "Owner", email: `pps${Date.now()}@test.local`, passwordHash: "x", role: "owner" },
  });
  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Maggi Noodles", category: "instant",
        baseUnit: "g", rateUnit: "packet", displayUnit: "70 g packet",
        stockBaseQty: 0, defaultPricePerRateUnit: 14, costPerRateUnit: 11,
        packagingMode: "per_pack",
      },
    });
    const packet = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "70 g packet", unitType: "packet", unitCode: "pkt70", conversionToBase: 70, defaultPrice: 14, onHandQty: 20, isDefault: true },
    });
    const box = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 5 },
    });

    const actor = { userId: user.id, role: "owner", deviceId: "offline-device-1" };

    // ── stock-in of 12 boxes, sent with a LOCAL selling-unit id ─────
    // The id is what the device made up while offline; only the code is portable.
    const purchase = await pushOfflineActions(shop.id, [{
      clientEventId: `evt-purchase-${shop.id}`,
      type: "STOCK_PURCHASE",
      entityType: "inventory_movement",
      entityId: `local_move_1`,
      payload: {
        movementId: "local_move_1",
        productId: product.id,
        supplierName: "Nestle Distributor",
        quantity: 6720,          // base units: 12 x 560 g
        enteredUnit: "g",
        billAmount: 1056,
        sellingUnitId: "local_su_9f3a",   // meaningless on the server
        sellingUnitCode: "box8",          // the portable key
        sellingUnitQty: 12,
        updateCost: false,
      },
    }], actor);
    assert.equal(String(purchase.results[0].status).toUpperCase(), "SYNCED", `stock-in should sync: ${JSON.stringify(purchase.results[0])}`);

    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 17, "the boxes received land on the box count");
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: packet.id } })).onHandQty, 20, "the packet count is untouched");
    assert.equal((await db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 6720, "base units come from the pack's own conversion");

    // ── the same event replayed changes nothing ────────────────────
    const replay = await pushOfflineActions(shop.id, [{
      clientEventId: `evt-purchase-${shop.id}`,
      type: "STOCK_PURCHASE",
      entityType: "inventory_movement",
      entityId: `local_move_1`,
      payload: {
        movementId: "local_move_1", productId: product.id, supplierName: "Nestle Distributor",
        quantity: 6720, enteredUnit: "g", billAmount: 1056,
        sellingUnitId: "local_su_9f3a", sellingUnitCode: "box8", sellingUnitQty: 12, updateCost: false,
      },
    }], actor);
    assert.ok(["SYNCED", "DUPLICATE"].includes(String(replay.results[0].status).toUpperCase()), `replay status ${replay.results[0].status}`);
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 17, "a replayed receipt must not add the boxes twice");
    assert.equal((await db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 6720);

    // ── manual stock-out of 2 boxes (STOCK_SALE) ───────────────────
    const sale = await pushOfflineActions(shop.id, [{
      clientEventId: `evt-sale-${shop.id}`,
      type: "STOCK_SALE",
      entityType: "inventory_movement",
      entityId: "local_move_2",
      payload: {
        movementId: "local_move_2",
        productId: product.id,
        quantity: 1120,           // base units: 2 x 560 g
        enteredUnit: "g",
        sellingUnitCode: "box8",
        sellingUnitQty: 2,
        note: "Counter stock out",
      },
    }], actor);
    assert.equal(String(sale.results[0].status).toUpperCase(), "SYNCED", `stock-out should sync: ${JSON.stringify(sale.results[0])}`);
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 15, "two boxes leave the box count");
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: packet.id } })).onHandQty, 20, "and nothing else moves");

    // ── a write-off (ADJUST_STOCK / damage) of 1 box ───────────────
    const damage = await pushOfflineActions(shop.id, [{
      clientEventId: `evt-damage-${shop.id}`,
      type: "ADJUST_STOCK",
      entityType: "inventory_movement",
      entityId: "local_move_3",
      payload: {
        movementId: "local_move_3",
        adjustmentType: "damage",
        productId: product.id,
        quantity: 560,
        enteredUnit: "g",
        sellingUnitCode: "box8",
        sellingUnitQty: 1,
        reason: "Crushed in transit",
        note: "Crushed in transit",
        ownerPin: null,
      },
    }], { ...actor, ownerPinVerified: true });
    // Damage requires an owner PIN through sync; either it applied or it was
    // refused for the PIN — never for the packaging.
    const damageStatus = String(damage.results[0].status).toUpperCase();
    if (damageStatus === "SYNCED") {
      assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 14, "the damaged box leaves the box count");
    } else {
      assert.doesNotMatch(
        JSON.stringify(damage.results[0]),
        /PACKAGING_STOCK_PATH_UNSUPPORTED/,
        "a write-off naming its pack must never be refused as unattributable",
      );
    }

    // ── pooled goods still sync on base units alone ────────────────
    const rice = await db.product.create({
      data: { shopId: shop.id, name: "Loose Rice", category: "staples", baseUnit: "g", rateUnit: "kg", displayUnit: "kg", stockBaseQty: 0, defaultPricePerRateUnit: 58, costPerRateUnit: 46 },
    });
    const pooled = await pushOfflineActions(shop.id, [{
      clientEventId: `evt-rice-${shop.id}`,
      type: "STOCK_PURCHASE",
      entityType: "inventory_movement",
      entityId: "local_move_4",
      payload: {
        movementId: "local_move_4", productId: rice.id, supplierName: "Mandi",
        quantity: 25000, enteredUnit: "g", billAmount: 1150, updateCost: false,
        // A pooled device still sends the unit it displayed in, with NO pack count.
        sellingUnitCode: "kg",
      },
    }], actor);
    assert.equal(String(pooled.results[0].status).toUpperCase(), "SYNCED");
    assert.equal((await db.product.findUnique({ where: { id: rice.id } })).stockBaseQty, 25000, "a pooled receipt must not be re-derived through a pack conversion");

    console.log("per-pack-sync-stock.examples.js OK");
  } finally {
    // Pushing sync events leaves its own trail (SyncIdMapping -> OfflineSyncEvent),
    // and a shop that still has ANY child row cannot be deleted — a test that
    // leaves rows behind slowly fills the shared dev database.
    for (const remove of [
      () => db.syncIdMapping.deleteMany({ where: { shopId: shop.id } }),
      () => db.offlineSyncEvent.deleteMany({ where: { shopId: shop.id } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.purchaseHistory.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.session.deleteMany({ where: { shopId: shop.id } }),
      () => db.device.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.user.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await Promise.resolve(remove()).catch(() => {});
    }
  }
}

await main();
