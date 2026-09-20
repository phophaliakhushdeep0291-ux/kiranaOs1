import assert from "node:assert/strict";
import db from "../src/db.js";
import { confirmBill } from "../src/modules/bills/bills.service.js";
import { recordPurchase } from "../src/modules/inventory/inventory.service.js";
import { purchaseSchema } from "../src/modules/inventory/inventory.schema.js";
import { backfillDefaultPackCost } from "../scripts/backfill-default-pack-cost.js";

// What a bill says a sale COST, once the shop has bought stock of its own.
//
// Gross profit on every bill was computed from a stale cost basis. The reported
// case, reproduced here exactly: `Loose Toor Dal (per kg)` arrives from the starter
// catalogue at cost 137.95 and price 155; the shop takes in 50 kg at 120/kg; one kg
// sells at 155. The profit should be 35.00 and was recorded as 17.05.
//
// Two numbers were involved. A purchase recomputes the weighted average on
// `Product.costPerRateUnit` — that became 120, correctly — but wrote nothing to the
// default `ProductSellingUnit.costPrice`, which kept the catalogue's 137.95; and
// sellingUnitCostPrice preferred the pack row whenever it held anything at all. So
// COGS was priced off the catalogue forever, on every product a shop ever restocks.
// Revenue, cash, stock and the ledger were all right; only cost and profit were not.
//
// Runs against the real database because the bug lived in the gap between two
// writes: nothing about either function in isolation was wrong, and a test with the
// rows stubbed would have kept passing throughout.

const SEEDED_COST = 137.95;   // what the starter catalogue says
const PURCHASE_COST = 120;    // what the shop actually paid
const SELLING_PRICE = 155;

async function main() {
  const shop = await db.shop.create({ data: { name: `COGS ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    // A loose kilo item as the starter catalogue loads it: cost and MRP on the
    // product, mirrored onto the one default selling unit (see legacySellingUnit).
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Toor Dal (per kg)", category: "Loose Dal",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, isLooseItem: true,
        defaultPricePerRateUnit: SELLING_PRICE, mrp: SELLING_PRICE, costPerRateUnit: SEEDED_COST,
      },
    });
    const kg = await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: product.id, name: "kg", unitType: "kg", unitCode: "kg",
        conversionToBase: 1000, defaultPrice: SELLING_PRICE, maximumPrice: SELLING_PRICE,
        costPrice: SEEDED_COST, isDefault: true, isActive: true,
      },
    });
    // A second packaging, priced by hand. It exists to prove the fix does not reach
    // further than it should: a bulk bag bought at better than the multiple is a
    // fact about a real purchase, and no weighted average may overwrite it.
    const bag = await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: product.id, name: "bag 5 kg", unitType: "bag", unitCode: "bag5",
        packSizeValue: 5, packSizeUnit: "kg", conversionToBase: 5000,
        defaultPrice: 740, maximumPrice: 775, costPrice: 570, isActive: true,
      },
    });

    // ── take in 50 kg at 120/kg ─────────────────────────────────────
    // Through the schema, as the controller and the offline replay both do: it is
    // what supplies updateCost, and recording a purchase without recomputing the
    // average cost is not the path a shopkeeper takes.
    await recordPurchase(shop.id, purchaseSchema.parse({
      productId: product.id, supplierName: "Mandi",
      quantity: 50, enteredUnit: "kg", billAmount: 50 * PURCHASE_COST,
      idempotencyKey: "cogs-stock-in-1",
    }));

    const afterPurchase = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(afterPurchase.stockBaseQty, 50000, "50 kg of a gram-based product is 50000 base units");
    assert.equal(afterPurchase.costPerRateUnit, PURCHASE_COST, "the weighted average is what the shop paid");

    // The default pack's copy of that figure has to move with it. This is the write
    // that was missing, and the whole reason billing read a catalogue price.
    const kgAfterPurchase = await db.productSellingUnit.findUnique({ where: { id: kg.id } });
    assert.equal(kgAfterPurchase.costPrice, PURCHASE_COST, "the default pack follows the product's cost");
    assert.equal(
      kgAfterPurchase.costPricePaise, BigInt(PURCHASE_COST * 100),
      "and so does its paise shadow, or the money-integrity rules see two different costs",
    );

    const bagAfterPurchase = await db.productSellingUnit.findUnique({ where: { id: bag.id } });
    assert.equal(bagAfterPurchase.costPrice, 570, "an alternate pack's hand-typed cost is never overwritten");

    // ── sell 1 kg at 155 ────────────────────────────────────────────
    // No sellingUnitId, which is the ordinary counter line: billing resolves the
    // product's default pack itself.
    const bill = await confirmBill(shop.id, {
      billType: "normal_sale",
      customerName: "Walk-in",
      items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "kg", ratePerRateUnit: SELLING_PRICE, gstRate: 0 }],
      discount: 0,
      payments: [{ mode: "cash", amount: SELLING_PRICE }],
      actualAmount: SELLING_PRICE,
      buyerPaidAmount: SELLING_PRICE,
      waivedAmount: 0,
      clientBillId: "cogs-bill-1",
      idempotencyKey: "cogs-bill-1",
    });

    const line = await db.billItem.findFirst({ where: { billId: bill.id, productId: product.id } });
    assert.equal(line.costPerRateUnit, PURCHASE_COST, "the line is costed at what the shop paid, not the catalogue");
    assert.equal(line.lineCost, PURCHASE_COST, "one kilo at 120");
    assert.equal(line.lineProfit, 35, "155 - 120 = 35.00, the figure that was being recorded as 17.05");

    const storedBill = await db.bill.findUnique({ where: { id: bill.id } });
    assert.equal(storedBill.grossProfit, 35, "the bill's own profit, and the owner dashboard's margin tile with it");
    assert.equal(storedBill.grandTotal, SELLING_PRICE, "revenue was never the thing that was wrong");

    // ── a row already stale in the database still bills correctly ───
    // Every shop that has billed anything has these rows. The reader must not need
    // the backfill to have run, so put the catalogue price back by hand — exactly
    // the state a pre-fix database is in — and sell again.
    await db.productSellingUnit.update({
      where: { id: kg.id },
      data: { costPrice: SEEDED_COST, costPricePaise: BigInt(Math.round(SEEDED_COST * 100)) },
    });
    const secondBill = await confirmBill(shop.id, {
      billType: "normal_sale",
      customerName: "Walk-in",
      items: [{ productId: product.id, name: product.name, quantity: 2, enteredUnit: "kg", ratePerRateUnit: SELLING_PRICE, gstRate: 0 }],
      discount: 0,
      payments: [{ mode: "cash", amount: 2 * SELLING_PRICE }],
      actualAmount: 2 * SELLING_PRICE,
      buyerPaidAmount: 2 * SELLING_PRICE,
      waivedAmount: 0,
      clientBillId: "cogs-bill-2",
      idempotencyKey: "cogs-bill-2",
    });
    const staleLine = await db.billItem.findFirst({ where: { billId: secondBill.id, productId: product.id } });
    assert.equal(staleLine.costPerRateUnit, PURCHASE_COST, "a stale pack row loses to the product's weighted average");
    assert.equal(staleLine.lineProfit, 70, "two kilos at 35 each");

    // ── and the alternate pack keeps costing what it says ───────────
    // The default pack deferring to the product must not turn into every pack
    // deferring to it: a 5 kg bag bought at 570 costs 570, not 600.
    const bagBill = await confirmBill(shop.id, {
      billType: "normal_sale",
      customerName: "Walk-in",
      items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "bag", sellingUnitId: bag.id, ratePerRateUnit: 740, gstRate: 0 }],
      discount: 0,
      payments: [{ mode: "cash", amount: 740 }],
      actualAmount: 740,
      buyerPaidAmount: 740,
      waivedAmount: 0,
      clientBillId: "cogs-bill-3",
      idempotencyKey: "cogs-bill-3",
    });
    const bagLine = await db.billItem.findFirst({ where: { billId: bagBill.id, productId: product.id } });
    assert.equal(bagLine.costPerRateUnit, 570, "the bag's own cost, which is better than 5 x 120 and deliberately so");
    assert.equal(bagLine.lineProfit, 170, "740 - 570");

    // ── the backfill repairs the rows already in the database ───────
    // Billing does not need it, but everything that reads the row directly does: the
    // per-pack inventory rows, the pricing preview, the product form the shopkeeper
    // opens, and touchProductFromDefaultUnit — which copies the default unit back ONTO
    // the product, so a pass-through save of a stale row would push the catalogue
    // price over the correct weighted average. The row is still stale from the section
    // above, which is the state every existing shop is in.
    assert.equal(
      (await db.productSellingUnit.findUnique({ where: { id: kg.id } })).costPrice,
      SEEDED_COST,
      "precondition: the row under repair is the stale one",
    );

    const dry = await backfillDefaultPackCost({ shopId: shop.id, dryRun: true });
    assert.equal(dry.corrected, 1, "a dry run reports the one row that disagrees");
    assert.equal(
      (await db.productSellingUnit.findUnique({ where: { id: kg.id } })).costPrice,
      SEEDED_COST,
      "and writes nothing",
    );

    const applied = await backfillDefaultPackCost({ shopId: shop.id });
    assert.equal(applied.corrected, 1);
    const repaired = await db.productSellingUnit.findUnique({ where: { id: kg.id } });
    assert.equal(repaired.costPrice, PURCHASE_COST, "the default pack now agrees with the product");
    assert.equal(repaired.costPricePaise, BigInt(PURCHASE_COST * 100), "shadow column included");
    assert.equal(
      (await db.productSellingUnit.findUnique({ where: { id: bag.id } })).costPrice,
      570,
      "and the alternate pack is left exactly as the shopkeeper typed it",
    );

    // Idempotent, so operators can run it again without wondering.
    const second = await backfillDefaultPackCost({ shopId: shop.id });
    assert.equal(second.corrected, 0, "nothing left to correct");
    assert.equal(second.alreadyInStep, 1, "and the default row is counted as already in step");

    console.log("bill-cost-basis.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.billItem.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.payment.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.journalLine.deleteMany({ where: { shopId: shop.id } }),
      () => db.journalEntry.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.chartOfAccount.deleteMany({ where: { shopId: shop.id } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.purchaseHistory.deleteMany({ where: { shopId: shop.id } }),
      () => db.bill.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.billCounter.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
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
