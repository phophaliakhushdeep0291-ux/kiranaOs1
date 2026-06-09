import assert from "node:assert/strict";
import fs from "node:fs";

const deviceService = fs.readFileSync("src/modules/devices/devices.service.js", "utf8");
const deviceMiddleware = fs.readFileSync("src/modules/devices/device.middleware.js", "utf8");
const envConfig = fs.readFileSync("src/config/env.js", "utf8");

assert.match(envConfig, /DEV_MAX_ACTIVE_DEVICES/);
assert.match(deviceService, /getRuntimeDeviceLimit/);
assert.match(deviceService, /env\.NODE_ENV === "production"/);
assert.match(deviceService, /DEVICE_REMOVED_REACTIVATION_REQUIRES_OWNER/);
assert.match(deviceMiddleware, /activateMissingRequestDevice/);
assert.match(deviceMiddleware, /env\.NODE_ENV !== "production"/);

console.log("Phase 46 multi-device smoothness examples passed");
