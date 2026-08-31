/**
 * The devices screen should show who is actually signed in.
 *
 * It listed every Device row the shop had ever created — removed ones, blocked
 * ones, and ones whose user logged out weeks ago — rendered identically to the
 * device someone was using at that moment. A device's `status` cannot answer
 * "is anyone signed in": "active" only means it still holds a licence slot, and
 * a logged-out device holds one too.
 *
 * So `signedIn` is derived from live Session rows, and this pins both halves of
 * that: what counts as live, and that the rest are still returned — because a
 * logged-out device keeps costing a slot until someone removes it, and hiding it
 * would strand a shop at its device limit with nothing on screen to remove.
 */
import assert from "node:assert/strict";
import db from "../src/db.js";
import { getDeviceManagementSnapshot, deviceStatusOccupiesSlot, listActiveDevices } from "../src/modules/devices/devices.service.js";

const ok = (label) => console.log(`  ok ${label}`);

const shop = await db.shop.create({
  data: { name: "Device Listing Kirana", ownerName: "Owner", city: "Indore", address: "Test" },
});
const owner = await db.user.create({
  data: { shopId: shop.id, name: "Om Hari", mobile: "9800000001", role: "owner", passwordHash: "x" },
});
const staff = await db.user.create({
  data: { shopId: shop.id, name: "Ramesh", mobile: "9800000002", role: "staff", passwordHash: "x" },
});

const device = (deviceId, status) => db.device.create({
  data: { shopId: shop.id, deviceId, deviceName: deviceId, status, userId: owner.id },
});

const counter = await device("counter-tablet", "active");
const phone = await device("staff-phone", "active");
const oldLaptop = await device("old-laptop", "logged_out");
const blocked = await device("blocked-tab", "blocked");
const removed = await device("removed-tab", "revoked");

const hour = 60 * 60 * 1000;
const session = (user, deviceId, overrides = {}) => db.session.create({
  data: {
    userId: user.id, shopId: shop.id, deviceId,
    refreshTokenHash: `hash-${deviceId}-${user.id}-${Math.random()}`,
    expiresAt: new Date(Date.now() + hour),
    ...overrides,
  },
});

await session(owner, "counter-tablet");
await session(staff, "staff-phone");
// Present but not live, in the three ways a session stops counting.
await session(owner, "old-laptop", { revokedAt: new Date() });
await session(owner, "blocked-tab", { expiresAt: new Date(Date.now() - hour) });
await session(owner, "removed-tab", { revokedAt: new Date(), revokedReason: "device_removed" });

const snapshot = await getDeviceManagementSnapshot(shop.id, "counter-tablet");
const byId = Object.fromEntries(snapshot.devices.map((row) => [row.deviceId, row]));

/* ---------------------------------------------------------- what is live */

assert.equal(byId["counter-tablet"].signedIn, true);
assert.equal(byId["staff-phone"].signedIn, true);
assert.equal(snapshot.signedInCount, 2, "two devices have someone on them");
ok("a device with a live session is signed in");

// Each of these has a Session row, and none of them is a login.
assert.equal(byId["old-laptop"].signedIn, false, "a revoked session is not a login");
assert.equal(byId["blocked-tab"].signedIn, false, "an expired session is not a login");
assert.equal(byId["removed-tab"].signedIn, false, "a removed device's session is not a login");
ok("revoked, expired and removed sessions do not count as signed in");

// The heart of the bug, stated as the distinction it actually is: a device can
// hold a licence slot with nobody on it. Reading "in use" off the status — which
// is what the screen effectively did — reports those as devices in use.
assert.equal(deviceStatusOccupiesSlot(byId["old-laptop"].status), true, "a logged-out device still costs a slot");
assert.equal(byId["old-laptop"].signedIn, false, "and still has nobody on it");
assert.equal(deviceStatusOccupiesSlot(byId["blocked-tab"].status), true, "a blocked device costs a slot too");
assert.equal(byId["blocked-tab"].signedIn, false);
ok("holding a slot is not the same as being signed in");

/* ------------------------------------------------------------ who it is */

assert.deepEqual(byId["counter-tablet"].signedInUsers.map((u) => u.name), ["Om Hari"]);
assert.deepEqual(byId["staff-phone"].signedInUsers.map((u) => u.name), ["Ramesh"]);
assert.deepEqual(byId["old-laptop"].signedInUsers, [], "nobody is on it, so nobody is named");
ok("each signed-in device names who is on it");

// A shared counter tablet can hold two logins at once; both are named, once each.
await session(staff, "counter-tablet");
await session(staff, "counter-tablet");
const shared = await getDeviceManagementSnapshot(shop.id, "counter-tablet");
const tablet = shared.devices.find((row) => row.deviceId === "counter-tablet");
assert.deepEqual(tablet.signedInUsers.map((u) => u.name).sort(), ["Om Hari", "Ramesh"]);
assert.equal(tablet.signedInSessionCount, 3, "three live sessions, two people");
ok("two people on one device are both named, and named once");

/* ------------------------------------------------- slots are not sessions */

// The trap in "only show signed-in devices": a logged-out device still costs a
// slot, so it has to stay on the page or there is no way to free one.
assert.ok(snapshot.devices.some((row) => row.deviceId === "old-laptop"), "a logged-out device is still returned");
assert.ok(snapshot.devices.some((row) => row.deviceId === "removed-tab"), "a removed device is still returned");
// active + logged_out + blocked occupy slots; revoked does not.
assert.equal(snapshot.devicesUsed, 4, "slot maths is unchanged by the session filter");
ok("devices nobody is on are still listed, and still counted against the plan");


/* -------------------------------------------- live is not the same as in use */

// The reason the screen still looked like a wall after the first fix. A refresh
// token lives 30 days, so a browser opened once three weeks ago still holds a
// live, unexpired, unrevoked session — and was listed as "signed in now"
// alongside the counter tablet someone was billing on.
const stale = await device("laptop-from-last-month", "active");
await session(owner, "laptop-from-last-month", {
  lastUsedAt: new Date(Date.now() - 21 * 24 * hour),
  expiresAt: new Date(Date.now() + 9 * 24 * hour),
});

const banded = await getDeviceManagementSnapshot(shop.id, "counter-tablet");
const laptop = banded.devices.find((row) => row.deviceId === "laptop-from-last-month");
assert.equal(laptop.signedIn, true, "its session really is live — that is the trap");
assert.equal(laptop.signedInRecently, false, "but nobody has touched it in three weeks");

const tabletNow = banded.devices.find((row) => row.deviceId === "counter-tablet");
assert.equal(tabletNow.signedInRecently, true, "the device in use today is in use today");
assert.ok(
  banded.signedInRecentlyCount < banded.signedInCount,
  "the in-use list must be shorter than the has-a-live-session list, or the fix does nothing",
);
ok("a month-old login is live but not in use, and is not listed as in use");

// A session created and never refreshed is a fresh login, not a stale one:
// lastUsedAt is null there, and falling back to createdAt keeps it on the list.
const justNow = await device("brand-new-phone", "active");
await session(staff, "brand-new-phone");
const withFresh = await getDeviceManagementSnapshot(shop.id, "counter-tablet");
assert.equal(
  withFresh.devices.find((row) => row.deviceId === "brand-new-phone").signedInRecently, true,
  "a login that has not refreshed yet is still a login that just happened",
);
ok("a brand-new session counts as in use even before its first refresh");


/* ------------------------------- the list shown when the limit stops a login */

// Netflix's shape: staying logged in is fine, and when the limit bites you are
// shown what is actually in use. The question here is "which slot do I free?",
// and registration order answers it wrong — the counter tablet taking money and
// a browser opened once last month look the same.
const limitList = await listActiveDevices(shop.id, { currentDeviceId: "counter-tablet" });
const names = limitList.map((row) => row.deviceId);

assert.ok(names.includes("laptop-from-last-month"), "an idle device must stay listed, or its slot cannot be freed");
assert.ok(names.includes("counter-tablet"), "and the one in use is still shown, so nobody removes it by accident");
assert.ok(!names.includes("removed-tab"), "a removed device holds no slot, so it is not part of this question");

// Idle first: those are the safe ones to remove.
const idlePosition = names.indexOf("laptop-from-last-month");
const inUsePosition = names.indexOf("counter-tablet");
assert.ok(idlePosition < inUsePosition, "the device nobody is on sorts above the one being billed on");
assert.equal(limitList.find((row) => row.deviceId === "laptop-from-last-month").signedInRecently, false);
assert.equal(limitList.find((row) => row.deviceId === "counter-tablet").signedInRecently, true);
ok("the device-limit list marks what is in use and offers the idle ones first");

await db.$disconnect();
console.log("device-signed-in-listing.examples.js OK");
