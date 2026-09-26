import assert from "node:assert/strict";
import db from "../src/db.js";
import * as production from "../src/verticals/manufacturing/manufacturing.service.js";

// A production run could not be completed when a material or the finished good
// was packaged.
//
// Completing a run costs the batch: each material's actual base quantity is
// converted into its RATE unit and multiplied by its cost per rate unit, and the
// total is divided by the output converted into the finished good's rate unit.
// Both conversions went through the unit table, which knows only real units. A
// product's rate unit is its default pack's type — the product service copies it
// across — and the manufacturing trade's own unit list offers "pouch", "carton"
// and "pallet", while "jar", "tin" and "bottle" are one tap away. So a run that
// used a pouch of oil, or that made jars of pickle, failed inside the stock
// transaction with
//
//   Unsupported unit "pouch". Supported units: kg, g, gram, ... box
//
// Material cost is per RATE unit (per pouch), so the conversion has to be the
// rate unit's even when the consumption row names some other packaging: a case of
// four pouches is four pouches of cost, not one.

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const shop = await db.shop.create({ data: { name: `PRP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const sugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Sugar", category: "raw_material",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 10000, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });

    // ── a loose run: kg in, kg out ───────────────────────────────────
    // Completed before any packaged product exists, so these assertions read the
    // same against the code before and after the fix.
    const masala = await db.product.create({
      data: {
        shopId: shop.id, name: "Masala Mix", category: "finished_goods",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 300, costPerRateUnit: 0,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });
    const masalaBom = await production.createBom(shop.id, {
      finishedProductId: masala.id, name: "Masala", outputQuantityBaseQty: 2000,
      items: [{ materialProductId: sugar.id, quantityBaseQty: 2000, wastagePercent: 0 }],
    });
    const masalaRun = await production.createRun(shop.id, { bomId: masalaBom.id, runNumber: "LOOSE-1", plannedOutputBaseQty: 2000 });
    await production.completeRun(shop.id, masalaRun.id, {
      actualOutputBaseQty: 2000, finishedBatchNumber: "MASALA-1", manufacturedOn: day(), expiresOn: day(365), qcStatus: "passed",
      consumptions: [{ productId: sugar.id, actualBaseQty: 2000 }],
      outputs: [{ quantityBaseQty: 2000 }],
    });
    const masalaLot = await db.inventoryLot.findFirst({ where: { producedByRunId: masalaRun.id } });
    // 2 kg of sugar at ₹40/kg is ₹80 of material, over 2 kg of output.
    assert.equal(masalaLot.costPerRateUnit, 40, "a loose batch costs ₹40/kg, as before");

    // ── a packaged material in, a packaged good out ──────────────────
    const oil = await db.product.create({
      data: {
        shopId: shop.id, name: "Refined Oil 1 L pouch", category: "raw_material",
        baseUnit: "ml", rateUnit: "pouch", displayUnit: "pouch 1 litre",
        stockBaseQty: 8000, defaultPricePerRateUnit: 160, costPerRateUnit: 150,
        packagingMode: "pooled",
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: oil.id, name: "pouch 1 litre",
        unitType: "pouch", unitCode: "pouch-1-litre", packSizeValue: 1, packSizeUnit: "litre",
        conversionToBase: 1000, defaultPrice: 160, costPrice: 150, isDefault: true,
      },
    });
    const oilCase = await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: oil.id, name: "case of 4 pouches",
        unitType: "case", unitCode: "case-4-pouch", packSizeValue: 4, packSizeUnit: "pouch",
        conversionToBase: 4000, defaultPrice: 640, costPrice: 600, isDefault: false,
      },
    });
    const pickle = await db.product.create({
      data: {
        shopId: shop.id, name: "Mango Pickle 500 g jar", category: "finished_goods",
        baseUnit: "gram", rateUnit: "jar", displayUnit: "jar 500 gram",
        stockBaseQty: 0, defaultPricePerRateUnit: 120, costPerRateUnit: 0,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: pickle.id, name: "jar 500 gram",
        unitType: "jar", unitCode: "jar-500-gram", packSizeValue: 500, packSizeUnit: "gram",
        conversionToBase: 500, defaultPrice: 120, isDefault: true,
      },
    });
    const pickleBom = await production.createBom(shop.id, {
      finishedProductId: pickle.id, name: "Pickle", outputQuantityBaseQty: 5000,
      items: [
        { materialProductId: oil.id, quantityBaseQty: 4000, wastagePercent: 0 },
        { materialProductId: sugar.id, quantityBaseQty: 1000, wastagePercent: 0 },
      ],
    });
    const pickleRun = await production.createRun(shop.id, { bomId: pickleBom.id, runNumber: "PACK-1", plannedOutputBaseQty: 5000 });
    await production.completeRun(shop.id, pickleRun.id, {
      actualOutputBaseQty: 5000, finishedBatchNumber: "PICKLE-1", manufacturedOn: day(), expiresOn: day(365), qcStatus: "passed",
      consumptions: [
        // Drawn as one case: 4000 ml, which is FOUR pouches of cost.
        { productId: oil.id, sellingUnitId: oilCase.id, packageCount: 1, actualBaseQty: 4000 },
        { productId: sugar.id, actualBaseQty: 1000 },
      ],
      outputs: [{ quantityBaseQty: 5000 }],
    });

    const pickleLot = await db.inventoryLot.findFirst({ where: { producedByRunId: pickleRun.id } });
    // 4 pouches at ₹150 plus 1 kg of sugar at ₹40 is ₹640 of material, and
    // 5000 g of pickle is 10 jars: ₹64 a jar. Valuing the case as a single pouch
    // would say ₹19; dividing by grams instead of jars, ₹0.13.
    assert.equal(pickleLot.costPerRateUnit, 64, "a jar of pickle cost ₹64 to make");
    assert.equal(Number(pickleLot.costPerRateUnitPaise), 6400, "the paise shadow follows the float");
    assert.equal((await db.product.findUnique({ where: { id: oil.id } })).stockBaseQty, 4000, "one case left the oil stock");
    assert.equal((await db.product.findUnique({ where: { id: pickle.id } })).stockBaseQty, 5000, "10 jars entered stock");

    console.log("production-run-pack-rate-unit.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.productionOutput.deleteMany({ where: { shopId: shop.id } }),
      () => db.productionConsumption.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.productionRun.deleteMany({ where: { shopId: shop.id } }),
      () => db.manufacturingBomItem.deleteMany({ where: { shopId: shop.id } }),
      () => db.manufacturingBom.deleteMany({ where: { shopId: shop.id } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
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
