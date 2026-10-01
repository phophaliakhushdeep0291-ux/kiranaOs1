import assert from "node:assert/strict";
import db from "../src/db.js";
import { rateUnitFactor, rateUnitFactorsFor } from "../src/modules/inventory/rate-unit-factor.js";
import { recordDamage, recordPurchase } from "../src/modules/inventory/inventory.service.js";
import { getInventoryHealth } from "../src/modules/reports/reports.service.js";

// The factor is the size of the product's RATE unit — the unit its cost and price
// are quoted per — and nothing else.
//
// Two ways the helper got that wrong, both confirmed on real service calls:
//
// 1. "packet" is in the unit table, as a count of 1, so it was trusted as a real
//    unit. But the table has no idea of dimension: over a base unit of grams it
//    says a packet is 1 g. The starter catalogue makes 395 of its 560 products
//    exactly that shape ("Aashirvaad Atta 5kg": unit packet, pack 5 kg), so ten
//    packets were valued at ₹1,59,80,000 and one torn packet written off as
//    ₹15,98,000 of loss.
//
// 2. The packaging a movement NAMED outranked the rate unit. It only says how
//    much moved; cost is still per bottle. Writing off a crate of 24 bottles by
//    naming the crate booked one bottle of loss, and receiving crates — the stock-
//    in screen sends the selected pack's conversion — priced a crate as if it
//    were a bottle, raising the product's cost per bottle 24-fold.

async function main() {
  const shop = await db.shop.create({ data: { name: `RFP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const pack = (product, data) => db.productSellingUnit.create({ data: { shopId: shop.id, productId: product.id, ...data } });
    const lastLoss = async (product) => Math.abs(Number((await db.stockLedger.findFirst({
      where: { shopId: shop.id, productId: product.id, action: "damage" },
      orderBy: { createdAt: "desc" },
    })).damageLossValue));

    // ── a loose product: kg is a real measure over grams ─────────────
    // First and on its own, so it reads the same before and after the change.
    const looseSugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 5000, defaultPricePerRateUnit: 45, costPerRateUnit: 40, packagingMode: "pooled",
      },
    });
    assert.equal(await rateUnitFactor(db, shop.id, looseSugar), 1000, "a kilo is 1000 g");
    await recordDamage(shop.id, { productId: looseSugar.id, quantity: 2000, enteredUnit: "g", note: "spoiled" },
      { idempotencyKey: "rfp-loose", clientMovementId: "rfp-loose" });
    assert.equal(await lastLoss(looseSugar), 80, "2 kg of sugar at ₹40/kg is ₹80");

    // ── 1. a packet over grams is sized by its pack, not the table ────
    // Exactly what the starter catalogue loads for "Aashirvaad Atta 5kg".
    const atta = await db.product.create({
      data: {
        shopId: shop.id, name: "Aashirvaad Atta 5kg", category: "atta",
        baseUnit: "gram", rateUnit: "packet", displayUnit: "packet 5 kg",
        stockBaseQty: 50000, defaultPricePerRateUnit: 340, costPerRateUnit: 319.6, packagingMode: "pooled",
      },
    });
    await pack(atta, {
      name: "packet 5 kg", unitType: "packet", unitCode: "packet-5-kg", packSizeValue: 5, packSizeUnit: "kg",
      conversionToBase: 5000, defaultPrice: 340, costPrice: 319.6, isDefault: true,
    });
    assert.equal(await rateUnitFactor(db, shop.id, atta), 5000, "one packet is 5000 g");
    assert.equal((await rateUnitFactorsFor(db, shop.id, [atta])).get(atta.id), 5000, "the batch form agrees");

    const health = await getInventoryHealth(shop.id, { includeCost: true });
    const attaRow = health.inventoryValuationByCategory.find((row) => row.category === "atta");
    assert.equal(attaRow.costValuePaise, 319600, "10 packets at ₹319.60 are worth ₹3,196 at cost, not ₹1.6 crore");

    await recordDamage(shop.id, { productId: atta.id, quantity: 5000, enteredUnit: "gram", note: "torn" },
      { idempotencyKey: "rfp-atta", clientMovementId: "rfp-atta" });
    assert.equal(await lastLoss(atta), 319.6, "one torn packet is ₹319.60 of loss");

    // ── 2. the named packaging sets the quantity, never the factor ────
    const sevenUp = await db.product.create({
      data: {
        shopId: shop.id, name: "7Up 750ml", category: "soft drinks",
        baseUnit: "ml", rateUnit: "bottle", displayUnit: "bottle 750 ml",
        stockBaseQty: 36000, defaultPricePerRateUnit: 45, costPerRateUnit: 40, packagingMode: "pooled",
      },
    });
    await pack(sevenUp, {
      name: "bottle 750 ml", unitType: "bottle", unitCode: "bottle-750-ml", packSizeValue: 750, packSizeUnit: "ml",
      conversionToBase: 750, defaultPrice: 45, costPrice: 40, isDefault: true,
    });
    const crate = await pack(sevenUp, {
      name: "crate of 24", unitType: "crate", unitCode: "crate-24", packSizeValue: 24, packSizeUnit: "bottle",
      conversionToBase: 18000, defaultPrice: 1080, costPrice: 960, isDefault: false,
    });
    assert.equal(await rateUnitFactor(db, shop.id, sevenUp, { conversionToBase: 18000 }), 750, "sending the crate's conversion does not make a bottle 18 L");

    await recordDamage(shop.id, { productId: sevenUp.id, sellingUnitId: crate.id, quantity: 1, enteredUnit: "crate", note: "crate dropped" },
      { idempotencyKey: "rfp-crate", clientMovementId: "rfp-crate" });
    assert.equal(await lastLoss(sevenUp), 960, "a crate of 24 bottles at ₹40 is ₹960 of loss");

    // Receiving two crates for ₹1,920, in the shape the stock-in screen sends:
    // base quantity, a real base unit, and the SELECTED pack's conversion.
    await recordPurchase(shop.id, {
      productId: sevenUp.id, supplierName: "Agarwal Distributors",
      quantity: 36000, enteredUnit: "ml", conversionToBase: 18000,
      billAmount: 1920, updateCost: true, idempotencyKey: "rfp-crate-in",
    });
    const purchase = await db.stockLedger.findFirst({ where: { shopId: shop.id, productId: sevenUp.id, action: "purchase" } });
    assert.equal(Number(purchase.calculatedBuyRate), 40, "two crates for ₹1,920 is ₹40 a bottle");
    assert.equal((await db.product.findUnique({ where: { id: sevenUp.id } })).costPerRateUnit, 40, "the cost per bottle is still ₹40, not ₹960");

    // A loose product that also stocks a pack: naming the 500 g packet moves 2 kg
    // when four of them go, and 2 kg is still ₹80 — the kilo is the rate unit.
    const sugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 5000, defaultPricePerRateUnit: 45, costPerRateUnit: 40, packagingMode: "pooled",
      },
    });
    const packet = await pack(sugar, {
      name: "500 g packet", unitType: "packet", unitCode: "pkt500", packSizeValue: 500, packSizeUnit: "gram",
      conversionToBase: 500, defaultPrice: 23, maximumPrice: 25, costPrice: 20, isDefault: true,
    });
    await recordDamage(shop.id, { productId: sugar.id, sellingUnitId: packet.id, quantity: 4, enteredUnit: "packet", note: "damp" },
      { idempotencyKey: "rfp-sugar", clientMovementId: "rfp-sugar" });
    assert.equal(await lastLoss(sugar), 80, "four 500 g packets of sugar at ₹40/kg is ₹80, not ₹160");

    console.log("rate-unit-factor-precedence.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.purchaseHistory.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.supplier.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.subscription.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();
