import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createTenant, login, productPayload } from "./factories.js";

const ctx = await createIntegrationContext();
if (ctx.skip) {
  test("counter lifecycle", { skip: ctx.reason }, () => {});
} else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));

  test("receive stock, replay an offline split sale, collect credit, and return stock through HTTP", async () => {
    const tenant = await createTenant(ctx.db);
    const deviceId = `counter-${randomUUID()}`;
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword, {
      device: { deviceId, deviceName: "Counter lifecycle", deviceType: "desktop" },
    });
    const options = { token: auth.accessToken, headers: { "x-device-id": deviceId }, ownerPin: tenant.ownerPin };
    const product = assertSuccess(await ctx.post("/api/products", productPayload({
      name: "Counter Soap", stockBaseQty: 10, defaultPricePerRateUnit: 50, costPerRateUnit: 30,
    }), options), 201);
    const customer = assertSuccess(await ctx.post("/api/customers", { name: "Counter Customer", mobile: "6999999911" }, options), 201);
    const purchase = { idempotencyKey: randomUUID(), productId: product.id, quantity: 2, enteredUnit: "piece", billAmount: 60, supplierName: "Counter Supplier", purchasePaymentStatus: "paid", purchasePaymentMode: "cash" };
    assertSuccess(await ctx.post("/api/inventory/purchase", purchase, options), 201);
    assertSuccess(await ctx.post("/api/inventory/purchase", purchase, options), 200);
    assert.equal(assertSuccess(await ctx.get(`/api/products/${product.id}`, options)).stockBaseQty, 12, "purchase replay cannot receive stock twice");

    const clientBillId = `counter-bill-${randomUUID()}`;
    const body = { ...billPayload(product, {
      quantity: 2, customerId: customer.id, customerName: customer.name,
      buyerPaidAmount: 40, payments: [{ mode: "cash", amount: 25 }, { mode: "upi", amount: 15 }],
    }), localBillId: clientBillId, clientBillId, creditAmount: 60, idempotencyKey: `counter:${clientBillId}` };
    const event = { eventId: randomUUID(), type: "CREATE_BILL", payload: { localBillId: clientBillId, clientBillId, idempotencyKey: body.idempotencyKey, bill: body } };
    for (const delivery of [event, event, { ...event, eventId: randomUUID() }]) {
      assertSuccess(await ctx.post("/api/sync/push", { events: [delivery] }, options));
    }
    const bills = await ctx.db.bill.findMany({ where: { shopId: tenant.shop.id, clientBillId }, include: { items: true, payments: true } });
    assert.equal(bills.length, 1, "lost acknowledgement and rebuilt event still produce one bill");
    const bill = bills[0];
    assert.equal(bill.grandTotal, 100);
    assert.equal(bill.payments.length, 2);
    assert.equal(assertSuccess(await ctx.get(`/api/products/${product.id}`, options)).stockBaseQty, 10);
    assert.equal(assertSuccess(await ctx.get(`/api/customers/${customer.id}/khata`, options)).customer.udharAmount, 60);
    assert.equal(await ctx.db.stockLedger.count({ where: { billId: bill.id, action: "sale" } }), 1);

    const collection = { amount: 60, mode: "cash", idempotencyKey: randomUUID(), localLedgerEntryId: randomUUID() };
    const firstCollection = await ctx.post(`/api/customers/${customer.id}/udhar-payment`, collection, options);
    assert.ok(firstCollection.ok, JSON.stringify(firstCollection.body));
    const repeatedCollection = await ctx.post(`/api/customers/${customer.id}/udhar-payment`, collection, options);
    assert.ok(repeatedCollection.ok, JSON.stringify(repeatedCollection.body));
    const khata = assertSuccess(await ctx.get(`/api/customers/${customer.id}/khata`, options));
    assert.equal(khata.customer.udharAmount, 0, "repayment replay must not turn the balance negative");
    assert.equal(khata.ledger.filter((row) => row.type === "payment").length, 1, "one repayment entry");

    const returned = { returnOfBillId: bill.id, customerId: customer.id, refundMode: "cash", reason: "Unopened item returned", idempotencyKey: randomUUID(), items: [{ ...body.items[0], quantity: 1, originalBillItemId: bill.items[0].id }] };
    const creditNote = assertSuccess(await ctx.post("/api/bills/returns", returned, options), 201);
    const replayedReturn = assertSuccess(await ctx.post("/api/bills/returns", returned, options), 201);
    assert.equal(replayedReturn.id, creditNote.id, "return replay produces the same credit note");
    assert.equal(assertSuccess(await ctx.get(`/api/products/${product.id}`, options)).stockBaseQty, 11);
    assert.equal(assertSuccess(await ctx.get(`/api/customers/${customer.id}/khata`, options)).customer.udharAmount, 0);

    const foreign = await createTenant(ctx.db);
    const foreignAuth = await login(ctx, foreign.ownerMobile, foreign.ownerPassword);
    assertFailure(await ctx.get(`/api/bills/${bill.id}`, { token: foreignAuth.accessToken }), 404);
    assertFailure(await ctx.get(`/api/customers/${customer.id}/khata`, { token: foreignAuth.accessToken }), 404);
    assertFailure(await ctx.get(`/api/products/${product.id}`, { token: foreignAuth.accessToken }), 404);
  });
}
