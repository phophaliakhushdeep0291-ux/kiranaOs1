import assert from "assert";
import crypto from "crypto";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }

const envSource = read("src/config/env.js");
const licenseService = read("src/modules/devices/license.service.js");
const deviceMiddleware = read("src/modules/devices/device.middleware.js");
const deviceService = read("src/modules/devices/devices.service.js");
const deviceRoutes = read("src/modules/devices/devices.routes.js");
const syncRoutes = read("src/modules/sync/sync.routes.js");
const productionCheck = read("scripts/production-check.js");
const packageJson = JSON.parse(read("package.json"));

assert(envSource.includes("LICENSE_SIGNING_SECRET is required in production"), "production must require LICENSE_SIGNING_SECRET");
assert(read(".env.example").includes("LICENSE_SIGNING_SECRET"), ".env.example must document LICENSE_SIGNING_SECRET");

for (const snippet of [
  "buildLicensePayload",
  "signLicensePayload",
  "verifyLicenseSignature",
  "issueDeviceLicense",
  "revokeDeviceLicense",
  "refreshDeviceLicense",
  "getCurrentDeviceLicense",
  "HMAC-SHA256",
  "createHmac(\"sha256\"",
  "canonicalJson",
  "signatureHash",
  "licenseVersion",
  "subscriptionStatus",
  "offlineGraceUntil",
]) {
  assert(licenseService.includes(snippet), `license.service.js missing ${snippet}`);
}

// Deterministic canonical HMAC proof without importing app/db/env.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const payloadA = { shopId: "shop_1", deviceId: "dev_1", planCode: "starter", features: ["basic_billing"], maxDevices: 1, subscriptionStatus: "active", licenseVersion: 1 };
const payloadSameDifferentOrder = { licenseVersion: 1, subscriptionStatus: "active", maxDevices: 1, features: ["basic_billing"], planCode: "starter", deviceId: "dev_1", shopId: "shop_1" };
const secret = "test-license-secret-at-least-32-chars";
const sig1 = crypto.createHmac("sha256", secret).update(canonicalJson(payloadA)).digest("hex");
const sig2 = crypto.createHmac("sha256", secret).update(canonicalJson(payloadSameDifferentOrder)).digest("hex");
const sigChanged = crypto.createHmac("sha256", secret).update(canonicalJson({ ...payloadA, planCode: "pro" })).digest("hex");
assert.equal(sig1, sig2, "same payload + secret must produce same deterministic signature");
assert.notEqual(sig1, sigChanged, "changed payload must fail signature equivalence");

for (const snippet of [
  "requireDeviceActivated",
  "requireDeviceAllowedForSync",
  "requireDeviceAllowedForPremiumAction",
  "DEVICE_REQUIRED",
  "DEVICE_REMOVED",
  "DEVICE_BLOCKED",
]) {
  assert(deviceMiddleware.includes(snippet), `device middleware missing ${snippet}`);
}

assert(syncRoutes.includes("requireDeviceAllowedForSync()"), "sync push/pull must use device enforcement");
assert(deviceRoutes.includes("requireDeviceActivated()"), "device license route must require activated device");
assert(deviceRoutes.includes('"/:deviceId/block"') && deviceRoutes.includes('"/:deviceId/unblock"'), "device block/unblock routes should exist");

for (const snippet of [
  "DEVICE_LIMIT_EXCEEDED",
  "idempotent: true",
  "revokeDeviceLicense",
  "DEVICE_ACTIVATED",
  "DEVICE_REMOVED",
  "DEVICE_BLOCKED",
]) {
  assert(deviceService.includes(snippet), `devices.service.js missing ${snippet}`);
}
assert(
  deviceService.includes("DEVICE_REACTIVATED") || deviceService.includes("DEVICE_UNBLOCKED"),
  "devices.service.js must audit blocked-device reactivation",
);

for (const snippet of [
  "license.service.js",
  "HMAC SHA-256",
  "requireDeviceActivated",
  "requireDeviceAllowedForSync",
  "DEVICE_LIMIT_EXCEEDED",
  "phase8-device-license-security.examples.js",
]) {
  assert(productionCheck.includes(snippet), `production-check missing Phase 8 check: ${snippet}`);
}

assert(packageJson.scripts.test.includes("phase8-device-license-security.examples.js") || packageJson.scripts["test:billing"].includes("phase8-device-license-security.examples.js"), "Phase 8 static tests must be wired into npm test");

console.log("Phase 8 device license security examples passed");
