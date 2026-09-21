import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasSubscriptionAccess, isSubscriptionActive } from "../src/modules/subscription/subscription.service.js";
import { FREE_ACCESS_UNTIL, isFreeAccessActive, freeAccessUntilIso } from "../src/modules/subscription/freeAccess.js";
import { licenseValidity } from "../src/modules/devices/license.service.js";

const DAY = 24 * 60 * 60 * 1000;
const during = new Date(FREE_ACCESS_UNTIL.getTime() - DAY);
const after = new Date(FREE_ACCESS_UNTIL.getTime() + DAY);

// The SHIPPED boundary is read from env.js rather than from the running process,
// because buildTestEnv deliberately pins FREE_ACCESS_UNTIL to a past instant so the
// rest of the suite can test plan enforcement. Asserting the runtime value here
// would only re-read that override and prove nothing about what ships.
//
// It must be IST, not UTC: 2027-01-01T00:00+05:30 is 2026-12-31T18:30Z, and a shop
// in Indore closing its counter on new year's eve is still inside the window. Read
// as +00:00 it would shut five and a half hours early, mid-evening, still trading.
const envSource = readFileSync(new URL("../src/config/env.js", import.meta.url), "utf8");
const shipped = envSource.match(/FREE_ACCESS_UNTIL:[\s\S]{0,200}?\.default\("([^"]+)"\)/);
assert.ok(shipped, "env.js must give FREE_ACCESS_UNTIL a default");
assert.equal(shipped[1], "2027-01-01T00:00:00+05:30", "the shipped window must close at midnight IST");
assert.equal(
  new Date(shipped[1]).toISOString(),
  "2026-12-31T18:30:00.000Z",
  "and that must resolve to 18:30Z -- if this reads 00:00Z the offset has been dropped",
);

// Whatever the window is set to, the two readings of it must agree.
assert.equal(freeAccessUntilIso(), FREE_ACCESS_UNTIL.toISOString());

assert.equal(isFreeAccessActive(during), true, "inside the window");
assert.equal(isFreeAccessActive(after), false, "past the window");

// Every status a gate can meet. The promotion answers for all of them while it runs,
// and for none of them afterwards — the row underneath decides again on its own,
// which is the whole point of laying the promotion OVER the row instead of rewriting it.
const rows = {
  expired: { status: "expired" },
  payment_failed: { status: "payment_failed" },
  lapsedTrial: { status: "trial", trialEndsAt: new Date("2020-01-01"), graceEndsAt: new Date("2020-01-01") },
  lapsedGrace: { status: "grace", graceEndsAt: new Date("2020-01-01") },
};
for (const [label, row] of Object.entries(rows)) {
  assert.equal(isSubscriptionActive(row), false, `${label} is genuinely inactive`);
  assert.equal(hasSubscriptionAccess(row, during), true, `${label} must be served while the product is free`);
  assert.equal(hasSubscriptionAccess(row, after), false, `${label} must be enforced again once the window closes`);
}

// A paying shop is unaffected either way. Its period end is anchored to the REAL
// clock, not to the window: isSubscriptionActive deliberately reads new Date()
// rather than the `now` it is handed, because it answers about the row as it
// stands today. Anchoring this to FREE_ACCESS_UNTIL would expire the shop the
// moment a test run pins the window to the past.
const paid = { status: "active", currentPeriodEnd: new Date(Date.now() + 400 * DAY) };
assert.equal(hasSubscriptionAccess(paid, after), true, "a paid shop keeps access after the window");
assert.equal(hasSubscriptionAccess(paid, during), true, "and during it");

// The device licence has to agree with the gates. An offline counter trusts its
// licence before anything else, so a lapsed shop issued a licence dated by its
// lapsed row was locked out on the till while the server was letting it in.
// Dated against the window, not the clock, so it holds wherever the window is pinned.
const lapsedLicence = {
  status: "expired",
  currentPeriodEnd: new Date(FREE_ACCESS_UNTIL.getTime() - 30 * DAY),
  graceEndsAt: new Date(FREE_ACCESS_UNTIL.getTime() - 27 * DAY),
  maxDevices: 2,
};
const issuedDuring = licenseValidity({ ...lapsedLicence, issuedAt: during });
assert.equal(issuedDuring.validUntil.getTime(), FREE_ACCESS_UNTIL.getTime(), "a licence issued in the window is valid to its end");
assert.ok(issuedDuring.offlineGraceUntil > FREE_ACCESS_UNTIL, "and keeps offline grace past it, so new year lands in grace, not a lockout");
assert.deepEqual(issuedDuring.warnings, [], "and does not warn a shop using a free product that it is restricted");

const issuedAfter = licenseValidity({ ...lapsedLicence, issuedAt: after });
assert.equal(issuedAfter.validUntil.getTime(), lapsedLicence.currentPeriodEnd.getTime(), "once the window closes the row dates the licence again");
assert.ok(issuedAfter.warnings.includes("SUBSCRIPTION_RESTRICTED"), "and the restriction is reported again");

// A shop paid past the window keeps its own, later, dates.
const paidPast = new Date(FREE_ACCESS_UNTIL.getTime() + 200 * DAY);
const paidLicence = licenseValidity({ status: "active", currentPeriodEnd: paidPast, graceEndsAt: null, issuedAt: during, maxDevices: 2 });
assert.equal(paidLicence.validUntil.getTime(), paidPast.getTime(), "the window never shortens a paid licence");

// The gates must ask hasSubscriptionAccess, not isSubscriptionActive. This is the bug
// this file exists for: the promotion was written and every gate still read the row
// directly, so a lapsed shop was told it had free access and then refused at the door.
const gates = {
  "../src/modules/feature-gates/featureGate.service.js": 4,
  "../src/modules/devices/device.middleware.js": 2,
  "../src/modules/sync/sync.controller.js": 1,
  "../src/modules/ai/agent/agent.service.js": 1,
};
for (const [path, minimum] of Object.entries(gates)) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  const calls = (src.match(/hasSubscriptionAccess\(/g) ?? []).length;
  assert.ok(calls >= minimum, `${path} must gate on hasSubscriptionAccess (saw ${calls}, expected >= ${minimum})`);
  assert.ok(
    !/\bisSubscriptionActive\b/.test(src),
    `${path} must not gate on isSubscriptionActive — it ignores the free-access window`,
  );
}

// Nobody is charged for something that is currently free.
const checkout = readFileSync(new URL("../src/modules/payment-provider/paymentProvider.service.js", import.meta.url), "utf8");
assert.ok(checkout.includes("isFreeAccessActive()"), "checkout must refuse while the product is free");
assert.ok(checkout.includes("FREE_ACCESS_ACTIVE"), "the refusal must be identifiable by code");

// The renewal-period maths must keep reading the row, or a renewal bought the day the
// window closes would stack onto a period the promotion only appeared to grant.
const service = readFileSync(new URL("../src/modules/subscription/subscription.service.js", import.meta.url), "utf8");
assert.ok(
  /const currentActive = isSubscriptionActive\(current\);/.test(service),
  "activateSubscriptionAfterPayment must price renewals from the real subscription row",
);

console.log("Free access window examples passed");
