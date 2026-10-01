import assert from "node:assert/strict";
import db from "../src/db.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";
import * as trade from "../src/verticals/manufacturing/trade-orders.service.js";
import { createTradeInvoice, previewTradeInvoice } from "../src/verticals/manufacturing/trade-invoices.service.js";
import { createTradeOrderSchema } from "../src/verticals/manufacturing/manufacturing.schemas.js";

// A wholesale order for a packaged product could be dispatched but never invoiced.
//
// The order form's packaging picker starts on "base units", so an order for jars
// of pickle is, by default, a line of grams at a price per gram. Invoicing it
// converts that price into the product's RATE unit — the jar, since the product
// service copies the default pack's type into `rateUnit` — through the unit
// table, which knows only real units:
//
//   Unsupported unit "jar". Supported units: kg, g, gram, ... box
//
// Two places did that conversion: pricing the invoice (so even the preview failed)
// and then confirmBill itself, which on this path is handed no packaging and
// converts the line through `rateUnit` too. Fixing only the first would move the
// same error one step later, after the owner had already been shown a total.

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function stockedBatch(shopId, locationId, product, batchNumber, baseQty) {
  await db.product.update({ where: { id: product.id }, data: { stockBaseQty: baseQty } });
  await db.inventoryLot.create({
    data: {
      shopId, locationId, productId: product.id, batchNumber,
      expiresOn: new Date(`${day(365)}T00:00:00.000Z`),
      receivedBaseQty: baseQty, availableBaseQty: baseQty, costPerRateUnit: product.costPerRateUnit,
    },
  });
}

/** Take one base-unit order line from order to invoice, returning what each step said. */
async function shipAndInvoice(shopId, product, { orderNumber, quantity, unitPrice }) {
  const order = await trade.createTradeOrder(shopId, createTradeOrderSchema.parse({
    orderNumber, customerName: "Sharma Traders",
    // No sellingUnitId: the picker's default, a quantity in base units.
    items: [{ productId: product.id, quantity, unitPrice }],
  }));
  await trade.confirmTradeOrder(shopId, order.id);
  const allocated = await trade.autoAllocateTradeOrder(shopId, order.id);
  await trade.packTradeOrder(shopId, order.id, { items: allocated.items.map((row) => ({ orderItemId: row.id, packedQuantity: row.quantity })) });
  await trade.dispatchTradeOrder(shopId, order.id, { dispatchNumber: `${orderNumber}-D1`, dispatchDate: day() });

  const preview = await previewTradeInvoice(shopId, order.id, { billType: "normal_sale" });
  const invoiced = await createTradeInvoice(shopId, order.id, { paymentMode: "bank" }, { ownerPinVerified: true });
  const lines = await db.billItem.findMany({ where: { billId: invoiced.billId } });
  assert.equal(lines.length, 1, `${orderNumber}: one invoice line`);
  return { preview, invoiced, line: lines[0] };
}

async function main() {
  const shop = await db.shop.create({ data: { name: `TIP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const location = await resolveOperationalLocation(shop.id, null);

    // ── a loose product: kg ──────────────────────────────────────────
    // Invoiced before any packaged product exists, so these assertions read the
    // same against the code before and after the fix.
    const masala = await db.product.create({
      data: {
        shopId: shop.id, name: "Masala Mix", category: "finished_goods",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 0, defaultPricePerRateUnit: 300, costPerRateUnit: 150,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });
    await stockedBatch(shop.id, location.id, masala, "MASALA-1", 5000);
    const loose = await shipAndInvoice(shop.id, masala, { orderNumber: "WO-LOOSE", quantity: 2000, unitPrice: 0.3 });
    // 2000 g at ₹0.30/g is ₹600: billed as 2 kg at ₹300/kg.
    assert.equal(loose.preview.total, 600, "the loose preview totals ₹600");
    assert.equal(loose.line.lineTotal, 600, "the loose invoice line is ₹600");
    assert.equal(loose.line.ratePerRateUnit, 300, "priced per kg");
    assert.equal(loose.line.quantityInBaseUnit, 2000, "2000 g left the shelf");
    assert.equal(loose.invoiced.status, "invoiced");

    // ── a packaged product: jars ─────────────────────────────────────
    const pickle = await db.product.create({
      data: {
        shopId: shop.id, name: "Mango Pickle 500 g jar", category: "finished_goods",
        baseUnit: "gram", rateUnit: "jar", displayUnit: "jar 500 gram",
        stockBaseQty: 0, defaultPricePerRateUnit: 120, costPerRateUnit: 64, mrp: 150,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: pickle.id, name: "jar 500 gram",
        unitType: "jar", unitCode: "jar-500-gram", packSizeValue: 500, packSizeUnit: "gram",
        conversionToBase: 500, defaultPrice: 120, maximumPrice: 150, costPrice: 64, isDefault: true,
      },
    });
    await stockedBatch(shop.id, location.id, pickle, "PICKLE-1", 5000);
    const packed = await shipAndInvoice(shop.id, pickle, { orderNumber: "WO-PACK", quantity: 2000, unitPrice: 0.24 });
    // 2000 g is 4 jars; ₹0.24/g is ₹120 a jar; ₹480 either way.
    assert.equal(packed.preview.total, 480, "the preview totals ₹480");
    assert.equal(packed.line.lineTotal, 480, "the invoice line is ₹480");
    assert.equal(packed.line.ratePerRateUnit, 120, "priced per jar, the product's rate unit");
    assert.equal(packed.line.quantityInBaseUnit, 2000, "2000 g — 4 jars — left the shelf, once");
    assert.equal(packed.line.lineCost, 256, "4 jars at ₹64 cost");
    assert.equal(packed.invoiced.status, "invoiced");

    console.log("trade-invoice-pack-rate-unit.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.billItemLotAllocation.deleteMany({ where: { billItem: { bill: { shopId: shop.id } } } }),
      () => db.billItem.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.payment.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.tradeOrderAllocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.tradeDispatch.deleteMany({ where: { shopId: shop.id } }),
      () => db.tradeOrderItem.deleteMany({ where: { shopId: shop.id } }),
      () => db.tradeOrder.deleteMany({ where: { shopId: shop.id } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.bill.deleteMany({ where: { shopId: shop.id } }),
      () => db.billCounter.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
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
