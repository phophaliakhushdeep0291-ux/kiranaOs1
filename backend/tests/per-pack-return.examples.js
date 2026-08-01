import assert from "node:assert/strict";
import db from "../src/db.js";
import { confirmBill, createSaleReturn } from "../src/modules/bills/bills.service.js";
import { recordPurchase } from "../src/modules/inventory/inventory.service.js";

// The last asymmetry in per-packaging stock: a sale takes packs off a specific
// size, so a return has to put them back on that same size. Shipping the deduction
// without this would drift the counts a little further from reality on every
// return until they were worthless — which is exactly why the packagingMode guard
// stayed on until now.
//
// The case that matters is a PARTIAL return: sell 3 boxes, take 1 back.

async function main() {
  const shop = await db.shop.create({ data: { name: `PPR ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Maggi Noodles", category: "instant",
        baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
        stockBaseQty: 0, defaultPricePerRateUnit: 108, costPerRateUnit: 92,
        packagingMode: "per_pack",
      },
    });
    const box = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, maximumPrice: 112, costPrice: 92, onHandQty: 0, isDefault: true },
    });
    const packet = await db.productSellingUnit.create({
      data: { shopId: shop.id, productId: product.id, name: "70 g packet", unitType: "packet", unitCode: "pkt70", packSizeValue: 70, packSizeUnit: "gram", conversionToBase: 70, defaultPrice: 14, maximumPrice: 14, onHandQty: 0 },
    });

    // Receive 10 boxes and 50 packets.
    await recordPurchase(shop.id, { productId: product.id, supplierName: "D", quantity: 10, enteredUnit: "piece", sellingUnitId: box.id, billAmount: 920, idempotencyKey: "per-pack-return-in-box" });
    await recordPurchase(shop.id, { productId: product.id, supplierName: "D", quantity: 50, enteredUnit: "piece", sellingUnitId: packet.id, billAmount: 550, idempotencyKey: "per-pack-return-in-pkt" });
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 10);

    // ── sell 3 boxes ────────────────────────────────────────────────
    const bill = await confirmBill(shop.id, {
      billType: "normal_sale",
      customerName: "Walk-in",
      items: [{
        productId: product.id,
        name: product.name,
        quantity: 3,
        enteredUnit: "piece",
        sellingUnitId: box.id,
        ratePerRateUnit: 108,
        gstRate: 0,
      }],
      discount: 0,
      payments: [{ mode: "cash", amount: 324 }],
      actualAmount: 324,
      buyerPaidAmount: 324,
      waivedAmount: 0,
      clientBillId: "per-pack-return-bill-1",
      idempotencyKey: "per-pack-return-bill-1",
    });

    assert.equal((await db.productSellingUnit.findUnique({ where: { id: box.id } })).onHandQty, 7, "3 boxes sold leaves 7");
    assert.equal((await db.productSellingUnit.findUnique({ where: { id: packet.id } })).onHandQty, 50, "the packet count is untouched by a box sale");

    // ── take 1 box back ─────────────────────────────────────────────
    await createSaleReturn(shop.id, {
      returnOfBillId: bill.id,
      items: [{
        productId: product.id,
        originalBillItemId: bill.items[0].id,
        quantity: 1,
        enteredUnit: "piece",
        ratePerRateUnit: 108,
      }],
      refundMode: "cash",
      reason: "customer changed mind",
      clientBillId: "per-pack-return-ret-1",
      idempotencyKey: "per-pack-return-ret-1",
    });

    const boxAfter = await db.productSellingUnit.findUnique({ where: { id: box.id } });
    assert.equal(boxAfter.onHandQty, 8, "a partial return puts back only what came back, on the same size");
    assert.equal(
      (await db.productSellingUnit.findUnique({ where: { id: packet.id } })).onHandQty,
      50,
      "and never lands on a different size",
    );

    // The pooled total must still agree with the packs, or the two numbers have
    // started to drift — the failure this whole design exists to prevent.
    const pooled = await db.product.findUnique({ where: { id: product.id } });
    assert.equal(pooled.stockBaseQty, 8 * 560 + 50 * 70, "pooled total still equals the sum of the packs");

    // ── the return movement remembers the size ──────────────────────
    const ledger = await db.stockLedger.findFirst({ where: { shopId: shop.id, productId: product.id, action: "return" } });
    assert.equal(ledger.sellingUnitId, box.id, "the return movement records which size came back");
    assert.equal(ledger.sellingUnitQty, 1);

    // ── the return bill line carries the packaging ──────────────────
    const returnLine = await db.billItem.findFirst({ where: { productId: product.id, quantity: { lt: 0 } }, orderBy: { id: "desc" } });
    assert.equal(returnLine.sellingUnitId, box.id, "the return line names the pack, not just base units");

    console.log("per-pack-return.examples.js OK");
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
