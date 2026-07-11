import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createTenant } from "./factories.js";

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
