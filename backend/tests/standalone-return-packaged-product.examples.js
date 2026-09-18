import assert from "node:assert/strict";
import db from "../src/db.js";
import { createSaleReturn } from "../src/modules/bills/bills.service.js";
import { recordPurchase } from "../src/modules/inventory/inventory.service.js";

// A standalone return of a PACKAGED product was refused by the server after the
// till had already told the shopkeeper it worked.
//
// Found by using the app: Returns → New Return → 7Up 750ml → refund ₹45 cash. The
// screen said "Return recorded. Stock and reports updated", and the operation then
// failed in sync with:
//
//   Unsupported unit "bottle 750 ml". Supported units: kg, g, gram, ... box
//
// The catalogue's own label for a pack is what the till sends as `enteredUnit`, and
// the standalone branch was the only one that fed it to the unit table, which
// deliberately refuses anything it does not know. A sale of the same product is
// fine, because the sale path resolves the pack and multiplies by conversionToBase.
//
// The starter catalogue is almost entirely pack-labelled, so this was very nearly
// every standalone return a new shop could attempt.

async function main() {
  const shop = await db.shop.create({ data: { name: `SRP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "7Up 750ml", category: "soft drinks",
        // The shape the starter catalogue produces: a base unit the unit table
        // knows, and a rate/display unit that is a human pack label.
        baseUnit: "ml", rateUnit: "bottle", displayUnit: "bottle 750 ml",
        stockBaseQty: 0, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    const bottle = await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: product.id, name: "bottle 750 ml",
        unitType: "bottle", unitCode: "btl750", packSizeValue: 750, packSizeUnit: "ml",
        conversionToBase: 750, defaultPrice: 45, maximumPrice: 45, costPrice: 40,
        onHandQty: 0, isDefault: true,
      },
    });

    // Two bottles on the shelf = 1500 ml of base stock.
    await recordPurchase(shop.id, {
      productId: product.id, supplierName: "D", quantity: 2, enteredUnit: "piece",
      sellingUnitId: bottle.id, conversionToBase: 750, billAmount: 80, idempotencyKey: "srp-in",
    });
    const afterPurchase = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(afterPurchase.stockBaseQty, 1500, "2 bottles is 1500 ml of base stock");

    // ── the return the app could not make ───────────────────────────
    // `enteredUnit` is the pack label, exactly as the till sends it, and there is
    // no original bill: this is a standalone return.
    const returnBill = await createSaleReturn(shop.id, {
      refundMode: "cash",
      gstMode: "inclusive",
      customerName: "Walk-in",
      items: [{
        productId: product.id,
        name: product.name,
        quantity: 1,
        enteredUnit: "bottle 750 ml",
        ratePerRateUnit: 45,
        gstRate: 0,
        lineDiscount: 0,
        damaged: false,
      }],
      clientBillId: "srp-return-1",
      idempotencyKey: "srp-return-1",
    }, { userId: null, deviceId: null });

    assert.equal(returnBill.grandTotal, -45, "a one-bottle refund is ₹45 back to the customer");

    // The whole point of the pack: one bottle back is 750 ml back, not 1 ml.
    const afterReturn = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(afterReturn.stockBaseQty, 2250, "one bottle returned restocks 750 ml");

    const line = (await db.billItem.findMany({ where: { billId: returnBill.id } }))[0];
    assert.equal(Math.abs(line.quantityInBaseUnit), 750, "the line records 750 ml, not 1");
    assert.equal(Math.abs(line.quantity), 1, "the shopkeeper returned one bottle");

    // ── a loose product still converts through its bare unit ────────
    const loose = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    const looseReturn = await createSaleReturn(shop.id, {
      refundMode: "cash",
      gstMode: "inclusive",
      customerName: "Walk-in",
      items: [{
        productId: loose.id, name: loose.name, quantity: 2, enteredUnit: "kg",
        ratePerRateUnit: 45, gstRate: 0, lineDiscount: 0, damaged: false,
      }],
      clientBillId: "srp-return-loose",
      idempotencyKey: "srp-return-loose",
    }, { userId: null, deviceId: null });
    assert.equal(looseReturn.grandTotal, -90, "2 kg at ₹45 refunds ₹90");
    const looseAfter = await db.product.findUnique({ where: { id: loose.id } });
    assert.equal(looseAfter.stockBaseQty, 2000, "2 kg returned is 2000 g restocked");

    console.log("standalone-return-packaged-product.examples.js OK");
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
