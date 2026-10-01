import assert from "node:assert/strict";
import db from "../src/db.js";
import { recordDamage, recordPurchase } from "../src/modules/inventory/inventory.service.js";
import { getInventoryHealth } from "../src/modules/reports/reports.service.js";

// `product.rateUnit` is what the price is quoted per, and for a packaged product the
// catalogue sets it to the pack's own word — "bottle", "pack", "tray". The unit table
// deliberately knows only real units, so any code converting through `rateUnit` throws
// UNSUPPORTED_UNIT for exactly the products a kirana shop sells most.
//
// Found by using the app: buy 12 bottles of 7Up (fine), then write 2 off as damage.
// The till accepted it — stock shown as 12 bottles, owner PIN approved, movement
// written — and sync then failed with
//
//   Unsupported unit "bottle". Supported units: kg, g, gram, ... box
//
// leaving it in sync_conflicts for a human. The damage sync handler builds its
// `damageSchema.parse({...})` object by hand and never forwards `conversionToBase`,
// so the rateUnit fallback was all that was left to compute the loss value.

async function main() {
  const shop = await db.shop.create({ data: { name: `RUP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "7Up 750ml", category: "soft drinks",
        // Exactly what the starter catalogue produces.
        baseUnit: "ml", rateUnit: "bottle", displayUnit: "bottle 750 ml",
        stockBaseQty: 0, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: product.id, name: "bottle 750 ml",
        unitType: "bottle", unitCode: "bottle-750-ml", packSizeValue: 750, packSizeUnit: "ml",
        conversionToBase: 750, defaultPrice: 45, maximumPrice: 45, costPrice: 40,
        onHandQty: 0, isDefault: true,
      },
    });

    // ── stock in: 12 bottles for ₹480 ───────────────────────────────
    // The shape the purchase sync handler actually sends: base quantity, a real
    // base unit, and the pack's conversion so the cost can be priced per bottle.
    await recordPurchase(shop.id, {
      productId: product.id, supplierName: "Agarwal Distributors",
      quantity: 9000, enteredUnit: "ml", conversionToBase: 750,
      billAmount: 480, idempotencyKey: "rup-in",
    });
    const afterIn = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(afterIn.stockBaseQty, 9000, "12 bottles is 9000 ml on the shelf");
    assert.equal(afterIn.costPerRateUnit, 40, "₹480 for 12 bottles is ₹40 a bottle");

    // ── the write-off the app could not sync ────────────────────────
    // This is the payload shape the damage sync handler actually builds: base
    // quantity, a real base unit, and NO conversionToBase. Before the fix this
    // threw UNSUPPORTED_UNIT on `rateUnit`.
    const before = (await db.product.findUnique({ where: { id: product.id } })).stockBaseQty;
    await recordDamage(shop.id, {
      productId: product.id,
      quantity: 1500,          // 2 bottles, in base units
      enteredUnit: "ml",
      note: "2 bottles broken in transit",
    }, { idempotencyKey: "rup-damage", clientMovementId: "rup-damage" });

    const afterDamage = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(afterDamage.stockBaseQty, before - 1500, "2 bottles written off is 1500 ml off the shelf");

    const ledger = await db.stockLedger.findFirst({
      where: { shopId: shop.id, changeBaseQty: -1500 },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(ledger, "the write-off is on the stock ledger");
    // The loss is valued per RATE unit: 2 bottles at ₹40 cost is ₹80. A factor of
    // 1 would have valued 1500 base units at ₹40 each — ₹60,000 of phantom loss
    // straight into the P&L.
    assert.equal(Math.abs(Number(ledger.damageLossValue)), 80, "the loss is 2 bottles at cost, not 1500 of them");

    // ── the closing-stock valuation report ─────────────────────────
    // `getInventoryHealth({ includeCost })` values every active product, so one
    // pack-worded rate unit used to throw and take the WHOLE report down — for
    // every shop that had loaded the starter catalogue. 7500 ml left is 10 bottles:
    // ₹400 at cost, ₹450 at the ₹45 selling price.
    const health = await getInventoryHealth(shop.id, { includeCost: true });
    const softDrinks = health.inventoryValuationByCategory.find((row) => row.category === "soft drinks");
    assert.equal(softDrinks.costValuePaise, 40000, "10 bottles at ₹40 cost is ₹400");
    assert.equal(softDrinks.retailValuePaise, 45000, "10 bottles at ₹45 is ₹450");

    // ── a genuinely loose product still uses the unit table ─────────
    const loose = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 5000, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    await recordDamage(shop.id, {
      productId: loose.id, quantity: 2000, enteredUnit: "g", note: "spoiled",
    }, { idempotencyKey: "rup-damage-loose", clientMovementId: "rup-damage-loose" });
    const looseAfter = await db.product.findUnique({ where: { id: loose.id } });
    assert.equal(looseAfter.stockBaseQty, 3000, "2 kg of loose sugar written off is 2000 g");

    // ── a loose product that ALSO stocks a pack must still price per kg ──
    // Sugar is sold loose by the kg and also stocked in 500 g packets. The rate
    // unit is "kg", a real unit, so the unit table is authoritative: 2 kg written
    // off is 2 kg of loss. Reaching for the default PACK first would divide by 500
    // instead of 1000 and report 4 "units" of loss — double the true figure.
    const sugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 5000, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: sugar.id, name: "500 g packet",
        unitType: "packet", unitCode: "pkt500", packSizeValue: 500, packSizeUnit: "gram",
        conversionToBase: 500, defaultPrice: 23, maximumPrice: 25, costPrice: 20,
        onHandQty: 0, isDefault: true,
      },
    });
    await recordDamage(shop.id, {
      productId: sugar.id, quantity: 2000, enteredUnit: "g", note: "damp",
    }, { idempotencyKey: "rup-damage-sugar", clientMovementId: "rup-damage-sugar" });
    const sugarLedger = await db.stockLedger.findFirst({
      where: { shopId: shop.id, productId: sugar.id, changeBaseQty: -2000 },
    });
    assert.equal(Math.abs(Number(sugarLedger.damageLossValue)), 80, "2 kg of sugar at ₹40/kg is ₹80, not 4 packets' worth");

    console.log("rate-unit-is-a-pack-label.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.billItem.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.payment.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.purchaseHistory.deleteMany({ where: { shopId: shop.id } }),
      () => db.bill.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.billCounter.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.supplier.deleteMany({ where: { shopId: shop.id } }),
      () => db.subscription.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();
