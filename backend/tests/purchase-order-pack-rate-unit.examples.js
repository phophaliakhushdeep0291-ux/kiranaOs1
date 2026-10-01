import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  createPurchaseOrder,
  receivePurchaseOrder,
  sendPurchaseOrder,
} from "../src/modules/purchase-orders/purchaseOrders.service.js";

// A purchase order could not be raised for a packaged product.
//
// `product.rateUnit` holds the pack's own word for a packaged product — the
// starter catalogue gives 7Up a rateUnit of "bottle" — and every purchase-order
// step valued its lines through `rateUnitToBase(rateUnit, baseUnit)`, which the
// unit table refuses for anything that is not a real unit:
//
//   Unsupported unit "bottle". Supported units: kg, g, gram, ... box
//
// The per-pack guard at the top of createPurchaseOrder only catches per_pack
// products; 7Up is pooled, so it fell straight through to the throw. That made
// the Purchases screen's reorder suggestions unusable for most of the catalogue.

async function main() {
  const shop = await db.shop.create({ data: { name: `POP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "7Up 750ml", category: "soft drinks",
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

    // ── raise: 24 bottles (18,000 ml) expected at ₹40 a bottle ──────
    const order = await createPurchaseOrder(shop.id, {
      supplierName: "Agarwal Distributors",
      items: [{ productId: product.id, orderedBaseQty: 18000, expectedRate: 40 }],
    });
    // expectedRate is per bottle, orderedBaseQty is ml: 18000 / 750 = 24 bottles.
    assert.equal(Number(order.expectedTotal), 960, "24 bottles at ₹40 is ₹960");

    // ── receive the full order at the agreed rate ───────────────────
    await sendPurchaseOrder(shop.id, order.id);
    const line = (await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: order.id } }))[0];
    // Received on full credit, as a kirana shop usually does with a distributor.
    const receipt = await receivePurchaseOrder(shop.id, order.id, {
      paidAmount: 0,
      items: [{ purchaseOrderItemId: line.id, quantityBaseQty: 18000, actualRate: 40 }],
    });
    // The receive step values its lines through the same factor: 24 bottles at ₹40.
    const receiptRow = await db.purchaseReceipt.findFirst({ where: { shopId: shop.id, purchaseOrderId: order.id } });
    assert.equal(Number(receiptRow.totalAmount), 960, "the receipt is 24 bottles at ₹40, not 18,000 of them");
    assert.equal(Number(receiptRow.dueAmount), 960, "all of it on credit");
    void receipt;
    const afterReceive = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(afterReceive.stockBaseQty, 18000, "24 bottles received is 18,000 ml on the shelf");

    // ── a loose product with a real rate unit is unaffected ──────────
    const sugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled",
      },
    });
    const sugarOrder = await createPurchaseOrder(shop.id, {
      supplierName: "Agarwal Distributors",
      items: [{ productId: sugar.id, orderedBaseQty: 10000, expectedRate: 40 }],
    });
    assert.equal(Number(sugarOrder.expectedTotal), 400, "10 kg of sugar at ₹40/kg is ₹400");

    console.log("purchase-order-pack-rate-unit.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.purchaseReceiptItem.deleteMany({ where: { receipt: { shopId: shop.id } } }),
      () => db.purchaseReceipt.deleteMany({ where: { shopId: shop.id } }),
      () => db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { shopId: shop.id } } }),
      () => db.purchaseOrder.deleteMany({ where: { shopId: shop.id } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.purchaseHistory.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
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
