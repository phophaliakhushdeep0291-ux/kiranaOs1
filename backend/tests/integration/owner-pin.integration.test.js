import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createTenant, login, uniqueMobile } from "./factories.js";

const ctx = await createIntegrationContext();
if (ctx.skip) {
  test("owner PIN integration unavailable", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  describe("owner PIN is not the login password", () => {
    test("changing the PIN changes only pinHash and records an audit", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const before = await ctx.db.user.findUniqueOrThrow({ where: { id: tenant.owner.id } });
      const credentials = { token: auth.accessToken };
      assertSuccess(await ctx.post("/api/auth/pin/set", { pin: "5678", currentPassword: tenant.ownerPassword }, credentials));
      const afterPin = await ctx.db.user.findUniqueOrThrow({ where: { id: tenant.owner.id } });
      assert.notEqual(afterPin.pinHash, before.pinHash);
      assert.equal(afterPin.passwordHash, before.passwordHash);
      assertSuccess(await ctx.post("/api/auth/pin/verify", { pin: "5678" }, credentials));
      assertFailure(await ctx.post("/api/auth/pin/verify", { pin: tenant.ownerPin }, credentials), 403);
      assert.equal((await login(ctx, tenant.ownerMobile, tenant.ownerPassword)).user.id, tenant.owner.id);
      assertFailure(await ctx.post("/api/auth/login", { mobile: tenant.ownerMobile, password: "5678" }), 401);
      const audits = await ctx.db.auditLog.findMany({ where: { shopId: tenant.shop.id, action: "PIN_CHANGED" } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].userId, tenant.owner.id);
      assert.ok(!JSON.stringify(audits).includes(tenant.ownerPassword));
      assert.ok(!JSON.stringify(audits).includes('"5678"'));
    });

    test("missing, wrong or PIN-as-password approval cannot change either credential", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const before = await ctx.db.user.findUniqueOrThrow({ where: { id: tenant.owner.id } });
      assertFailure(await ctx.post("/api/auth/pin/set", { pin: "5678" }, { token: auth.accessToken }), 400);
      for (const currentPassword of ["not-the-password", tenant.ownerPin]) {
        const result = assertFailure(await ctx.post("/api/auth/pin/set", { pin: "5678", currentPassword }, { token: auth.accessToken }), 403);
        assert.equal(result.code, "OWNER_REAUTH_FAILED");
      }
      const current = await ctx.db.user.findUniqueOrThrow({ where: { id: tenant.owner.id } });
      assert.equal(current.pinHash, before.pinHash);
      assert.equal(current.passwordHash, before.passwordHash);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "PIN_CHANGED" } }), 0);
    });

    test("first PIN setup still verifies the owner's password", async () => {
      const tenant = await createTenant(ctx.db);
      await ctx.db.user.update({ where: { id: tenant.owner.id }, data: { pinHash: null } });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      assertFailure(await ctx.post("/api/auth/pin/set", { pin: "1234", currentPassword: "wrong" }, { token: auth.accessToken }), 403);
      assertSuccess(await ctx.post("/api/auth/pin/set", { pin: "1234", currentPassword: tenant.ownerPassword }, { token: auth.accessToken }));
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "PIN_SET" } }), 1);
    });

    test("staff cannot change the owner PIN even with the owner's password", async () => {
      const tenant = await createTenant(ctx.db);
      const staff = await ctx.db.user.create({ data: { shopId: tenant.shop.id, name: "QA Staff", mobile: uniqueMobile(), role: "staff", passwordHash: tenant.owner.passwordHash } });
      const auth = await login(ctx, staff.mobile, tenant.ownerPassword);
      assertFailure(await ctx.post("/api/auth/pin/set", { pin: "5678", currentPassword: tenant.ownerPassword }, { token: auth.accessToken }), 403);
      assert.equal((await ctx.db.user.findUniqueOrThrow({ where: { id: tenant.owner.id } })).pinHash, tenant.owner.pinHash);
    });

    test("competing PIN changes cannot both use the same credential version", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      // Activate the test device before the concurrent requests so this tests
      // credential writes, not competing device registrations.
      assertSuccess(await ctx.get("/api/auth/pin/check", { token: auth.accessToken }));
      const responses = await Promise.all(["5678", "6789"].map((pin) => ctx.post("/api/auth/pin/set", {
        pin, currentPassword: tenant.ownerPassword,
      }, { token: auth.accessToken })));
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "PIN_CHANGED" } }), 1);
      assert.equal((await ctx.db.user.findUniqueOrThrow({ where: { id: tenant.owner.id } })).passwordHash, tenant.owner.passwordHash);
    });
  });
}
