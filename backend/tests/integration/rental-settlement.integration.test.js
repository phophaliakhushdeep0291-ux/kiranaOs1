import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, login } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("rental settlement unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));

  async function fixture() {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    await ctx.db.shop.update({ where: { id: tenant.shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType("clothing")) } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken };
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5 });
    const day = new Date().toISOString().slice(0, 10);
    const rental = assertSuccess(await ctx.post("/api/rentals", {
      customerName: "QA Renter", customerPhone: "9999999991", customerAddress: "QA address",
      fromDate: day, toDate: day, items: [{ productId: product.id, name: product.name, qty: 1, amount: 100 }],
      rentAmount: 100, advancePaid: 100, depositAmount: 200,
    }, options), 201);
    return { tenant, options, product, rental };
  }
  const payment = { expectedAdvancePaid: 100, amount: 10, paymentMode: "upi", reference: "QA-collection" };

  test("returned rental can be settled once with an auditable collection and no stock change", async () => {
    const { tenant, options, product, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertFailure(await ctx.post(`${path}/settle`, payment, options), 409);
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    assertFailure(await ctx.post(`${path}/settle`, { ...payment, amount: 11 }, options), 409);
    assertFailure(await ctx.post(`${path}/settle`, { ...payment, expectedAdvancePaid: 99 }, options), 409);
    assertFailure(await ctx.post(`${path}/settle`, { ...payment, amount: -10 }, options), 400);
    const settled = assertSuccess(await ctx.post(`${path}/settle`, payment, options));
    assert.equal(settled.balanceDue, 0);
    assert.equal(settled.advancePaid, 110);
    assert.equal(settled.depositAmount, 200);
    assert.equal(settled.status, "returned");
    assert.equal(assertSuccess(await ctx.post(`${path}/settle`, payment, options)).balanceDue, 0);
    const audits = await ctx.db.auditLog.findMany({ where: { shopId: tenant.shop.id, entityId: rental.id, action: "RENTAL_BALANCE_COLLECTED" } });
    assert.equal(audits.length, 1);
    assert.equal(JSON.parse(audits[0].metadataJson).amount, 10);
    assert.equal(JSON.parse(audits[0].metadataJson).paymentMode, "upi");
    assert.equal(audits[0].userId, tenant.owner.id);
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 5);
    assert.equal(assertSuccess(await ctx.get("/api/rentals/summary", options)).pendingCollection, 0);
    const other = await fixture();
    assertFailure(await ctx.post(`${path}/settle`, payment, other.options), 404);
  });

  test("collection rolls back when its mandatory audit cannot be written", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite fault injection");
    const { options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER fail_rental_collection_audit BEFORE INSERT ON AuditLog
      WHEN NEW.action = 'RENTAL_BALANCE_COLLECTED' BEGIN SELECT RAISE(ABORT, 'forced rental audit failure'); END`);
    try {
      assertFailure(await ctx.post(`${path}/settle`, payment, options), 503);
      assert.equal(assertSuccess(await ctx.get(path, options)).balanceDue, 10);
    } finally {
      await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_rental_collection_audit");
    }
  });

  test("simultaneous final collections cannot double-charge the balance", async () => {
    const { options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    const responses = await Promise.all([ctx.post(`${path}/settle`, payment, options), ctx.post(`${path}/settle`, payment, options)]);
    for (const response of responses) assert.equal(assertSuccess(response).advancePaid, 110);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: rental.id, action: "RENTAL_BALANCE_COLLECTED" } }), 1);
  });
}
