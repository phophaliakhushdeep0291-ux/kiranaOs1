import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const deviceMiddleware = fs.readFileSync(path.join(root, "src/modules/devices/device.middleware.js"), "utf8");
const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
const syncRoutes = fs.readFileSync(path.join(root, "src/modules/sync/sync.routes.js"), "utf8");

assert.match(deviceMiddleware, /const userId = user\?\.userId \?\? user\?\.id \?\? null/, "device bootstrap should support both req.user.userId and req.user.id token shapes");
assert.doesNotMatch(deviceMiddleware, /if \(!req\.shopId \|\| !user\?\.userId\)/, "device bootstrap must not reject valid legacy req.user.id context");
assert.match(deviceMiddleware, /DEVICE_SHOP_CONTEXT_REQUIRED/, "missing shop context should have explicit error code");
assert.match(deviceMiddleware, /DEVICE_USER_CONTEXT_REQUIRED/, "missing user context should have explicit error code");
assert.match(deviceMiddleware, /activateDevice\(req\.shopId, \{ \.\.\.user, userId \}, input, req\)/, "auto activation should pass normalized userId into device service");
assert.match(deviceMiddleware, /reclaimOldestDevelopmentDevice\(req\.shopId, userId, deviceId\)/, "development device reclaim should use normalized userId");

assert.match(app, /app\.use\("\/api\/products", productRoutes\)/, "products route should remain mounted");
assert.match(app, /app\.use\("\/api\/bills", billRoutes\)/, "bills route should remain mounted");
assert.match(app, /app\.use\("\/api\/sync", syncRoutes\)/, "sync route should remain mounted");
assert.match(syncRoutes, /router\.get\("\/pull", requireDeviceAllowedForSync\(\)/, "sync pull route should remain mounted");
assert.match(syncRoutes, /router\.get\("\/status", requireDeviceActivated\(\)/, "sync status route should remain mounted");

console.log("Phase 42 device context compatibility examples passed");
