import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, billPayload, createCustomer, createProduct, createStaff, createTenant, customerPayload, login, productPayload } from "./factories.js";
import * as authService from "../../src/modules/auth/auth.service.js";

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
    test("owner assignments enforce deny-by-default store and action boundaries", async () => {
      const { tenant, staff, ownerAuth, staffAuth } = await authPair();
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: { planCode: "pro" } });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Scoped Product", stockBaseQty: 20 });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: ownerAuth.accessToken })).locations[0];
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Scoped Branch", code: "SCOPE02" }, { token: ownerAuth.accessToken }), 201);
      assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 5 }],
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      const unrelatedBranch = assertSuccess(await ctx.post("/api/stores", { name: "Unrelated Branch", code: "SCOPE03" }, { token: ownerAuth.accessToken }), 201);
      assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: unrelatedBranch.id,
        items: [{ productId: product.id, quantityBaseQty: 2 }],
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);

      const assignment = assertSuccess(await ctx.request("PUT", `/api/auth/staff/${staff.staff.id}/locations`, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        body: {
          locations: [{
            locationId: branch.id,
            canSell: true,
            canPurchase: false,
            canManageInventory: false,
            canTransfer: false,
          }],
        },
      }));
      assert.equal(assignment.assignedLocationCount, 1);
      assert.equal(assignment.assignments.explicitScope, true);

      const staffStores = assertSuccess(await ctx.get("/api/stores", { token: staffAuth.accessToken }));
      assert.equal(staffStores.accessScoped, true);
      assert.deepEqual(staffStores.locations.map((row) => row.id), [branch.id]);
      const staffTransfers = assertSuccess(await ctx.get("/api/stores/transfers", { token: staffAuth.accessToken }));
      assert.equal(staffTransfers.length, 1);
      assert.equal(staffTransfers[0].toLocationId, branch.id);

      const primaryCatalog = assertFailure(await ctx.get("/api/products", {
        token: staffAuth.accessToken,
        headers: { "x-location-id": primary.id },
      }), 403);
      assert.equal(primaryCatalog.code, "LOCATION_ACCESS_DENIED");

      const purchaseDenied = assertFailure(await ctx.post("/api/inventory/purchase", {
        productId: product.id,
        supplierName: "Blocked Supplier",
        quantity: 1,
        enteredUnit: "piece",
        billAmount: 10,
        updateCost: false,
      }, { token: staffAuth.accessToken, headers: { "x-location-id": branch.id } }), 403);
      assert.equal(purchaseDenied.code, "LOCATION_ACCESS_DENIED");

      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { quantity: 1 }), {
        token: staffAuth.accessToken,
        headers: { "x-location-id": branch.id },
      }), 201);
      assert.equal(bill.locationId, branch.id);

      const branchInventory = assertFailure(await ctx.post("/api/inventory/correction", {
        productId: product.id,
        newStockBaseQty: 9,
        reason: "unauthorized test",
      }, { token: staffAuth.accessToken, ownerPin: tenant.ownerPin, headers: { "x-location-id": branch.id } }), 403);
      assert.equal(branchInventory.code, "LOCATION_ACCESS_DENIED");
    });

    test("omitting location cannot widen scoped staff reads; owner all-scope is explicit", async () => {
      const { tenant, staff, ownerAuth, staffAuth } = await authPair();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Branch Secret Product", stockBaseQty: 20, defaultPricePerRateUnit: 30 });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: ownerAuth.accessToken })).locations[0];
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Private Branch", code: "PRIVATE02" }, { token: ownerAuth.accessToken }), 201);
      assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 4 }],
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { quantity: 1, ratePerRateUnit: 30 }), {
        token: ownerAuth.accessToken,
        headers: { "x-location-id": branch.id },
      }), 201);

      assertSuccess(await ctx.request("PUT", `/api/auth/staff/${staff.staff.id}/locations`, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        body: { locations: [{ locationId: primary.id, canSell: true, canPurchase: false, canManageInventory: false, canTransfer: false }] },
      }));

      const staffBills = assertSuccess(await ctx.get("/api/bills", { token: staffAuth.accessToken }));
      assert.equal(staffBills.total, 0, "missing location header must default to the authorised primary branch");
      const staffClosing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", { token: staffAuth.accessToken }));
      assert.equal(staffClosing.location.id, primary.id);
      assert.equal(staffClosing.totalBills, 0);
      const allDenied = assertFailure(await ctx.get("/api/bills", { token: staffAuth.accessToken, headers: { "x-location-id": "all" } }), 403);
      assert.equal(allDenied.code, "LOCATION_ACCESS_DENIED");

      const ownerAllBills = assertSuccess(await ctx.get("/api/bills", { token: ownerAuth.accessToken, headers: { "x-location-id": "all" } }));
      assert.equal(ownerAllBills.total, 1);
      const ownerAllClosing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", { token: ownerAuth.accessToken, headers: { "x-location-id": "all" } }));
      assert.equal(ownerAllClosing.totalBills, 1);
      assert.deepEqual(ownerAllClosing.location, { id: "all", code: "ALL", name: "All locations" });
    });

    test("owner staff edits are audited atomically and password changes revoke active staff sessions", async () => {
      const { tenant, staff, ownerAuth, staffAuth } = await authPair();
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: { planCode: "pro" } });

      const updated = assertSuccess(await ctx.request("PATCH", `/api/auth/staff/${staff.staff.id}`, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        body: {
          name: "Updated Counter Manager",
          email: "counter.manager@example.com",
          role: "admin",
          password: "NewStaffPass123",
        },
      }));
      assert.equal(updated.id, staff.staff.id);
      assert.equal(updated.name, "Updated Counter Manager");
      assert.equal(updated.email, "counter.manager@example.com");
      assert.equal(updated.mobile, staff.staffMobile, "an omitted identity field must be retained");
      assert.equal(updated.role, "admin");
      assert.equal("passwordHash" in updated, false);

      assertFailure(await ctx.get("/api/auth/me", { token: staffAuth.accessToken }), 401);
      assertFailure(await ctx.post("/api/auth/login", { mobile: staff.staffMobile, password: staff.staffPassword }), 401);
      assertSuccess(await ctx.post("/api/auth/login", { mobile: staff.staffMobile, password: "NewStaffPass123" }));

      const revoked = await ctx.db.session.count({
        where: { userId: staff.staff.id, shopId: tenant.shop.id, revokedReason: "STAFF_PASSWORD_CHANGED" },
      });
      assert.ok(revoked >= 1, "every active staff session should be revoked with an explicit reason");
      const audit = await ctx.db.auditLog.findFirst({
        where: { shopId: tenant.shop.id, action: "STAFF_UPDATED", entityId: staff.staff.id },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(audit, "the owner-sensitive edit must have a durable audit row");
      assert.match(audit.metadataJson || "", /"passwordChanged":true/);
      assert.match(audit.metadataJson || "", /"sessionsRevoked":true/);
      assert.doesNotMatch(audit.metadataJson || "", /NewStaffPass123/);
    });

    test("staff management cannot edit the owner account", async () => {
      const { tenant, ownerAuth } = await authPair();
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: { planCode: "pro" } });
      const response = assertFailure(await ctx.request("PATCH", `/api/auth/staff/${tenant.owner.id}`, {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        body: { name: "Unexpected owner rewrite" },
      }), 403);
      assert.equal(response.code, "OWNER_NOT_EDITABLE");
    });

    test("simultaneous staff invitations cannot exceed the plan seat limit", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: { planCode: "growth" } });

      const responses = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => authService.inviteStaff(
        tenant.shop.id,
        {
          name: `Concurrent Staff ${index + 1}`,
          mobile: String(9000000100 + index),
          password: "StaffPass123",
          role: "staff",
        },
        tenant.owner.id,
      )));

      const successes = responses.filter((response) => response.status === "fulfilled");
      const rejected = responses.filter((response) => response.status === "rejected");
      assert.equal(successes.length, 5, JSON.stringify(responses));
      assert.equal(rejected.length, 1, JSON.stringify(responses));
      assert.equal(rejected[0].reason?.code, "STAFF_LIMIT_EXCEEDED");
      assert.equal(rejected[0].reason?.meta?.staffCount, 5);
      assert.equal(rejected[0].reason?.meta?.maxStaff, 5);

      const [staffCount, auditCount] = await Promise.all([
        ctx.db.user.count({ where: { shopId: tenant.shop.id, role: { in: ["staff", "admin"] } } }),
        ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "STAFF_CREATED" } }),
      ]);
      assert.equal(staffCount, 5, "the database must contain no over-limit sixth seat");
      assert.equal(auditCount, 5, "each admitted seat must have exactly one durable audit row");
    });

    test("customer DELETE without owner PIN fails for staff", async () => {
      const { tenant, staffAuth } = await authPair();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      assertFailure(await ctx.delete(`/api/customers/${customer.id}`, { token: staffAuth.accessToken }), 403);
    });

    test("Owner PIN failures are audited and lock the caller across protected routes", async () => {
      const { tenant, staff, staffAuth } = await authPair();
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await ctx.delete("/api/customers/missing-customer", {
          token: staffAuth.accessToken,
          ownerPin: "9999",
        });
        assert.equal(response.status, attempt < 5 ? 403 : 429, JSON.stringify(response.body));
        if (attempt === 5) assert.equal(response.body?.code, "OWNER_PIN_LOCKED");
      }

      const failures = await ctx.db.auditLog.count({
        where: {
          shopId: tenant.shop.id,
          userId: staff.staff.id,
          action: "OWNER_PIN_VERIFICATION_FAILED",
        },
      });
      assert.equal(failures, 5);

      const lockedCorrectPin = await ctx.delete("/api/customers/missing-customer", {
        token: staffAuth.accessToken,
        ownerPin: tenant.ownerPin,
      });
      assert.equal(lockedCorrectPin.status, 429);
      assert.equal(lockedCorrectPin.body?.code, "OWNER_PIN_LOCKED");

      await ctx.db.auditLog.updateMany({
        where: { shopId: tenant.shop.id, action: "OWNER_PIN_VERIFICATION_FAILED" },
        data: { createdAt: new Date(Date.now() - 16 * 60_000) },
      });
      const afterLockout = await ctx.delete("/api/customers/missing-customer", {
        token: staffAuth.accessToken,
        ownerPin: tenant.ownerPin,
      });
      assert.equal(afterLockout.status, 404, "expired lockout must allow the correct PIN through to the controller");
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

    test("accounting control is shop-wide and owner-only", async () => {
      const { ownerAuth, staffAuth } = await authPair();
      assertFailure(await ctx.get("/api/accounting/control", { token: staffAuth.accessToken }), 403);
      const control = assertSuccess(await ctx.get("/api/accounting/control", { token: ownerAuth.accessToken }));
      assert.equal(control.scope, "shop");
      assert.equal(control.status, "no_data");
      assert.equal(control.calculationVersion, "accounting-control-v2");
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
