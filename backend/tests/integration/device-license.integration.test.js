import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("device license integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { planCode: null });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, ownerAuth };
  }

  describe("device license integration", () => {
    test("device activation returns a signed license payload", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const device = assertSuccess(await ctx.post("/api/devices/activate", { deviceId: "license-device-1", deviceName: "Counter" }, { token: ownerAuth.accessToken }), 201);
      assert.equal(device.deviceId, "license-device-1");
      assert.equal(device.license.payload.deviceId, "license-device-1");
      assert.equal(device.license.payload.planCode, "starter");
      assert.equal(device.license.algorithm, "HMAC-SHA256");
    });

    test("existing active device activation is idempotent", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const first = await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "same-device" });
      const second = assertSuccess(await ctx.post("/api/devices/activate", { deviceId: "same-device", deviceName: "Same" }, { token: ownerAuth.accessToken }), 201);
      assert.equal(first.id, second.id);
      assert.equal(second.idempotent, true);
    });

    test("removed device loses access immediately and cannot silently rejoin", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "removed-device" });
      assertSuccess(await ctx.request("DELETE", "/api/devices/removed-device", {
        token: ownerAuth.accessToken,
        ownerPin: tenant.ownerPin,
        headers: { "x-device-id": "removed-device" },
        body: { removeCurrentDevice: true },
      }));
      const license = assertFailure(await ctx.get("/api/devices/license?deviceId=removed-device", { token: ownerAuth.accessToken, headers: { "x-device-id": "removed-device" } }), 401);
      assert.equal(license.code, "SESSION_INACTIVE");
      const sync = assertFailure(await ctx.get(`/api/sync/pull?since=${encodeURIComponent(new Date(0).toISOString())}`, { token: ownerAuth.accessToken, headers: { "x-device-id": "removed-device" } }), 401);
      assert.equal(sync.code, "SESSION_INACTIVE");
    });

    test("blocked device cannot get active license", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "blocked-device" });
      assertSuccess(await ctx.post("/api/devices/blocked-device/block", {}, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      const blocked = assertFailure(await ctx.get("/api/devices/license?deviceId=blocked-device", { token: ownerAuth.accessToken, headers: { "x-device-id": "blocked-device" } }), 401);
      assert.equal(blocked.code, "SESSION_INACTIVE");
    });

    test("sync requires device id", async () => {
      const { ownerAuth } = await ownerCtx();
      const response = assertFailure(await ctx.get(`/api/sync/pull?since=${encodeURIComponent(new Date(0).toISOString())}`, { token: ownerAuth.accessToken }), 400);
      assert.equal(response.code, "DEVICE_REQUIRED");
    });

    test("license reflects current subscription plan", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "plan-device" });
      assertSuccess(await ctx.post("/api/subscription/manual-activate", { planCode: "pro", period: "monthly" }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      const license = assertSuccess(await ctx.get("/api/devices/license?deviceId=plan-device", { token: ownerAuth.accessToken, headers: { "x-device-id": "plan-device" } }));
      assert.equal(license.payload.planCode, "pro");
      assert.equal(license.payload.maxDevices, 10);
      assert.ok(license.payload.features.includes("whatsapp_reminders"));
    });
  });
}
