import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createNativeLoginService } from "../src/modules/auth/native-login.service.js";
import { createMemoryNativeLoginStore, nativeLoginStore } from "../src/modules/auth/native-login.store.js";
import { redactSensitive } from "../src/lib/logger.js";
import { env } from "../src/config/env.js";

let now = Date.now(), issued = 0, nonceSeen;
const meta = { deviceId: "native-test-device", device: { deviceId: "native-test-device" } };
const store = createMemoryNativeLoginStore(() => now);
const service = createNativeLoginService({ store, now: () => now,
  approveIdentity: async (credential, nonce) => { assert.equal(credential, "verified-google-fixture"); nonceSeen = nonce; return { userId: "user-1" }; },
  completeLogin: async (approval, requestMeta) => { assert.equal(approval.userId, "user-1"); assert.equal(requestMeta.device.deviceId, meta.deviceId); issued++; return { token: "fixture-token" }; },
});
async function start() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const request = await service.start({ verifier, device: { deviceName: "Test counter" } }, meta);
  const proof = { requestId: request.requestId, verifier };
  const approve = () => service.approve({ requestId: request.requestId, userCode: request.userCode, credential: "verified-google-fixture" });
  return { request, proof, approve };
}
const first = await start();
const raw = await store.get(first.request.requestId);
assert.ok(!raw.includes(first.proof.verifier) && !raw.includes(first.request.userCode));
const info = await service.inspect({ requestId: first.request.requestId });
assert.deepEqual(Object.keys(info).sort(), ["deviceName", "expiresAt", "nonce"]);
assert.deepEqual(await service.poll(first.proof, meta), { status: "pending" });
await assert.rejects(service.poll({ ...first.proof, verifier: "x".repeat(43) }, meta), { code: "NATIVE_LOGIN_PROOF_INVALID" });
await assert.rejects(service.poll(first.proof, { deviceId: "other-device" }), { code: "NATIVE_LOGIN_PROOF_INVALID" });
await first.approve();
assert.equal(nonceSeen, info.nonce);
assert.equal(issued, 0, "browser approval must not issue a session");
const racing = await Promise.allSettled([service.poll(first.proof, meta), service.poll(first.proof, meta)]);
assert.equal(racing.filter(r => r.status === "fulfilled").length, 1);
assert.equal(issued, 1, "concurrent redemption must issue exactly one session");
await assert.rejects(first.approve(), { code: "NATIVE_LOGIN_EXPIRED" });
const cancelled = await start();
await service.cancel(cancelled.proof, meta);
await assert.rejects(cancelled.approve(), { code: "NATIVE_LOGIN_EXPIRED" });
const brute = await start();
for (let n = 0; n < 5; n++) await assert.rejects(service.approve({ requestId: brute.request.requestId, userCode: brute.request.userCode === "00000000" ? "11111111" : "00000000", credential: "verified-google-fixture" }), { code: "NATIVE_LOGIN_CODE_INVALID" });
await assert.rejects(brute.approve(), { code: "NATIVE_LOGIN_EXPIRED" });
const expired = await start();
now += 300_001;
await assert.rejects(expired.approve(), { code: "NATIVE_LOGIN_EXPIRED" });
await assert.rejects(service.poll(expired.proof, meta), { code: "NATIVE_LOGIN_EXPIRED" });
assert.equal(issued, 1);
assert.deepEqual(redactSensitive({ credential: "google-jwt", verifier: "proof", userCode: "12345678" }), { credential: "[REDACTED]", verifier: "[REDACTED]", userCode: "[REDACTED]" });
const previous = { NODE_ENV: env.NODE_ENV, REDIS_URL: env.REDIS_URL };
try {
  env.NODE_ENV = "production";
  env.REDIS_URL = undefined;
  await assert.rejects(nativeLoginStore.get("no-production-memory-fallback"), { code: "NATIVE_LOGIN_UNAVAILABLE" });
} finally { Object.assign(env, previous); }
console.log("Native sign-in: private proof, device binding, explicit approval, single use, cancellation, code limit and expiry passed.");
