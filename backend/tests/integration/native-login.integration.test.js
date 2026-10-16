import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant } from "./factories.js";

process.env.GOOGLE_CLIENT_ID = "native-login-test.apps.googleusercontent.com";
const ctx = await createIntegrationContext();
const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const realFetch = globalThis.fetch;
globalThis.fetch = (url, options) => String(url) === "https://www.googleapis.com/oauth2/v1/certs"
  ? Promise.resolve(Response.json({ "native-test-key": pair.publicKey.export({ type: "spki", format: "pem" }) }, { headers: { "cache-control": "max-age=3600" } }))
  : realFetch(url, options);
after(async () => {
  globalThis.fetch = realFetch;
  if (!ctx.skip) await ctx.close();
  const { closeNativeLoginStore } = await import("../../src/modules/auth/native-login.store.js");
  closeNativeLoginStore();
});
if (ctx.skip) test("native sign-in database proof", { skip: ctx.reason }, () => {});
else {
  beforeEach(async () => resetDatabase(ctx.db));
  const deviceId = "native-google-integration-device";
  const headers = { "x-device-id": deviceId };
  const post = (action, body, customHeaders = headers) => ctx.post(`/api/auth/native/${action}`, body, { headers: customHeaders });
  async function prepare(email = "native-owner@example.test") {
    const tenant = await createTenant(ctx.db);
    await ctx.db.user.update({ where: { id: tenant.owner.id }, data: { email } });
    const verifier = crypto.randomBytes(32).toString("base64url");
    const request = assertSuccess(await post("start", { verifier, device: { deviceId, deviceName: "Test Mac" } }));
    const info = assertSuccess(await post("inspect", { requestId: request.requestId }));
    const credential = nonce => jwt.sign({ sub: "native-google-sub", email, email_verified: true, nonce }, pair.privateKey, { algorithm: "RS256", keyid: "native-test-key", audience: process.env.GOOGLE_CLIENT_ID, issuer: "https://accounts.google.com", expiresIn: "5m" });
    return { tenant, request, info, credential, proof: { requestId: request.requestId, verifier } };
  }
  test("real Google signature verification hands one device-bound session to the app, not the browser", async () => {
    const flow = await prepare();
    assertFailure(await post("approve", { requestId: flow.request.requestId, userCode: flow.request.userCode, credential: flow.credential("wrong-nonce") }), 401);
    assertSuccess(await post("approve", { requestId: flow.request.requestId, userCode: flow.request.userCode, credential: flow.credential(flow.info.nonce) }, { "x-device-id": "approval-browser" }));
    assert.equal(await ctx.db.session.count(), 0);
    assertFailure(await post("poll", flow.proof, { "x-device-id": "wrong-device" }), 403);
    const attempts = await Promise.all([post("poll", flow.proof), post("poll", flow.proof)]);
    assert.equal(attempts.filter(attempt => attempt.status === 200).length, 1);
    assert.equal(attempts.filter(attempt => attempt.status === 410).length, 1);
    const result = assertSuccess(attempts.find(attempt => attempt.status === 200));
    assert.equal(result.status, "complete");
    assert.equal(result.auth.user.id, flow.tenant.owner.id);
    const claims = jwt.decode(result.auth.accessToken);
    assert.equal(claims.deviceId, deviceId);
    assert.equal(await ctx.db.session.count(), 1);
    assertFailure(await post("poll", flow.proof), 410);
    assert.equal(await ctx.db.session.count(), 1);
  });
  test("multi-shop approval selects the shop before any app session exists", async () => {
    const flow = await prepare();
    const second = await createTenant(ctx.db);
    await ctx.db.user.update({ where: { id: second.owner.id }, data: { email: "native-owner@example.test" } });
    const approval = { requestId: flow.request.requestId, userCode: flow.request.userCode, credential: flow.credential(flow.info.nonce) };
    const choices = await post("approve", approval);
    assertFailure(choices, 409);
    assert.equal(choices.body.code, "SHOP_SELECTION_REQUIRED");
    assert.equal(await ctx.db.session.count(), 0);
    assertSuccess(await post("approve", { ...approval, shopId: second.shop.id }));
    assert.equal(assertSuccess(await post("poll", flow.proof)).auth.shop.id, second.shop.id);
  });
  test("disabled accounts and password changes invalidate approved sign-ins", async () => {
    for (const change of [{ disabledAt: new Date() }, { passwordHash: "changed-after-approval" }]) {
      const flow = await prepare(`owner-${crypto.randomUUID()}@example.test`);
      assertSuccess(await post("approve", { requestId: flow.request.requestId, userCode: flow.request.userCode, credential: flow.credential(flow.info.nonce) }));
      await ctx.db.user.update({ where: { id: flow.tenant.owner.id }, data: change });
      const result = await post("poll", flow.proof);
      assert.ok([401, 404].includes(result.status));
      assert.equal(await ctx.db.session.count(), 0);
    }
  });
  test("Google app sign-in preserves plan device limits and owner replacement", async () => {
    const flow = await prepare();
    await ctx.db.subscription.update({ where: { shopId: flow.tenant.shop.id }, data: { planCode: "starter" } });
    for (const id of ["registered-device-one", "registered-device-two"]) {
      assertSuccess(await ctx.post("/api/auth/login", { mobile: flow.tenant.ownerMobile, password: flow.tenant.ownerPassword, device: { deviceId: id } }, { headers: { "x-device-id": id } }));
    }
    assertSuccess(await post("approve", { requestId: flow.request.requestId, userCode: flow.request.userCode, credential: flow.credential(flow.info.nonce) }));
    const denied = assertFailure(await post("poll", flow.proof), 403);
    assert.equal(denied.code, "DEVICE_LIMIT_EXCEEDED");
    assert.ok(denied.deviceLimitToken);
    assert.equal(await ctx.db.device.count({ where: { shopId: flow.tenant.shop.id } }), 2);
    assert.equal(await ctx.db.session.count(), 2);
    const replacement = assertSuccess(await ctx.post("/api/auth/device-replacement/complete", { replacementToken: denied.deviceLimitToken, targetDeviceId: "registered-device-one", ownerPin: flow.tenant.ownerPin, device: { deviceId } }, { headers }));
    assert.equal(jwt.decode(replacement.accessToken).deviceId, deviceId);
  });
}
