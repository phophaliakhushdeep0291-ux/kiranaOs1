import assert from "node:assert/strict";
import http from "node:http";

// The service test proves the rules; this one proves they are actually REACHABLE
// and enforced over the wire — routing, auth, role gates, zod validation and the
// platform-admin allowlist, exercised through the real Express app.
//
// The allowlist is set here, before anything imports config/env.js, so the test
// brings its own operator identity instead of depending on a machine's .env.
const OPERATOR = "ops@remote-support-test.local";
process.env.PLATFORM_ADMIN_EMAILS = OPERATOR;

const { default: db } = await import("../src/db.js");
const { default: app } = await import("../src/app.js");
const { signToken } = await import("../src/middleware/auth.js");

const suffix = `rs-http-${Date.now()}`;
const DEVICE_ID = `till-${suffix}`;
let shop;
let owner;
let staff;
let server;
let baseUrl;

function tokenFor(user) {
  return signToken({ tokenType: "ACCESS", userId: user.id, shopId: user.shopId, role: user.role });
}

async function call(method, path, { token, body, deviceId = DEVICE_ID } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

async function main() {
  shop = await db.shop.create({ data: { name: `Shop ${suffix}`, ownerName: "O", city: "X", address: "Y" } });
  owner = await db.user.create({
    data: {
      shopId: shop.id,
      name: "Owner",
      mobile: `9${Date.now()}`.slice(0, 10),
      role: "owner",
      email: OPERATOR,
      passwordHash: "not-used-these-tests-mint-tokens-directly",
    },
  });
  staff = await db.user.create({
    data: {
      shopId: shop.id,
      name: "Staff",
      mobile: `8${Date.now()}`.slice(0, 10),
      role: "cashier",
      passwordHash: "not-used-these-tests-mint-tokens-directly",
    },
  });
  await db.device.create({ data: { shopId: shop.id, deviceId: DEVICE_ID, deviceName: "Counter", status: "active" } });
  // The stranded state the GSTIN repair exists for: a primary location with no
  // GST number, which blocks every GST invoice and which no screen can fill in.
  await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true } });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const ownerToken = tokenFor(owner);
  const staffToken = tokenFor(staff);

  // 1) Unauthenticated callers get nothing.
  const anonymous = await call("GET", "/support/state");
  assert.equal(anonymous.status, 401, "the support surface is not public");

  // 2) Staff cannot hand out access to the shop's data — only the owner can.
  const staffGrant = await call("POST", "/support/sessions", { token: staffToken, body: { scope: "repair" } });
  assert.equal(staffGrant.status, 403, "a cashier cannot grant remote access");

  // 3) The owner grants, and gets a 6-digit code back.
  const granted = await call("POST", "/support/sessions", {
    token: ownerToken,
    body: { scope: "repair", reason: "sync stuck" },
  });
  assert.equal(granted.status, 201, `owner can grant (got ${granted.status}: ${JSON.stringify(granted.body)})`);
  assert.match(granted.body.data.code, /^\d{6}$/, "the response carries the code exactly once");
  const sessionId = granted.body.data.id;

  // 4) Malformed codes are rejected by validation, not by the database.
  const malformed = await call("POST", "/platform-admin/support/redeem", { token: ownerToken, body: { code: "abc" } });
  assert.equal(malformed.status, 400, "a non-numeric code fails validation");

  // 5) A non-admin cannot redeem even a perfectly valid code.
  const staffRedeem = await call("POST", "/platform-admin/support/redeem", {
    token: staffToken,
    body: { code: granted.body.data.code },
  });
  assert.equal(staffRedeem.status, 403, "the platform-admin allowlist gates redemption");

  // 6) The operator redeems and lands on the granting shop.
  const redeemed = await call("POST", "/platform-admin/support/redeem", {
    token: ownerToken,
    body: { code: granted.body.data.code },
  });
  assert.equal(redeemed.status, 200, `operator can redeem (got ${JSON.stringify(redeemed.body)})`);
  assert.equal(redeemed.body.data.shop.id, shop.id, "the code resolved to the right shop");

  // 7) Diagnostics for that one shop are readable through the session.
  const diagnostics = await call("GET", `/platform-admin/support/sessions/${sessionId}/diagnostics`, {
    token: ownerToken,
  });
  assert.equal(diagnostics.status, 200, "the operator can read the shop's diagnostics");
  assert.equal(diagnostics.body.data.shop.id, shop.id);
  assert.ok(
    diagnostics.body.data.devices.some((device) => device.deviceId === DEVICE_ID),
    "the shop's devices are listed so the operator can pick a target",
  );

  // 8) An off-catalog command is refused at the edge by the enum, not deeper down.
  const forged = await call("POST", "/platform-admin/support/commands", {
    token: ownerToken,
    body: { sessionId, type: "DROP_DATABASE", deviceId: DEVICE_ID },
  });
  assert.equal(forged.status, 400, "only catalog commands pass validation");

  // 9) A real command queues.
  const dispatched = await call("POST", "/platform-admin/support/commands", {
    token: ownerToken,
    body: { sessionId, type: "RETRY_FAILED_SYNC", deviceId: DEVICE_ID, reason: "clearing the stuck outbox" },
  });
  assert.equal(dispatched.status, 201, `command queued (got ${JSON.stringify(dispatched.body)})`);

  // 10) The device drains it on its own poll — staff token is fine, the till is
  //     usually signed in as staff; the owner's code is what authorised the work.
  const polled = await call("GET", "/support/commands", { token: staffToken });
  assert.equal(polled.status, 200);

  const operatorCommand = polled.body.data.commands.find((command) => command.type === "RETRY_FAILED_SYNC");
  assert.ok(operatorCommand, "the target device receives the operator's command");
  const commandId = operatorCommand.id;

  // The poll also evaluates playbooks: this device has never reported health, so
  // auto-fix asks it to — unattended, with no session behind it, on the same poll.
  const automatic = polled.body.data.commands.find((command) => command.type === "COLLECT_DIAGNOSTICS");
  assert.ok(automatic, "auto-fix dispatched on the same poll that delivered the manual command");
  assert.equal(automatic.issuedByEmail, null, "the automatic one has no operator identity");

  // A different device polling the same shop gets neither.
  const otherDevice = await call("GET", "/support/commands", { token: staffToken, deviceId: "some-other-till" });
  assert.ok(
    !otherDevice.body.data.commands.some((command) => command.type === "RETRY_FAILED_SYNC"),
    "a command is scoped to one device",
  );

  // 11) The device reports back and the owner can see what happened.
  const acked = await call("POST", `/support/commands/${commandId}/ack`, {
    token: staffToken,
    body: { status: "applied", result: { retried: 3 } },
  });
  assert.equal(acked.status, 200, `device can ack (got ${JSON.stringify(acked.body)})`);

  const state = await call("GET", "/support/state", { token: ownerToken });
  assert.equal(state.status, 200);
  assert.equal(state.body.data.activeSession.id, sessionId, "the owner sees support is connected");

  const ownerViewOfCommand = state.body.data.recentCommands.find((command) => command.id === commandId);
  assert.equal(ownerViewOfCommand.status, "applied", "and sees the outcome");

  // Unattended fixes are listed for the owner too, flagged as automatic — the
  // whole point is that nothing happens to their till that they cannot see.
  const ownerViewOfAutomatic = state.body.data.recentCommands.find((command) => command.id === automatic.id);
  assert.equal(ownerViewOfAutomatic.automatic, true, "an automatic fix is labelled as such for the owner");
  assert.equal(ownerViewOfAutomatic.playbookId, "refresh-stale-diagnostics", "and names the playbook that fired it");
  assert.equal(state.body.data.autoFix.enabled, true, "the owner's auto-fix switch is reported with the state");

  // The execution is in the owner's audit timeline, written by the server.
  const auditRows = await db.auditLog.findMany({ where: { shopId: shop.id, module: "support" } });
  const actions = auditRows.map((row) => row.action);
  assert.ok(actions.includes("SUPPORT_SESSION_GRANTED"), "granting access is audited");
  assert.ok(actions.includes("SUPPORT_COMMAND_ISSUED"), "issuing a command is audited");
  assert.ok(actions.includes("SUPPORT_COMMAND_EXECUTED"), "executing a command is audited");

  // 12) Settings repair over the wire — the one path that writes shop data.
  const settingsView = await call("GET", `/platform-admin/support/sessions/${sessionId}/settings`, {
    token: ownerToken,
  });
  assert.equal(settingsView.status, 200, "the operator can list repairable settings");
  assert.ok(
    settingsView.body.data.settings.some((setting) => setting.key === "location.gstNumber"),
    "the GSTIN repair is offered",
  );

  // A key outside the catalog never reaches the service — zod rejects it first.
  const forgedKey = await call("POST", "/platform-admin/support/settings", {
    token: ownerToken,
    body: { sessionId, key: "shop.plan", value: "enterprise" },
  });
  assert.equal(forgedKey.status, 400, "only catalog keys pass validation");

  // A staff account cannot repair a setting even with a valid session id.
  const staffRepair = await call("POST", "/platform-admin/support/settings", {
    token: staffToken,
    body: { sessionId, key: "location.gstNumber", value: "27AAPFU0939F1ZV" },
  });
  assert.equal(staffRepair.status, 403, "the platform-admin gate still applies");

  const repaired = await call("POST", "/platform-admin/support/settings", {
    token: ownerToken,
    body: { sessionId, key: "location.gstNumber", value: "27AAPFU0939F1ZV", reason: "GST invoices blocked" },
  });
  assert.equal(repaired.status, 200, `the setting is repaired (got ${JSON.stringify(repaired.body)})`);
  assert.equal(repaired.body.data.after.gstNumber, "27AAPFU0939F1ZV");
  assert.equal(repaired.body.data.after.gstStateCode, "27", "the derived state code travels with it");

  // The owner sees the data change on their own screen, not just the device fixes.
  const stateAfterRepair = await call("GET", "/support/state", { token: ownerToken });
  assert.equal(stateAfterRepair.body.data.settingRepairs.length, 1, "the repair is listed for the owner");
  assert.equal(stateAfterRepair.body.data.settingRepairs[0].label, "GSTIN on a store location");

  // 13) The owner's stop button really stops it.
  const revoked = await call("DELETE", `/support/sessions/${sessionId}`, { token: ownerToken });
  assert.equal(revoked.status, 200, "the owner can end remote access");

  // A revoked session cannot write a setting either — the gate is re-checked per
  // request, not captured when the session opened.
  const repairAfterRevoke = await call("POST", "/platform-admin/support/settings", {
    token: ownerToken,
    body: { sessionId, key: "shop.gstNumber", value: "27AAPFU0939F1ZV" },
  });
  assert.equal(repairAfterRevoke.status, 403, "settings repair dies with the session");

  const afterRevoke = await call("GET", `/platform-admin/support/sessions/${sessionId}/diagnostics`, {
    token: ownerToken,
  });
  assert.equal(afterRevoke.status, 403, "the operator is locked out on the very next request");

  console.log("remote-support-http.examples.js OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.deviceCommand.deleteMany({ where: { shopId: shop?.id } });
      await db.supportSession.deleteMany({ where: { shopId: shop?.id } });
      await db.device.deleteMany({ where: { shopId: shop?.id } });
      await db.storeLocation.deleteMany({ where: { shopId: shop?.id } });
      await db.auditLog.deleteMany({ where: { shopId: shop?.id } });
      await db.user.deleteMany({ where: { shopId: shop?.id } });
      await db.shop.deleteMany({ where: { id: shop?.id } });
    } catch (cleanupError) {
      console.error("cleanup failed", cleanupError);
    }
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
