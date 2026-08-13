import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createStaff, createTenant } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("device-session slot integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  function metadata(deviceId, deviceName = deviceId) {
    return {
      deviceId,
      deviceName,
      deviceType: "laptop",
      operatingSystem: "Test OS",
      browser: "Test Browser",
      platform: "web",
      appVersion: "integration",
    };
  }

  async function loginDevice(tenant, deviceId, options = {}) {
    return ctx.post("/api/auth/login", {
      mobile: tenant.ownerMobile,
      password: tenant.ownerPassword,
      device: metadata(deviceId, options.deviceName),
    }, {
      headers: {
        "x-device-id": deviceId,
        "x-device-name": options.deviceName || deviceId,
        "x-device-type": "laptop",
      },
      autoDevice: false,
    });
  }

  describe("registered device slots and bound sessions", () => {
    test("repeated login on the same installation reuses one registered slot", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });

      const first = assertSuccess(await loginDevice(tenant, "device-a", { deviceName: "Owner Laptop" }));
      const second = assertSuccess(await loginDevice(tenant, "device-a", { deviceName: "Owner Laptop" }));

      assert.notEqual(first.refreshToken, second.refreshToken);
      assert.equal(await ctx.db.device.count({ where: { shopId: tenant.shop.id } }), 1);
      assert.equal(await ctx.db.session.count({ where: { shopId: tenant.shop.id, deviceId: "device-a", revokedAt: null } }), 2);
    });

    test("the header device id is canonical and malformed ids never create a session", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const body = {
        mobile: tenant.ownerMobile,
        password: tenant.ownerPassword,
        device: metadata("body-device"),
      };

      const malformed = assertFailure(await ctx.post("/api/auth/login", body, {
        headers: { "x-device-id": "x" },
        autoDevice: false,
      }), 400);
      assert.equal(malformed.code, "DEVICE_ID_INVALID");
      assert.equal(await ctx.db.device.count({ where: { shopId: tenant.shop.id } }), 0);
      assert.equal(await ctx.db.session.count({ where: { shopId: tenant.shop.id } }), 0);

      assertSuccess(await ctx.post("/api/auth/login", body, {
        headers: { "x-device-id": "header-device" },
        autoDevice: false,
      }));
      assert.ok(await ctx.db.device.findUnique({
        where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "header-device" } },
      }));
      assert.equal(await ctx.db.device.findUnique({
        where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "body-device" } },
      }), null);
    });

    test("normal logout keeps the registered slot and the same device can sign in again", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const first = assertSuccess(await loginDevice(tenant, "device-a"));
      assertSuccess(await loginDevice(tenant, "device-b"));

      assertSuccess(await ctx.post("/api/auth/logout", { refreshToken: first.refreshToken }, {
        headers: { "x-device-id": "device-a" },
        autoDevice: false,
      }));
      const loggedOut = await ctx.db.device.findUnique({ where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "device-a" } } });
      assert.equal(loggedOut.status, "logged_out");

      const overLimit = assertFailure(await loginDevice(tenant, "device-c"), 403);
      assert.equal(overLimit.code, "DEVICE_LIMIT_EXCEEDED");

      assertSuccess(await loginDevice(tenant, "device-a"));
      assert.equal(await ctx.db.device.count({ where: { shopId: tenant.shop.id } }), 2);
    });

    test("normal logout revokes only the presented session while another login remains active", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const first = assertSuccess(await loginDevice(tenant, "shared-device"));
      const second = assertSuccess(await loginDevice(tenant, "shared-device"));

      const firstLogout = assertSuccess(await ctx.post("/api/auth/logout", { refreshToken: first.refreshToken }, {
        headers: { "x-device-id": "shared-device" },
        autoDevice: false,
      }));
      assert.equal(firstLogout.revokedSessions, 1);
      assert.equal(firstLogout.remainingDeviceSessions, 1);
      assert.equal(firstLogout.deviceStatus, "active");
      assert.equal(await ctx.db.session.count({
        where: { shopId: tenant.shop.id, deviceId: "shared-device", revokedAt: null },
      }), 1);
      assert.equal((await ctx.db.device.findUnique({
        where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "shared-device" } },
      })).status, "active");

      assertSuccess(await ctx.get("/api/auth/me", {
        token: second.accessToken,
        headers: { "x-device-id": "shared-device" },
        autoDevice: false,
      }));
      assertSuccess(await ctx.post("/api/auth/logout", { refreshToken: second.refreshToken }, {
        headers: { "x-device-id": "shared-device" },
        autoDevice: false,
      }));
      assert.equal((await ctx.db.device.findUnique({
        where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "shared-device" } },
      })).status, "logged_out");
    });

    test("owner device logout revokes every session and increments the session version", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const targetFirst = assertSuccess(await loginDevice(tenant, "device-target"));
      assertSuccess(await loginDevice(tenant, "device-target"));
      const manager = assertSuccess(await loginDevice(tenant, "device-manager"));
      const before = await ctx.db.device.findUnique({
        where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "device-target" } },
      });

      const result = assertSuccess(await ctx.post("/api/devices/logout-device", {
        deviceId: "device-target",
        currentDeviceId: "device-manager",
      }, {
        token: manager.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-manager" },
        autoDevice: false,
      }));
      assert.equal(result.revokedSessions, 2);
      const after = await ctx.db.device.findUnique({
        where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "device-target" } },
      });
      assert.equal(after.status, "logged_out");
      assert.equal(after.sessionVersion, before.sessionVersion + 1);
      assert.equal(await ctx.db.session.count({
        where: { shopId: tenant.shop.id, deviceId: "device-target", revokedAt: null },
      }), 0);
      const revoked = assertFailure(await ctx.get("/api/auth/me", {
        token: targetFirst.accessToken,
        headers: { "x-device-id": "device-target" },
        autoDevice: false,
      }), 401);
      assert.ok(["SESSION_INACTIVE", "DEVICE_SESSION_REVOKED"].includes(revoked.code));
    });

    test("simultaneous logins for the final slots cannot over-register the plan", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const responses = await Promise.all([
        loginDevice(tenant, "concurrent-a"),
        loginDevice(tenant, "concurrent-b"),
        loginDevice(tenant, "concurrent-c"),
      ]);

      assert.equal(responses.filter((response) => response.status === 200).length, 2);
      assert.equal(responses.filter((response) => response.body?.code === "DEVICE_LIMIT_EXCEEDED").length, 1);
      assert.equal(await ctx.db.device.count({
        where: { shopId: tenant.shop.id, status: { in: ["active", "logged_out", "blocked"] } },
      }), 2);
    });

    test("plan downgrade keeps existing devices, reports over-limit, blocks new slots, and allows retry after upgrade", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "growth" });
      const deviceA = assertSuccess(await loginDevice(tenant, "device-a"));
      assertSuccess(await loginDevice(tenant, "device-b"));
      assertSuccess(await loginDevice(tenant, "device-c"));

      await ctx.db.subscription.update({
        where: { shopId: tenant.shop.id },
        data: { planCode: "starter" },
      });

      const snapshot = assertSuccess(await ctx.get("/api/devices", {
        token: deviceA.accessToken,
        headers: { "x-device-id": "device-a" },
        autoDevice: false,
      }));
      assert.equal(snapshot.plan.deviceLimit, 2);
      assert.equal(snapshot.devicesUsed, 3);
      assert.equal(snapshot.remainingSlots, 0);
      assert.equal(snapshot.overLimit, true);
      assert.equal(snapshot.devices.filter((device) => device.status === "active").length, 3);

      assertSuccess(await loginDevice(tenant, "device-a"));
      const denied = assertFailure(await loginDevice(tenant, "device-d"), 403);
      assert.equal(denied.code, "DEVICE_LIMIT_EXCEEDED");
      assert.equal(denied.registeredDeviceCount, 3);
      assert.equal(await ctx.db.device.count({
        where: { shopId: tenant.shop.id, status: { in: ["active", "logged_out", "blocked"] } },
      }), 3);

      await ctx.db.subscription.update({
        where: { shopId: tenant.shop.id },
        data: { planCode: "pro" },
      });
      assertSuccess(await loginDevice(tenant, "device-d"));
      assert.equal(await ctx.db.device.count({
        where: { shopId: tenant.shop.id, status: { in: ["active", "logged_out", "blocked"] } },
      }), 4);
    });

    test("expired subscriptions keep account access for renewal but block cloud sync", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      assertSuccess(await loginDevice(tenant, "device-a"));
      const expiredAt = new Date(Date.now() - 60_000);
      await ctx.db.subscription.update({
        where: { shopId: tenant.shop.id },
        data: { status: "expired", currentPeriodEnd: expiredAt, graceEndsAt: expiredAt },
      });

      const renewedLogin = assertSuccess(await loginDevice(tenant, "device-a"));
      const syncStatus = assertSuccess(await ctx.get("/api/sync/status", {
        token: renewedLogin.accessToken,
        headers: { "x-device-id": "device-a" },
        autoDevice: false,
      }));
      assert.equal(syncStatus.allowed, false);
      assert.equal(syncStatus.reason, "subscription_inactive");

      const blockedPush = assertFailure(await ctx.post("/api/sync/push", { events: [] }, {
        token: renewedLogin.accessToken,
        headers: { "x-device-id": "device-a" },
        autoDevice: false,
      }), 402);
      assert.equal(blockedPush.code, "SYNC_SUBSCRIPTION_INACTIVE");
    });

    test("staff and cross-shop owners cannot manage another shop device", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "growth" });
      const owner = assertSuccess(await loginDevice(tenant, "owner-device"));
      const staffIdentity = await createStaff(ctx.db, tenant.shop.id);
      const staff = assertSuccess(await ctx.post("/api/auth/login", {
        mobile: staffIdentity.staffMobile,
        password: staffIdentity.staffPassword,
        device: metadata("staff-device"),
      }, { headers: { "x-device-id": "staff-device" }, autoDevice: false }));

      const staffDenied = assertFailure(await ctx.delete("/api/devices/owner-device", {
        token: staff.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "staff-device" },
        autoDevice: false,
      }), 403);
      assert.equal(staffDenied.code, "FORBIDDEN");

      const otherTenant = await createTenant(ctx.db, { planCode: "starter" });
      const otherOwner = assertSuccess(await loginDevice(otherTenant, "other-owner-device"));
      const crossShop = assertFailure(await ctx.delete("/api/devices/owner-device", {
        token: otherOwner.accessToken,
        ownerPin: otherTenant.ownerPin,
        headers: { "x-device-id": "other-owner-device" },
        autoDevice: false,
      }), 404);
      assert.equal(crossShop.code, "DEVICE_NOT_FOUND");

      assertSuccess(await ctx.get("/api/auth/me", {
        token: owner.accessToken,
        headers: { "x-device-id": "owner-device" },
        autoDevice: false,
      }));
    });

    test("owner-PIN replacement is one-use and immediately revokes the old device", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const deviceA = assertSuccess(await loginDevice(tenant, "device-a", { deviceName: "Old Laptop" }));
      const deviceB = assertSuccess(await loginDevice(tenant, "device-b", { deviceName: "Counter" }));
      const denied = assertFailure(await loginDevice(tenant, "device-c", { deviceName: "New Laptop" }), 403);

      assert.equal(denied.code, "DEVICE_LIMIT_EXCEEDED");
      assert.ok(denied.replacementToken);
      assert.equal(denied.devices.length, 2);
      const replacement = assertSuccess(await ctx.post("/api/auth/device-replacement/complete", {
        replacementToken: denied.replacementToken,
        targetDeviceId: "device-a",
        ownerPin: tenant.ownerPin,
      }, {
        headers: { "x-device-id": "device-c" },
        autoDevice: false,
      }));

      assert.equal(replacement.replacement.removedDeviceName, "Old Laptop");
      const rows = await ctx.db.device.findMany({ where: { shopId: tenant.shop.id }, orderBy: { deviceId: "asc" } });
      assert.equal(rows.find((row) => row.deviceId === "device-a").status, "revoked");
      assert.equal(rows.find((row) => row.deviceId === "device-c").status, "active");
      assert.equal(rows.filter((row) => ["active", "logged_out", "blocked"].includes(row.status)).length, 2);

      const oldAccess = assertFailure(await ctx.get("/api/auth/me", {
        token: deviceA.accessToken,
        headers: { "x-device-id": "device-a" },
        autoDevice: false,
      }), 401);
      assert.ok(["SESSION_INACTIVE", "DEVICE_SESSION_REVOKED"].includes(oldAccess.code));
      const oldRefresh = assertFailure(await ctx.post("/api/auth/refresh", { refreshToken: deviceA.refreshToken }, {
        headers: { "x-device-id": "device-a" },
        autoDevice: false,
      }), 401);
      assert.ok(["UNAUTHORIZED", "DEVICE_SESSION_REVOKED"].includes(oldRefresh.code));
      assertSuccess(await ctx.get("/api/auth/me", {
        token: replacement.accessToken,
        headers: { "x-device-id": "device-c" },
        autoDevice: false,
      }));

      const replay = assertFailure(await ctx.post("/api/auth/device-replacement/complete", {
        replacementToken: denied.replacementToken,
        targetDeviceId: "device-b",
        ownerPin: tenant.ownerPin,
      }, { headers: { "x-device-id": "device-c" }, autoDevice: false }), 401);
      assert.equal(replay.code, "DEVICE_REPLACEMENT_TOKEN_EXPIRED");

      // Keep the second device token used so the test also proves replacement did
      // not revoke unrelated installations.
      assertSuccess(await ctx.get("/api/auth/me", {
        token: deviceB.accessToken,
        headers: { "x-device-id": "device-b" },
        autoDevice: false,
      }));
    });

    test("device list is safe and current-device removal requires the explicit flow", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const current = assertSuccess(await loginDevice(tenant, "device-current", { deviceName: "Owner MacBook" }));

      const snapshot = assertSuccess(await ctx.get("/api/devices", {
        token: current.accessToken,
        headers: { "x-device-id": "device-current" },
        autoDevice: false,
      }));
      assert.equal(snapshot.devices[0].isCurrentDevice, true);
      for (const key of ["userAgent", "lastIpAddress", "fingerprintHash", "refreshTokenHash"]) {
        assert.equal(Object.hasOwn(snapshot.devices[0], key), false, `${key} must not be exposed`);
      }

      const normalRemove = assertFailure(await ctx.delete("/api/devices/device-current", {
        token: current.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-current" },
        autoDevice: false,
      }), 400);
      assert.equal(normalRemove.code, "CURRENT_DEVICE_REMOVE_REQUIRES_LOGOUT");

      const explicit = assertSuccess(await ctx.request("DELETE", "/api/devices/device-current", {
        token: current.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-current" },
        body: { removeCurrentDevice: true },
        autoDevice: false,
      }));
      assert.equal(explicit.removedCurrentDevice, true);
      const revoked = assertFailure(await ctx.get("/api/auth/me", {
        token: current.accessToken,
        headers: { "x-device-id": "device-current" },
        autoDevice: false,
      }), 401);
      assert.ok(["SESSION_INACTIVE", "DEVICE_SESSION_REVOKED"].includes(revoked.code));
    });

    test("blocked device cannot use access or refresh tokens", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const target = assertSuccess(await loginDevice(tenant, "device-target"));
      const manager = assertSuccess(await loginDevice(tenant, "device-manager"));

      assertSuccess(await ctx.post("/api/devices/device-target/block", {}, {
        token: manager.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-manager" },
        autoDevice: false,
      }));
      const access = await ctx.get("/api/auth/me", {
        token: target.accessToken,
        headers: { "x-device-id": "device-target" },
        autoDevice: false,
      });
      assert.equal(access.status, 401);
      const refresh = await ctx.post("/api/auth/refresh", { refreshToken: target.refreshToken }, {
        headers: { "x-device-id": "device-target" },
        autoDevice: false,
      });
      assert.equal(refresh.status, 401);
    });

    test("reactivating a blocked device retains its slot and only restores that installation", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      assertSuccess(await loginDevice(tenant, "device-target"));
      const manager = assertSuccess(await loginDevice(tenant, "device-manager"));

      assertSuccess(await ctx.post("/api/devices/device-target/block", {}, {
        token: manager.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-manager" },
        autoDevice: false,
      }));
      const blockedSnapshot = assertSuccess(await ctx.get("/api/devices", {
        token: manager.accessToken,
        headers: { "x-device-id": "device-manager" },
        autoDevice: false,
      }));
      assert.equal(blockedSnapshot.devicesUsed, 2);

      const reactivated = assertSuccess(await ctx.post("/api/devices/device-target/reactivate", {}, {
        token: manager.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-manager" },
        autoDevice: false,
      }));
      assert.equal(reactivated.status, "logged_out");
      const reactivatedSnapshot = assertSuccess(await ctx.get("/api/devices", {
        token: manager.accessToken,
        headers: { "x-device-id": "device-manager" },
        autoDevice: false,
      }));
      assert.equal(reactivatedSnapshot.devicesUsed, 2);

      const unrelated = assertFailure(await loginDevice(tenant, "device-unrelated"), 403);
      assert.equal(unrelated.code, "DEVICE_LIMIT_EXCEEDED");

      assertSuccess(await loginDevice(tenant, "device-target"));
      assert.equal(await ctx.db.device.count({ where: { shopId: tenant.shop.id } }), 2);
      assert.equal(await ctx.db.device.count({
        where: { shopId: tenant.shop.id, status: { in: ["active", "logged_out", "blocked"] } },
      }), 2);
    });

    test("device management rolls back sessions, licences and device state when auditing fails", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const target = assertSuccess(await loginDevice(tenant, "device-audit-target", { deviceName: "Target device" }));
      const manager = assertSuccess(await loginDevice(tenant, "device-audit-manager", { deviceName: "Manager device" }));
      assertSuccess(await ctx.post("/api/devices/activate", metadata("device-audit-target", "Target device"), {
        token: target.accessToken,
        headers: { "x-device-id": "device-audit-target" },
        autoDevice: false,
      }), 201);
      const approved = {
        token: manager.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "device-audit-manager" },
        autoDevice: false,
      };

      async function failAudit(action, operation) {
        const triggerName = `force_${action.toLowerCase()}_failure`;
        await ctx.db.$executeRawUnsafe(`
          CREATE TRIGGER ${triggerName}
          BEFORE INSERT ON AuditLog
          WHEN NEW.action = '${action}'
          BEGIN
            SELECT RAISE(ABORT, 'forced device audit failure');
          END;
        `);
        try { return await operation(); }
        finally { await ctx.db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName}`); }
      }

      const failedRename = assertFailure(await failAudit("DEVICE_RENAMED", () => ctx.patch(
        "/api/devices/device-audit-target",
        { deviceName: "Should roll back" },
        approved,
      )), 503);
      assert.equal(failedRename.code, "DEVICE_AUDIT_WRITE_FAILED");
      let stored = await ctx.db.device.findUniqueOrThrow({ where: { shopId_deviceId: { shopId: tenant.shop.id, deviceId: "device-audit-target" } } });
      assert.equal(stored.deviceName, "Target device");

      const failedBlock = assertFailure(await failAudit("DEVICE_BLOCKED", () => ctx.post(
        "/api/devices/device-audit-target/block",
        {},
        approved,
      )), 503);
      assert.equal(failedBlock.code, "DEVICE_AUDIT_WRITE_FAILED");
      stored = await ctx.db.device.findUniqueOrThrow({ where: { id: stored.id } });
      assert.equal(stored.status, "active");
      assert.equal(await ctx.db.session.count({ where: { shopId: tenant.shop.id, deviceId: "device-audit-target", revokedAt: null } }), 1);
      assert.equal(await ctx.db.deviceLicense.count({ where: { shopId: tenant.shop.id, deviceId: "device-audit-target", revokedAt: null } }), 1);

      assertSuccess(await ctx.post("/api/devices/device-audit-target/block", {}, approved));
      const failedReactivate = assertFailure(await failAudit("DEVICE_REACTIVATED", () => ctx.post(
        "/api/devices/device-audit-target/reactivate",
        {},
        approved,
      )), 503);
      assert.equal(failedReactivate.code, "DEVICE_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.device.findUniqueOrThrow({ where: { id: stored.id } })).status, "blocked");

      assertSuccess(await ctx.post("/api/devices/device-audit-target/reactivate", {}, approved));
      const reloggedTarget = assertSuccess(await loginDevice(tenant, "device-audit-target"));
      assertSuccess(await ctx.post("/api/devices/activate", metadata("device-audit-target", "Target device"), {
        token: reloggedTarget.accessToken,
        headers: { "x-device-id": "device-audit-target" },
        autoDevice: false,
      }), 201);
      const failedRemove = assertFailure(await failAudit("DEVICE_REMOVED", () => ctx.delete(
        "/api/devices/device-audit-target",
        approved,
      )), 503);
      assert.equal(failedRemove.code, "DEVICE_AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.device.findUniqueOrThrow({ where: { id: stored.id } })).status, "active");
      assert.equal(await ctx.db.session.count({ where: { shopId: tenant.shop.id, deviceId: "device-audit-target", revokedAt: null } }), 1);
      assert.equal(await ctx.db.deviceLicense.count({ where: { shopId: tenant.shop.id, deviceId: "device-audit-target", revokedAt: null } }), 1);
      assertSuccess(await ctx.get("/api/auth/me", {
        token: reloggedTarget.accessToken,
        headers: { "x-device-id": "device-audit-target" },
        autoDevice: false,
      }));
    });

    test("concurrent refresh-token reuse revokes the token family", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "starter" });
      const signedIn = assertSuccess(await loginDevice(tenant, "refresh-device"));
      const requestRefresh = () => ctx.post("/api/auth/refresh", { refreshToken: signedIn.refreshToken }, {
        headers: { "x-device-id": "refresh-device" },
        autoDevice: false,
      });

      const attempts = await Promise.all([requestRefresh(), requestRefresh()]);
      assert.equal(attempts.filter((response) => response.status === 200).length, 1);
      assert.equal(attempts.filter((response) => response.body?.code === "REFRESH_TOKEN_REUSED").length, 1);
      assert.equal(await ctx.db.session.count({
        where: { shopId: tenant.shop.id, deviceId: "refresh-device", revokedAt: null },
      }), 0);
    });
  });
}
