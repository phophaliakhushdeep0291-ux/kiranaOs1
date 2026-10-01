import assert from "node:assert/strict";
import db from "../src/db.js";
import { confirmBill } from "../src/modules/bills/bills.service.js";
import { buildTallyExport } from "../src/modules/integrations/integrations.service.js";
import * as production from "../src/verticals/manufacturing/manufacturing.service.js";

// The Tally stock journal valued a packaged material at its cost per pack times
// its quantity in millilitres.
//
// Each consumption in a production run is exported at the material's cost: base
// quantity converted into the RATE unit, times cost per rate unit. The conversion
// went through the unit table inside a try/catch whose fallback was "use the base
// quantity" — so for a material quoted per pouch, 4 litres of oil (4 pouches at
// ₹150) went to the books as 4000 × ₹150 = ₹6,00,000, and the finished goods
// that inherit that cost with it. Not a throw: a figure off by the pack size,
// posted into someone's accounts.
//
// The sale voucher's line quantity sits behind the same kind of try/catch, but it
// is NOT affected, and the second half of this file pins that down: a packaged
// sale always carries its packaging, so the line's own rate unit is the pack's
// name, the table refuses it, and the fallback — the quantity the cashier entered,
// counted in packs — is already the right one.

/** The AMOUNT on a stock item's inventory entry, from the first voucher that has one. */
function inventoryAmount(xml, itemName) {
  const pattern = new RegExp(`<ALLINVENTORYENTRIES\\.LIST><STOCKITEMNAME>${itemName}</STOCKITEMNAME>.*?<AMOUNT>(-?[\\d.]+)</AMOUNT>`);
  const match = xml.match(pattern);
  assert.ok(match, `${itemName} has an inventory entry in the export`);
  return Number(match[1]);
}

function inventoryQuantity(xml, itemName) {
  const pattern = new RegExp(`<ALLINVENTORYENTRIES\\.LIST><STOCKITEMNAME>${itemName}</STOCKITEMNAME>.*?<ACTUALQTY>([^<]*)</ACTUALQTY>`);
  const match = xml.match(pattern);
  assert.ok(match, `${itemName} has an inventory entry in the export`);
  return match[1];
}

/**
 * A completed run, written the way completeRun leaves it. Built directly so this
 * file is about the export alone and not about completing a run.
 */
async function completedRun(shopId, finished, runNumber, consumptions, outputBaseQty) {
  const bom = await production.createBom(shopId, {
    finishedProductId: finished.id, name: runNumber, outputQuantityBaseQty: outputBaseQty,
    items: consumptions.map(({ product, baseQty }) => ({ materialProductId: product.id, quantityBaseQty: baseQty, wastagePercent: 0 })),
  });
  const run = await production.createRun(shopId, { bomId: bom.id, runNumber, plannedOutputBaseQty: outputBaseQty });
  for (const { product, baseQty } of consumptions) {
    await db.productionConsumption.create({ data: { shopId, runId: run.id, productId: product.id, plannedBaseQty: baseQty, actualBaseQty: baseQty } });
  }
  await db.productionOutput.create({ data: { shopId, runId: run.id, productId: finished.id, quantityBaseQty: outputBaseQty, batchNumber: `${runNumber}-FG` } });
  await db.productionRun.update({
    where: { id: run.id },
    data: { status: "completed", qcStatus: "passed", actualOutputBaseQty: outputBaseQty, finishedBatchNumber: `${runNumber}-FG`, manufacturedOn: new Date(), completedAt: new Date() },
  });
}

async function main() {
  const shop = await db.shop.create({ data: { name: `TXP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const sugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Sugar", category: "raw_material",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 10000, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    const masala = await db.product.create({
      data: {
        shopId: shop.id, name: "Masala Mix", category: "finished_goods",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 300, costPerRateUnit: 0,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });

    // ── a loose material: kg ─────────────────────────────────────────
    // Exported before any packaged material exists, so this assertion reads the
    // same against the code before and after the fix.
    await completedRun(shop.id, masala, "LOOSE-1", [{ product: sugar, baseQty: 2000 }], 2000);
    const looseOnly = await buildTallyExport(shop.id, { include: ["production"] });
    assert.equal(inventoryAmount(looseOnly.xml, "Sugar"), -80, "2 kg of sugar consumed at ₹40/kg is ₹80");

    // ── a packaged material: pouches of oil ──────────────────────────
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
    const fried = await db.product.create({
      data: {
        shopId: shop.id, name: "Fried Namkeen", category: "finished_goods",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 400, costPerRateUnit: 0,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });
    await completedRun(shop.id, fried, "PACK-1", [{ product: oil, baseQty: 4000 }], 2000);

    const both = await buildTallyExport(shop.id, { include: ["production"] });
    // 4000 ml is 4 pouches at ₹150: ₹600, not 4000 × ₹150.
    assert.equal(inventoryAmount(both.xml, "Refined Oil 1 L pouch"), -600, "4 pouches of oil consumed at ₹150 is ₹600");
    assert.equal(inventoryAmount(both.xml, "Fried Namkeen"), 600, "the finished goods carry exactly the material cost in");
    assert.equal(inventoryAmount(both.xml, "Sugar"), -80, "the loose material is valued exactly as before alongside it");

    // ── the sale voucher's quantity is already right for a pack ──────
    const sevenUp = await db.product.create({
      data: {
        shopId: shop.id, name: "7Up 750ml", category: "soft drinks",
        baseUnit: "ml", rateUnit: "bottle", displayUnit: "bottle 750 ml",
        stockBaseQty: 9000, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: sevenUp.id, name: "bottle 750 ml",
        unitType: "bottle", unitCode: "bottle-750-ml", packSizeValue: 750, packSizeUnit: "ml",
        conversionToBase: 750, defaultPrice: 45, maximumPrice: 45, costPrice: 40, isDefault: true,
      },
    });
    await confirmBill(shop.id, {
      billType: "normal_sale", customerName: "Walk-in", gstMode: "none",
      items: [
        { productId: sevenUp.id, sellingUnitCode: "bottle-750-ml", name: sevenUp.name, quantity: 2, enteredUnit: "bottle", ratePerRateUnit: 45, gstRate: 0 },
        { productId: sugar.id, name: sugar.name, quantity: 500, enteredUnit: "g", ratePerRateUnit: 45, gstRate: 0 },
      ],
      discount: 0,
      payments: [{ mode: "cash", amount: 112.5 }],
      actualAmount: 112.5, buyerPaidAmount: 112.5, waivedAmount: 0,
      clientBillId: "txp-sale", idempotencyKey: "txp-sale",
    });
    const sales = await buildTallyExport(shop.id, { include: ["sales"], inventory: true });
    assert.equal(inventoryQuantity(sales.xml, "7Up 750ml"), "2 bottle", "two bottles sold go to Tally as two bottles");
    assert.equal(inventoryAmount(sales.xml, "7Up 750ml"), 90, "at ₹45 a bottle");
    assert.equal(inventoryQuantity(sales.xml, "Sugar"), "0.5 kg", "500 g of loose sugar goes as half a kilo");

    console.log("tally-export-pack-rate-unit.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.billItem.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.payment.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.bill.deleteMany({ where: { shopId: shop.id } }),
      () => db.billCounter.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.productionOutput.deleteMany({ where: { shopId: shop.id } }),
      () => db.productionConsumption.deleteMany({ where: { shopId: shop.id } }),
      () => db.productionRun.deleteMany({ where: { shopId: shop.id } }),
      () => db.manufacturingBomItem.deleteMany({ where: { shopId: shop.id } }),
      () => db.manufacturingBom.deleteMany({ where: { shopId: shop.id } }),
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
