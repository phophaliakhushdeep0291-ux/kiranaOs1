import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const deviceMiddleware = fs.readFileSync(path.join(root, "src/modules/devices/device.middleware.js"), "utf8");
const syncRoutes = fs.readFileSync(path.join(root, "src/modules/sync/sync.routes.js"), "utf8");
const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");

assert.match(deviceMiddleware, /activateMissingRequestDevice/, "missing-device bootstrap helper should exist");
assert.match(deviceMiddleware, /activateDevice\(req\.shopId, \{ \.\.\.user, userId \}, input, req\)/, "missing device should use real activation service with normalized userId");
assert.match(deviceMiddleware, /DEVICE_LIMIT_EXCEEDED/, "development device-limit reclaim should be explicit");
assert.match(deviceMiddleware, /env\.NODE_ENV !== "production"/, "device reclaim must be non-production only");
assert.match(deviceMiddleware, /revokeDeviceLicense/, "reclaimed development device should revoke old license");
assert.match(deviceMiddleware, /DEVICE_USER_CONTEXT_REQUIRED/, "missing user context should return explicit auth error instead of misleading 404");

assert.match(syncRoutes, /router\.get\("\/status", requireDeviceActivated\(\), ctrl\.status\)/, "sync status route must remain mounted");
assert.match(syncRoutes, /router\.get\("\/pull", requireDeviceAllowedForSync\(\)/, "sync pull route must remain mounted");
assert.match(app, /app\.use\("\/api\/products", productRoutes\)/, "products route must remain mounted");
assert.match(app, /app\.use\("\/api\/customers", customerRoutes\)/, "customers route must remain mounted");
assert.match(app, /app\.use\("\/api\/sync", syncRoutes\)/, "sync route must remain mounted");

console.log("Phase 41 device bootstrap examples passed");
