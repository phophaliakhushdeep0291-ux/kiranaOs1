import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, billPayload, createCustomer, createProduct, createStaff, createTenant, customerPayload, login, productPayload } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("RBAC/PIN integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function authPair() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const staff = await createStaff(ctx.db, tenant.shop.id);
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
    return { tenant, staff, ownerAuth, staffAuth };
  }

  describe("owner PIN and RBAC integration", () => {
    test("customer DELETE without owner PIN fails for staff", async () => {
      const { tenant, staffAuth } = await authPair();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      assertFailure(await ctx.delete(`/api/customers/${customer.id}`, { token: staffAuth.accessToken }), 403);
    });

    test("customer DELETE with owner PIN succeeds when no udhar", async () => {
      const { tenant, staffAuth } = await authPair();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      assertSuccess(await ctx.delete(`/api/customers/${customer.id}`, {
        token: staffAuth.accessToken,
        headers: { "x-owner-pin": tenant.ownerPin },
      }));
      const deleted = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.ok(deleted.deletedAt);
    });

    test("customer with outstanding udhar cannot be deleted", async () => {
      const { tenant, staffAuth } = await authPair();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { udharAmount: 50, type: "udhar" });
      const response = await ctx.delete(`/api/customers/${customer.id}`, {
        token: staffAuth.accessToken,
        headers: { "x-owner-pin": tenant.ownerPin },
      });
      assert.equal(response.status, 409, JSON.stringify(response.body));
      assert.match(response.body?.error || "", /outstanding udhar/i);
    });

    test("product create with sensitive price/cost fields requires owner PIN for staff", async () => {
      const { staffAuth } = await authPair();
      assertFailure(
        await ctx.post("/api/products", productPayload(), { token: staffAuth.accessToken }),
        403
      );
    });

    test("product create by owner works", async () => {
      const { tenant, ownerAuth } = await authPair();
      const product = assertSuccess(
        await ctx.post("/api/products", productPayload({ name: "Owner Product" }), { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }),
        201
      );
      assert.equal(product.name, "Owner Product");
    });

    test("P&L route blocks staff", async () => {
      const { staffAuth } = await authPair();
      assertFailure(await ctx.get("/api/reports/pnl?range=daily", { token: staffAuth.accessToken }), 403);
    });

    test("payment summary remains accessible to staff", async () => {
      const { staffAuth } = await authPair();
      const data = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: staffAuth.accessToken }));
      assert.equal(typeof data.total, "number");
    });

    test("wrong owner PIN fails", async () => {
      const { tenant, staffAuth } = await authPair();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      assertFailure(await ctx.delete(`/api/customers/${customer.id}`, {
        token: staffAuth.accessToken,
        headers: { "x-owner-pin": "0000" },
      }), 403);
    });

    test("owner PIN supplied only in the query string is ignored (rejected)", async () => {
      const { tenant, staffAuth } = await authPair();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      // Correct PIN, but only in the URL query — it must be ignored (a PIN in the URL leaks
      // into access logs, browser history, and proxies), so the delete is rejected.
      assertFailure(await ctx.delete(`/api/customers/${customer.id}?ownerPin=${tenant.ownerPin}`, {
        token: staffAuth.accessToken,
      }), 403);
      const stillThere = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.ok(stillThere && stillThere.deletedAt == null, "customer must not be deletable via a query-string PIN");
    });

    test("ownerPin is stripped from stored sync requestJson/resultJson", async () => {
      const { tenant, staffAuth } = await authPair();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const device = await activateDeviceViaApi(ctx, staffAuth.accessToken, { deviceId: "rbac-sync-device" });
      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "pin-strip-1",
          type: "ADJUST_STOCK",
          ownerPin: tenant.ownerPin,
          payload: { productId: product.id, newStockBaseQty: 7, ownerPin: tenant.ownerPin },
        }],
      }, { token: staffAuth.accessToken, headers: { "x-device-id": device.deviceId } });

      assertSuccess(response);
      const stored = await ctx.db.offlineSyncEvent.findUnique({
        where: { shopId_eventId: { shopId: tenant.shop.id, eventId: "pin-strip-1" } },
      });
      assert.ok(stored);
      assert.doesNotMatch(stored.requestJson || "", /1234|ownerPin/i);
      assert.doesNotMatch(stored.resultJson || "", /1234|ownerPin/i);
    });
  });
}
