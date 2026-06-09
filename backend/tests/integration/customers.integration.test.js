import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createCustomer, createTenant, customerPayload, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("customer/udhar integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, ownerAuth };
  }

  describe("customer and udhar integration", () => {
    test("customer create works", async () => {
      const { ownerAuth } = await ownerCtx();
      const data = assertSuccess(await ctx.post("/api/customers", customerPayload({ name: "Ramesh" }), { token: ownerAuth.accessToken }), 201);
      assert.equal(data.name, "Ramesh");
    });

    test("customer update works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Old Customer" });
      const updated = assertSuccess(await ctx.patch(`/api/customers/${customer.id}`, { name: "New Customer" }, { token: ownerAuth.accessToken }));
      assert.equal(updated.name, "New Customer");
    });

    test("customer list is shop-scoped", async () => {
      const a = await createTenant(ctx.db);
      const b = await createTenant(ctx.db);
      const authA = await login(ctx, a.ownerMobile, a.ownerPassword);
      const customerA = await createCustomer(ctx.db, a.shop.id, { name: "Shop A Customer" });
      const customerB = await createCustomer(ctx.db, b.shop.id, { name: "Shop B Customer" });

      const list = assertSuccess(await ctx.get("/api/customers", { token: authA.accessToken }));
      assert.ok(list.some((c) => c.id === customerA.id));
      assert.equal(list.some((c) => c.id === customerB.id), false);
    });

    test("udhar payment creates ledger entry and updates customer balance", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { udharAmount: 100, type: "udhar" });
      const data = assertSuccess(await ctx.post(`/api/customers/${customer.id}/udhar-payment`, {
        amount: 40,
        mode: "cash",
        note: "partial paid",
      }, { token: ownerAuth.accessToken }));
      assert.equal(data.newBalance, 60);
      const ledger = await ctx.db.udharLedger.findMany({ where: { customerId: customer.id, type: "payment" } });
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].amount, 40);
    });

    test("customer with udhar cannot be deleted", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { udharAmount: 1, type: "udhar" });
      const response = await ctx.delete(`/api/customers/${customer.id}`, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin });
      assert.equal(response.status, 409, JSON.stringify(response.body));
    });

    test("cross-shop customer access is blocked", async () => {
      const a = await createTenant(ctx.db);
      const b = await createTenant(ctx.db);
      const authB = await login(ctx, b.ownerMobile, b.ownerPassword);
      const customerA = await createCustomer(ctx.db, a.shop.id);

      assertFailure(await ctx.get(`/api/customers/${customerA.id}`, { token: authB.accessToken }), 404);
      assertFailure(await ctx.patch(`/api/customers/${customerA.id}`, { name: "Bad Update" }, { token: authB.accessToken }), 404);
    });
  });
}
