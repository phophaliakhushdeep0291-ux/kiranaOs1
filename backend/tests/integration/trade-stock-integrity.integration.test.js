import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext } from "./setup.js";
import { createTenant, createProduct } from "./factories.js";
import * as orders from "../../src/verticals/furniture-home/orders/orders.service.js";
import { openTester } from "../../src/verticals/beauty-cosmetics/testers/testers.service.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("trade stock integrity unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  test("tester register failure rolls back stock, ledger and audit together", async () => {
    const { shop } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id, { stockBaseQty: 5 });
    const ledgerCount = await ctx.db.stockLedger.count({ where: { shopId: shop.id } });
    const auditCount = await ctx.db.auditLog.count({ where: { shopId: shop.id } });
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER qa_fail_tester_insert BEFORE INSERT ON TesterUnit BEGIN SELECT RAISE(ABORT, 'QA tester save failure'); END`);
    try {
      await assert.rejects(() => openTester(shop.id, { productId: product.id }));
    } finally {
      await ctx.db.$executeRawUnsafe("DROP TRIGGER qa_fail_tester_insert");
    }
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 5);
    assert.equal(await ctx.db.stockLedger.count({ where: { shopId: shop.id } }), ledgerCount);
    assert.equal(await ctx.db.auditLog.count({ where: { shopId: shop.id } }), auditCount);
    assert.equal(await ctx.db.testerUnit.count({ where: { shopId: shop.id } }), 0);
    const tester = await openTester(shop.id, { productId: product.id });
    assert.ok(tester.stockLedgerId);
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 4);
    const ledger = await ctx.db.stockLedger.findUnique({ where: { id: tester.stockLedgerId } });
    assert.equal(tester.costValue, ledger.damageLossValue);
  });

  test("furniture holds survive edits and cannot overbook or steal another shop's products", async () => {
    const { shop } = await createTenant(ctx.db);
    const product = await createProduct(ctx.db, shop.id, { name: "QA one sofa", stockBaseQty: 1 });
    const payload = { customerName: "QA Buyer", items: [{ productId: product.id, name: product.name, qty: 1, rate: 100 }] };
    const first = await orders.createOrder(shop.id, { ...payload, status: "confirmed" });
    const quote = await orders.createOrder(shop.id, payload);
    await assert.rejects(() => orders.setOrderStatus(shop.id, quote.id, "confirmed"), { code: "ORDER_NOT_AVAILABLE" });
    await assert.rejects(() => orders.createOrder(shop.id, { ...payload, status: "confirmed" }), { code: "ORDER_NOT_AVAILABLE" });
    await assert.rejects(() => orders.updateOrder(shop.id, first.id, { items: [{ ...payload.items[0], qty: 2 }] }), { code: "ORDER_NOT_AVAILABLE" });
    assert.equal((await orders.getOrder(shop.id, first.id)).items[0].qty, 1);
    await orders.softDeleteOrder(shop.id, first.id);
    await orders.setOrderStatus(shop.id, quote.id, "confirmed");
    await assert.rejects(() => orders.restoreOrder(shop.id, first.id), { code: "ORDER_NOT_AVAILABLE" });
    await orders.cancelOrder(shop.id, quote.id);
    await orders.restoreOrder(shop.id, first.id);
    assert.equal((await orders.getReservations(shop.id)).get(product.id), 1);
    assert.ok((await orders.listOrders(shop.id, { search: "one sofa" })).length > 0);
    const foreign = await createTenant(ctx.db);
    await assert.rejects(() => orders.createOrder(foreign.shop.id, payload), { code: "ORDER_ITEM_MISSING" });
    await orders.setOrderStatus(shop.id, first.id, "ready");
    await assert.rejects(() => orders.setOrderStatus(shop.id, first.id, "delivered", { billId: "missing-bill" }), { code: "ORDER_BILL_MISSING" });
    await orders.addPayment(shop.id, first.id, { amount: 40 });
    await orders.setOrderStatus(shop.id, first.id, "delivered");
    assert.equal((await orders.getOrderSummary(shop.id)).pendingCollection, 60);
    await orders.setOrderStatus(shop.id, first.id, "installed");
    assert.equal((await orders.getOrderSummary(shop.id)).pendingCollection, 60);
  });
}
