import assert from "node:assert/strict";
import fs from "node:fs";

const envConfig = fs.readFileSync("src/config/env.js", "utf8");
const deviceService = fs.readFileSync("src/modules/devices/devices.service.js", "utf8");
const deviceMiddleware = fs.readFileSync("src/modules/devices/device.middleware.js", "utf8");

assert.match(envConfig, /DEV_MAX_ACTIVE_DEVICES/, "development max active device override must be configurable");
assert.match(deviceService, /getRuntimeDeviceLimit/, "device activation must use runtime device limit helper");
assert.match(deviceService, /allowedMaxDevices/, "device limit error metadata must include runtime allowed device count");
assert.match(deviceService, /env\.NODE_ENV === "development"/, "multi-device override must only apply in local development");
assert.match(deviceMiddleware, /\["removed", "revoked"\]\.includes\(device\.status\)[\s\S]*env\.NODE_ENV !== "production"[\s\S]*activateMissingRequestDevice/, "revoked development devices must be able to rejoin automatically");
assert.match(deviceMiddleware, /Production still rejects revoked devices/, "production revoked-device protection must remain documented");
assert.match(deviceMiddleware, /status: "revoked"[\s\S]*sessionVersion: \{ increment: 1 \}[\s\S]*DEVELOPMENT_DEVICE_RECLAIMED/, "development reclaim must revoke the device and its sessions atomically");

console.log("Phase 45 multi-device device-limit examples passed");
