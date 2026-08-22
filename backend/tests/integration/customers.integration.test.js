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

    test("customer create rejects an active customer mobile already used in the shop", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      await createCustomer(ctx.db, tenant.shop.id, { name: "Existing Buyer", mobile: "9876543210" });

      const response = await ctx.post(
        "/api/customers",
        customerPayload({ name: "Duplicate Buyer", mobile: "9876543210" }),
        { token: ownerAuth.accessToken },
      );

      assertFailure(response, 409);
      assert.match(String(response.body.error), /mobile already exists/i);
      assert.equal(await ctx.db.customer.count({ where: { shopId: tenant.shop.id, mobile: "9876543210", deletedAt: null } }), 1);
    });

    test("customer update works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Old Customer" });
      const updated = assertSuccess(await ctx.patch(`/api/customers/${customer.id}`, { name: "New Customer" }, { token: ownerAuth.accessToken }));
      assert.equal(updated.name, "New Customer");
    });

    test("customer update cannot take another active customer's mobile", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const existing = await createCustomer(ctx.db, tenant.shop.id, { name: "Existing Buyer", mobile: "9876543210" });
      const edited = await createCustomer(ctx.db, tenant.shop.id, { name: "Edited Buyer", mobile: "9123456789" });

      const response = await ctx.patch(
        `/api/customers/${edited.id}`,
        { mobile: existing.mobile },
        { token: ownerAuth.accessToken },
      );

      assertFailure(response, 409);
      assert.match(String(response.body.error), /mobile already exists/i);
      assert.equal((await ctx.db.customer.findUnique({ where: { id: edited.id } })).mobile, "9123456789");
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

    test("udhar payment posts cash_in + udhar_credit to FinancialLedger", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { udharAmount: 100, type: "udhar" });
      assertSuccess(await ctx.post(`/api/customers/${customer.id}/udhar-payment`, {
        amount: 40,
        mode: "cash",
        note: "partial paid",
      }, { token: ownerAuth.accessToken }));

      // The recovery is one money-in row (cash_in) and one outstanding-reduction row
      // (udhar_credit), so "cash collected" and "udhar recovered" KPIs both move by ₹40.
      const rows = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id, customerId: customer.id } });
      const ofType = (entryType) => rows.filter((row) => row.entryType === entryType);
      assert.equal(ofType("cash_in").length, 1, "money received recorded as cash_in");
      assert.equal(Number(ofType("cash_in")[0].amountPaise), 4000, "cash_in = ₹40");
      assert.equal(ofType("udhar_credit").length, 1, "outstanding reduction recorded as udhar_credit");
      assert.equal(Number(ofType("udhar_credit")[0].amountPaise), 4000, "udhar_credit = ₹40");
    });

    test("udhar payment reversal rolls back when its required audit cannot be stored", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { udharAmount: 100, type: "udhar" });
      assertSuccess(await ctx.post(`/api/customers/${customer.id}/udhar-payment`, {
        amount: 40,
        mode: "cash",
        note: "partial paid",
      }, { token: ownerAuth.accessToken }));
      const payment = await ctx.db.udharLedger.findFirst({
        where: { shopId: tenant.shop.id, customerId: customer.id, type: "payment", mode: "cash" },
      });
      assert.ok(payment);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_udhar_reversal_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'UDHAR_PAYMENT_REVERSED'
        BEGIN
          SELECT RAISE(ABORT, 'forced udhar reversal audit failure');
        END
      `);
      let response;
      try {
        response = await ctx.post(
          `/api/customers/${customer.id}/udhar-payment/${payment.id}/reverse`,
          { reason: "must roll back" },
          { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin },
        );
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_udhar_reversal_audit_failure");
      }

      assertFailure(response, 503);
      assert.equal(response.body.code, "UDHAR_REVERSAL_AUDIT_WRITE_FAILED");
      const unchangedPayment = await ctx.db.udharLedger.findUnique({ where: { id: payment.id } });
      assert.equal(unchangedPayment.reversedAt, null);
      assert.equal(await ctx.db.udharLedger.count({
        where: { shopId: tenant.shop.id, customerId: customer.id, mode: "reversal" },
      }), 0);
      assert.equal((await ctx.db.customer.findUnique({ where: { id: customer.id } })).udharAmount, 60);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, customerId: customer.id } }), 2);
      assert.equal(await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, entityId: payment.id, action: "UDHAR_PAYMENT_REVERSED" },
      }), 0);
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
