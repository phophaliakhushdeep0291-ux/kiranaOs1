// Role-based access, proved by signing in as each role and asking.
//
// rbac-catalogue.examples.js checks that the catalogue and the route guards are
// WRITTEN to agree. This asks the running API: the permissions a login is told
// it has, the view-only role refused every write it could reach — over REST and
// over offline sync — while still able to read and keep its session alive, and
// the owner able to hand out that role.
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { activateDeviceViaApi, billPayload, createProduct, createStaff, createTenant, customerPayload, login, uniqueMobile } from "./factories.js";
import { permissionsForRole } from "../../src/core/permissions/rbac.js";
import { canAddStaff } from "../../src/modules/feature-gates/featureGate.service.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("role access integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());

  describe("role-based access", () => {
    let tenant;
    let product;
    let viewerLogin;
    const auth = {};

    before(async () => {
      await resetDatabase(ctx.db);
      tenant = await createTenant(ctx.db, { shopName: "Role Access Shop" });
      const manager = await createStaff(ctx.db, tenant.shop.id, { role: "admin", name: "Manager User" });
      const cashier = await createStaff(ctx.db, tenant.shop.id, { role: "staff", name: "Cashier User" });
      const viewer = await createStaff(ctx.db, tenant.shop.id, { role: "viewer", name: "Viewer User" });
      viewerLogin = [viewer.staffMobile, viewer.staffPassword];
      auth.owner = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      auth.admin = await login(ctx, manager.staffMobile, manager.staffPassword);
      auth.staff = await login(ctx, cashier.staffMobile, cashier.staffPassword);
      auth.viewer = await login(ctx, viewer.staffMobile, viewer.staffPassword);
      product = await createProduct(ctx.db, tenant.shop.id, { name: "Role Test Tea", stockBaseQty: 40 });
    });

    test("every login is told the permissions its role holds", async () => {
      for (const role of ["owner", "admin", "staff", "viewer"]) {
        assert.equal(auth[role].user.role, role);
        assert.deepEqual(auth[role].user.permissions, permissionsForRole(role), `login as ${role}`);
        const me = assertSuccess(await ctx.get("/api/auth/me", { token: auth[role].accessToken }));
        assert.deepEqual(me.user.permissions, permissionsForRole(role), `/auth/me as ${role}`);
      }
    });

    test("a viewer can read the shop", async () => {
      const token = auth.viewer.accessToken;
      assertSuccess(await ctx.get("/api/products", { token }));
      assertSuccess(await ctx.get("/api/customers", { token }));
      assertSuccess(await ctx.get("/api/bills", { token }));
      assertSuccess(await ctx.get("/api/reports/sales-summary?range=today", { token }));
    });

    test("a viewer is refused every write over REST, and nothing lands", async () => {
      const token = auth.viewer.accessToken;
      const customersBefore = await ctx.db.customer.count({ where: { shopId: tenant.shop.id } });
      const billsBefore = await ctx.db.bill.count({ where: { shopId: tenant.shop.id } });

      const attempts = [
        ["POST", "/api/customers", customerPayload()],
        ["POST", "/api/bills/confirm", billPayload(product)],
        ["PATCH", `/api/products/${product.id}`, { name: "Renamed by viewer" }],
        ["POST", "/api/expenses", { category: "misc", amount: 10, mode: "cash" }],
        ["POST", "/api/ai/agent/confirm", { planId: "anything" }],
      ];
      for (const [method, url, body] of attempts) {
        const refused = assertFailure(await ctx.request(method, url, { token, body, ownerPin: tenant.ownerPin }), 403);
        assert.equal(refused.code, "ROLE_READ_ONLY", `${method} ${url}`);
      }

      assert.equal(await ctx.db.customer.count({ where: { shopId: tenant.shop.id } }), customersBefore);
      assert.equal(await ctx.db.bill.count({ where: { shopId: tenant.shop.id } }), billsBefore);
      assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })).name, "Role Test Tea");
    });

    test("a viewer's pushed sync events are each refused, not retried", async () => {
      // A session of its own: the earlier reads bound the first one to a device.
      const { accessToken: token } = await login(ctx, ...viewerLogin);
      const device = await activateDeviceViaApi(ctx, token, { deviceId: "viewer-counter" });
      const mobile = uniqueMobile();
      const pushed = assertSuccess(await ctx.post("/api/sync/push", { events: [{
        eventId: "viewer-create-customer",
        type: "CREATE_CUSTOMER",
        payload: { name: "Offline Viewer Customer", mobile, type: "regular" },
      }] }, { token, headers: { "x-device-id": device.deviceId } }));

      assert.equal(pushed.summary.failed, 1);
      assert.equal(pushed.results[0].code, "PERMISSION_DENIED");
      assert.equal(pushed.results[0].result?.retryable, false, "a refused role must park the row, not spend retries on it");
      assert.equal(await ctx.db.customer.count({ where: { shopId: tenant.shop.id, mobile } }), 0);
    });

    test("a viewer still keeps its own session alive", async () => {
      const token = auth.viewer.accessToken;
      const heartbeat = await ctx.post("/api/devices/heartbeat", {}, { token });
      assert.notEqual(heartbeat.body?.code, "ROLE_READ_ONLY", JSON.stringify(heartbeat.body));
      const pinCheck = await ctx.post("/api/auth/pin/verify", { pin: tenant.ownerPin }, { token });
      assert.notEqual(pinCheck.body?.code, "ROLE_READ_ONLY", "the lock screen unlocks with the owner PIN");
    });

    test("a cashier's counter work is unchanged", async () => {
      const token = auth.staff.accessToken;
      assertSuccess(await ctx.post("/api/customers", customerPayload(), { token }), 201);
      assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { quantity: 1 }), { token }), 201);
      assertFailure(await ctx.get("/api/reports/pnl?range=today", { token }), 403);
    });

    test("only the owner manages staff, and can hand out the view-only role", async () => {
      for (const role of ["admin", "staff", "viewer"]) {
        const refused = await ctx.get("/api/auth/staff", { token: auth[role].accessToken });
        assert.equal(refused.status, 403, `${role} must not list staff`);
      }

      const invited = assertSuccess(await ctx.request("POST", "/api/auth/staff", {
        token: auth.owner.accessToken,
        ownerPin: tenant.ownerPin,
        body: { name: "Accountant Aunty", mobile: uniqueMobile(), password: "ReadOnly123", role: "viewer" },
      }), 201);
      assert.equal(invited.role, "viewer");
      assert.deepEqual(invited.permissions, ["view_reports"]);

      const cashier = await createStaff(ctx.db, tenant.shop.id, { role: "staff", name: "Soon Read Only" });
      const openSession = await login(ctx, cashier.staffMobile, cashier.staffPassword);
      assertSuccess(await ctx.post("/api/customers", customerPayload(), { token: openSession.accessToken }), 201);

      const changed = assertSuccess(await ctx.request("PATCH", `/api/auth/staff/${cashier.staff.id}/role`, {
        token: auth.owner.accessToken,
        ownerPin: tenant.ownerPin,
        body: { role: "viewer" },
      }));
      assert.equal(changed.role, "viewer");

      // The downgrade reaches a session that was already open: the role is read
      // from the database on every request, never trusted from the token.
      const refused = assertFailure(await ctx.post("/api/customers", customerPayload(), { token: openSession.accessToken }), 403);
      assert.equal(refused.code, "ROLE_READ_ONLY");
      const me = assertSuccess(await ctx.get("/api/auth/me", { token: openSession.accessToken }));
      assert.deepEqual(me.user.permissions, ["view_reports"]);

      // A view-only login is still a person signed in to the shop, so it takes a seat.
      const seats = await canAddStaff(tenant.shop.id);
      const activeStaff = await ctx.db.user.count({ where: { shopId: tenant.shop.id, disabledAt: null, role: { not: "owner" } } });
      assert.equal(seats.staffCount, activeStaff);

      const ownerInvite = await ctx.request("POST", "/api/auth/staff", {
        token: auth.owner.accessToken,
        ownerPin: tenant.ownerPin,
        body: { name: "Second Owner", mobile: uniqueMobile(), password: "Owner12345", role: "owner" },
      });
      assert.equal(ownerInvite.status, 400, "owner is never a staff-screen role");
    });
  });
}
