import { registerSaleGuard } from "../../src/shared/sale-guards.js";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, login, billPayload } from "./factories.js";
import { restoreCancelledBill } from "../../src/modules/bills/bills.service.js";
const ctx = await createIntegrationContext();
if (ctx.skip) test("specialist billing requires a database", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close()); beforeEach(() => resetDatabase(ctx.db));
  async function fixture({ stock = 10, schedule } = {}) {
    const tenant = await createTenant(ctx.db);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const credentials = { token: auth.accessToken, ownerPin: tenant.ownerPin };
    assertSuccess(await ctx.get("/api/orders", credentials));
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: stock, defaultPricePerRateUnit: 50, costPerRateUnit: 30 });
    if (schedule) await ctx.db.product.update({ where: { id: product.id }, data: { drugSchedule: schedule } });
    const unit = !schedule ? await ctx.db.productUnit.create({ data: { shopId: tenant.shop.id, productId: product.id, productName: product.name, serialNumber: "SERIAL-ONE", warrantyMonths: 12 } }) : null;
    const payload = () => { const body = billPayload(product, { quantity: 1 }); body.clientBillId = randomUUID(); if (unit) body.items[0].trackedUnitId = unit.id; return body; };
    return { tenant, product, unit, credentials, payload };
  }
  const sale = (f, body = f.payload()) => ctx.post("/api/bills/confirm", body, f.credentials);
  const stock = f => ctx.db.product.findUniqueOrThrow({ where: { id: f.product.id } }).then(p => p.stockBaseQty);
  const unitRow = f => ctx.db.productUnit.findUniqueOrThrow({ where: { id: f.unit.id } });
  test("one sale atomically links serial, stock, receipt and warranty; replay is harmless", async () => {
    const f = await fixture(); const payload = f.payload();
    const bill = assertSuccess(await sale(f, payload), 201);
    const replay = assertSuccess(await sale(f, payload), 201);
    assert.equal(replay.id, bill.id); assert.equal(await stock(f), 9);
    const unit = await unitRow(f);
    assert.equal(unit.billId, bill.id); assert.equal(unit.status, "sold"); assert.ok(unit.warrantyUntil);
    assert.equal(bill.items[0].trackedUnitId, unit.id); assert.match(bill.items[0].note, /SERIAL-ONE/);
    const listed = assertSuccess(await ctx.get("/api/bills", f.credentials));
    assert.equal(listed.bills[0].items[0].trackedUnitId, unit.id);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.tenant.shop.id } }), 1);
  });
  test("an estimate reserves its serial because estimates move stock", async () => {
    const f = await fixture(); const body = { ...f.payload(), billType: "estimate" };
    assertSuccess(await sale(f, body), 201);
    assert.equal((await unitRow(f)).status, "sold"); assert.equal(await stock(f), 9);
    assertFailure(await sale(f), 409);
  });
  test("missing, foreign and repeated serials cannot charge money or deduct stock", async () => {
    const f = await fixture();
    for (const id of [undefined, "other-shop-unit"]) { const body = f.payload(); body.items[0].trackedUnitId = id; assertFailure(await sale(f, body), 409); }
    const body = f.payload(); body.items.push({ ...body.items[0] }); body.actualAmount = 100; body.buyerPaidAmount = 100; body.payments = [{ mode: "cash", amount: 100 }];
    assertFailure(await sale(f, body), 409);
    assert.equal(await stock(f), 10); assert.equal(await ctx.db.bill.count({ where: { shopId: f.tenant.shop.id } }), 0);
  });
  test("two counters racing for one serial produce exactly one sale", async () => {
    const f = await fixture(); const results = await Promise.all([sale(f), sale(f)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(await stock(f), 9); assert.equal(await ctx.db.bill.count({ where: { shopId: f.tenant.shop.id } }), 1);
  });
  test("a downstream failure rolls back the serial reservation and all money", async () => {
    registerSaleGuard(async ({ body }) => body.clientBillId === "rollback-proof" ? { onConfirmed: async () => { throw Error("Intentional downstream rollback test"); } } : null);
    const f = await fixture(); const result = await sale(f, { ...f.payload(), clientBillId: "rollback-proof" });
    assert.ok(result.status >= 400, JSON.stringify(result));
    assert.equal((await unitRow(f)).status, "in_stock");
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.tenant.shop.id } }), 0);
    assert.equal(await ctx.db.payment.count({ where: { shopId: f.tenant.shop.id } }), 0);
  });
  test("cancellation releases the serial, restoration reclaims it, and return releases exactly that bill line", async () => {
    const f = await fixture(); const bill = assertSuccess(await sale(f), 201);
    assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Cancelled at counter" }, f.credentials));
    assert.equal((await unitRow(f)).status, "in_stock"); assert.equal(await stock(f), 10);
    await restoreCancelledBill(f.tenant.shop.id, bill.id, { reason: "Undo cancellation" });
    assert.equal((await unitRow(f)).status, "sold"); assert.equal(await stock(f), 9);
    const body = { returnOfBillId: bill.id, clientBillId: randomUUID(), reason: "Customer return", refundMode: "cash",
      items: [{ ...f.payload().items[0], originalBillItemId: bill.items[0].id }] };
    const partial = { ...body, items: [{ ...body.items[0], quantity: 0.5 }] };
    assertFailure(await ctx.post("/api/bills/returns", partial, f.credentials), 409);
    assert.equal((await unitRow(f)).status, "sold");
    const returned = assertSuccess(await ctx.post("/api/bills/returns", body, f.credentials), 201);
    assert.equal((await unitRow(f)).status, "returned"); assert.equal(await stock(f), 10);
    assert.equal(assertSuccess(await ctx.post("/api/bills/returns", body, f.credentials), 201).id, returned.id);
    assert.equal(await stock(f), 10);
  });
  async function prescription(f, refillsAllowed = 0) {
    return ctx.db.prescription.create({ data: { shopId: f.tenant.shop.id, registerNumber: "RX-ONE", doctorName: "QA Doctor", patientName: "QA Patient", prescribedOn: new Date(), scheduleType: "otc", refillsAllowed,
      items: { create: [{ productId: f.product.id, name: f.product.name, qty: 1, unit: "piece" }] } } });
  }
  test("an attached OTC prescription is dispensed with its bill, while a retry does not spend a refill", async () => {
    const f = await fixture({ schedule: "otc" }); const rx = await prescription(f, 1);
    const body = { ...f.payload(), prescriptionId: rx.id };
    const bill = assertSuccess(await sale(f, body), 201);
    assertSuccess(await sale(f, body), 201);
    let saved = await ctx.db.prescription.findUniqueOrThrow({ where: { id: rx.id } });
    assert.equal(saved.status, "dispensed"); assert.equal(saved.billId, bill.id); assert.equal(saved.refillsUsed, 0);
    assertSuccess(await sale(f, { ...f.payload(), prescriptionId: rx.id }), 201);
    saved = await ctx.db.prescription.findUniqueOrThrow({ where: { id: rx.id } }); assert.equal(saved.refillsUsed, 1);
    assertFailure(await sale(f, { ...f.payload(), prescriptionId: rx.id }), 409); assert.equal(await stock(f), 8);
  });
  test("two counters cannot consume a one-use prescription twice", async () => {
    const f = await fixture({ schedule: "h" }); const rx = await prescription(f);
    const results = await Promise.all([sale(f, { ...f.payload(), prescriptionId: rx.id }), sale(f, { ...f.payload(), prescriptionId: rx.id })]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); assert.equal(await stock(f), 9);
  });
}
