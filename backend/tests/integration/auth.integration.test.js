import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createTenant, login, uniqueMobile } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("auth integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  describe("auth integration", () => {
    test("register creates shop + owner", async () => {
      const mobile = uniqueMobile();
      const response = await ctx.post("/api/auth/register", {
        shopName: "QA Kirana Store",
        ownerName: "QA Owner",
        city: "Jodhpur",
        address: "QA Integration Street",
        mobile,
        password: "Password123",
      });

      const data = assertSuccess(response, 201);
      assert.ok(data.accessToken);
      assert.ok(data.refreshToken);
      assert.equal(data.user.role, "owner");
      assert.equal(data.user.mobile, mobile);

      const shop = await ctx.db.shop.findUnique({ where: { id: data.shop.id } });
      const owner = await ctx.db.user.findFirst({ where: { shopId: data.shop.id, mobile } });
      assert.ok(shop);
      assert.ok(owner);
      assert.equal(owner.role, "owner");
      assert.ok(owner.passwordHash);
    });

    test("login works for single-shop mobile", async () => {
      const tenant = await createTenant(ctx.db);
      const data = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      assert.equal(data.user.id, tenant.owner.id);
      assert.equal(data.shop.id, tenant.shop.id);
      assert.ok(data.accessToken);
    });

    test("login with wrong password fails", async () => {
      const tenant = await createTenant(ctx.db);
      const response = await ctx.post("/api/auth/login", {
        mobile: tenant.ownerMobile,
        password: "WrongPassword123",
      });
      assertFailure(response, 401);
    });

    test("refresh token/session flow works", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);

      const response = await ctx.post("/api/auth/refresh", { refreshToken: auth.refreshToken });
      const refreshed = assertSuccess(response);
      assert.ok(refreshed.accessToken);
      assert.ok(refreshed.refreshToken);
      assert.notEqual(refreshed.refreshToken, auth.refreshToken);
    });

    test("logout revokes refresh session", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);

      assertSuccess(await ctx.post("/api/auth/logout", { refreshToken: auth.refreshToken }));
      const sessionId = auth.refreshToken.split(".")[0];
      const session = await ctx.db.session.findUnique({ where: { id: sessionId } });
      assert.ok(session.revokedAt);

      assertFailure(await ctx.post("/api/auth/refresh", { refreshToken: auth.refreshToken }), 401);
    });

    test("login and logout session changes roll back when required auth auditing fails", async () => {
      const tenant = await createTenant(ctx.db);
      const registrationMobile = uniqueMobile();
      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_registration_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'SHOP_REGISTERED'
        BEGIN
          SELECT RAISE(ABORT, 'forced registration audit failure');
        END;
      `);
      let failedRegistrationAudit;
      try {
        failedRegistrationAudit = await ctx.post("/api/auth/register", {
          shopName: "Atomic Registration Audit",
          ownerName: "Atomic Owner",
          city: "Jodhpur",
          address: "Atomic test address",
          mobile: registrationMobile,
          password: "Password123",
        });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_registration_audit_failure");
      }
      assert.equal(assertFailure(failedRegistrationAudit, 503).code, "AUTH_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.shop.count({ where: { name: "Atomic Registration Audit" } }), 0);
      assert.equal(await ctx.db.user.count({ where: { mobile: registrationMobile } }), 0);

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_login_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'LOGIN'
        BEGIN
          SELECT RAISE(ABORT, 'forced login audit failure');
        END;
      `);
      let failedLogin;
      try {
        const loginAuditRegistrationMobile = uniqueMobile();
        const failedFirstSession = await ctx.post("/api/auth/register", {
          shopName: "Atomic First Session",
          ownerName: "Atomic Owner",
          city: "Jodhpur",
          address: "Atomic test address",
          mobile: loginAuditRegistrationMobile,
          password: "Password123",
        });
        assert.equal(assertFailure(failedFirstSession, 503).code, "AUTH_AUDIT_WRITE_FAILED");
        assert.equal(await ctx.db.shop.count({ where: { name: "Atomic First Session" } }), 0);
        assert.equal(await ctx.db.user.count({ where: { mobile: loginAuditRegistrationMobile } }), 0);
        failedLogin = await ctx.post("/api/auth/login", {
          mobile: tenant.ownerMobile,
          password: tenant.ownerPassword,
        });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_login_audit_failure");
      }
      assert.equal(assertFailure(failedLogin, 503).code, "AUTH_AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.session.count({ where: { shopId: tenant.shop.id } }), 0);

      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const sessionId = auth.refreshToken.split(".")[0];
      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_logout_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action = 'LOGOUT'
        BEGIN
          SELECT RAISE(ABORT, 'forced logout audit failure');
        END;
      `);
      let failedLogout;
      try {
        failedLogout = await ctx.post("/api/auth/logout", { refreshToken: auth.refreshToken });
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_logout_audit_failure");
      }
      assert.equal(assertFailure(failedLogout, 503).code, "AUTH_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.session.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt, null);
      assertSuccess(await ctx.post("/api/auth/refresh", { refreshToken: auth.refreshToken }));
    });

    test("protected route rejects missing token", async () => {
      const response = await ctx.get("/api/auth/me");
      assertFailure(response, 401);
    });

    test("protected route accepts valid token", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const data = assertSuccess(await ctx.get("/api/auth/me", { token: auth.accessToken }));
      assert.equal(data.user.id, tenant.owner.id);
      assert.equal(data.shop.id, tenant.shop.id);
    });

    test("multi-shop same mobile requires explicit shop selection", async () => {
      const mobile = uniqueMobile();
      const first = await createTenant(ctx.db, { ownerMobile: mobile, shopName: "Shop A" });
      const second = await createTenant(ctx.db, {
        ownerMobile: mobile,
        password: first.ownerPassword,
        shopName: "Shop B",
      });

      const ambiguous = await ctx.post("/api/auth/login", { mobile, password: second.ownerPassword });
      assert.equal(ambiguous.status, 409, JSON.stringify(ambiguous.body));
      assert.match(ambiguous.body?.error || "", /shop/i);
      assert.equal(ambiguous.body?.code, "SHOP_SELECTION_REQUIRED");
      assert.deepEqual(
        ambiguous.body?.shops?.map((shop) => shop.id),
        [first.shop.id, second.shop.id]
      );

      const selected = assertSuccess(
        await ctx.post("/api/auth/login", { mobile, password: second.ownerPassword, shopId: second.shop.id })
      );
      assert.equal(selected.shop.id, second.shop.id);
    });

    test("multi-shop login only offers shops matching the submitted password", async () => {
      const mobile = uniqueMobile();
      const first = await createTenant(ctx.db, { ownerMobile: mobile, password: "Password-A123", shopName: "Shop A" });
      const second = await createTenant(ctx.db, { ownerMobile: mobile, password: "Password-B123", shopName: "Shop B" });

      const selectedDirectly = assertSuccess(
        await ctx.post("/api/auth/login", { mobile, password: second.ownerPassword })
      );
      assert.equal(selectedDirectly.shop.id, second.shop.id);

      const wrongPassword = await ctx.post("/api/auth/login", { mobile, password: "Password-C123" });
      assertFailure(wrongPassword, 401);
      assert.equal(wrongPassword.body?.shops, undefined);
      assert.notEqual(selectedDirectly.shop.id, first.shop.id);
    });

    test("revoked session behavior is enforced for refresh", async () => {
      const tenant = await createTenant(ctx.db);
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      await ctx.post("/api/auth/logout", { refreshToken: auth.refreshToken });
      const response = await ctx.post("/api/auth/refresh", { refreshToken: auth.refreshToken });
      assertFailure(response, 401);
    });
  });
}
