import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

process.env.OWNER_PIN_REQUIRED = "true";
const { default: db } = await import("../src/db.js");
const { default: app } = await import("../src/app.js");
const { signToken } = await import("../src/middleware/auth.js");
const suffix = crypto.randomUUID().slice(0, 8);
const deviceId = `marketplace-http-${suffix}`;
const shop = await db.shop.create({ data: { name: `Marketplace HTTP ${suffix}`, ownerName: "Test owner", address: "Test", city: "Pune", settingsJson: JSON.stringify({ businessProfile: { businessType: "restaurant" } }) } });
const owner = await db.user.create({ data: { shopId: shop.id, name: "Owner", mobile: `9${crypto.randomInt(100000000, 999999999)}`, role: "owner", passwordHash: "unused", pinHash: await bcrypt.hash("1234", 4) } });
const admin = await db.user.create({ data: { shopId: shop.id, name: "Admin", mobile: `8${crypto.randomInt(100000000, 999999999)}`, role: "admin", passwordHash: "unused" } });
const location = await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main" } });
const deviceRecord = await db.device.create({ data: { shopId: shop.id, deviceId, deviceName: "Test counter", status: "active" } });
const sessions = new Map();
for (const user of [owner, admin]) {
  const session = await db.session.create({ data: { shopId: shop.id, userId: user.id, deviceId, deviceRecordId: deviceRecord.id, deviceSessionVersion: deviceRecord.sessionVersion, refreshTokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
  sessions.set(user.id, session.id);
}
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/api/integrations/restaurant-marketplaces`;
const token = (user) => signToken({ tokenType: "ACCESS", userId: user.id, shopId: user.shopId, role: user.role, sessionId: sessions.get(user.id) });
async function call(method, path = "", { user, pin, body, device = deviceId } = {}) {
  const response = await fetch(base + path, { method, headers: {
    "content-type": "application/json", ...(user ? { authorization: `Bearer ${token(user)}` } : {}),
    ...(device ? { "x-device-id": device } : {}), ...(pin ? { "x-owner-pin": pin } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}

try {
  assert.equal((await call("GET")).status, 401);
  assert.equal((await call("GET", "", { user: admin })).status, 403, "even shop admins cannot manage the owner's bindings");
  const missingDevice = await call("GET", "", { user: owner, device: "" });
  assert.equal(missingDevice.status, 400); assert.equal(missingDevice.body.code, "DEVICE_REQUIRED");
  const overview = await call("GET", "", { user: owner });
  assert.equal(overview.status, 200, JSON.stringify(overview.body)); assert.equal(overview.body.data.liveOrdersSupported, false);
  const body = { locationId: location.id, externalOutletId: `http-outlet-${suffix}`, environment: "sandbox" };
  assert.equal((await call("PUT", "/zomato", { user: owner, body })).status, 403);
  assert.equal((await call("PUT", "/zomato", { user: owner, pin: "1234", body: { ...body, status: "verified", enabled: true } })).status, 400);
  const saved = await call("PUT", "/zomato", { user: owner, pin: "1234", body });
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.data.enabled, false);
  const denied = await call("POST", `/connections/${saved.body.data.id}/verify`, { user: owner, pin: "1234", body: {} });
  assert.equal(denied.status, 503); assert.equal(denied.body.code, "MARKETPLACE_ADAPTER_REQUIRED");
  assert.equal((await db.restaurantMarketplaceConnection.findUnique({ where: { id: saved.body.data.id } })).status, "pending");
  console.log("Marketplace HTTP auth, activated device, owner role, owner PIN, schema and closed-adapter checks passed.");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.$disconnect();
}
