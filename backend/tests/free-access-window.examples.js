import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasSubscriptionAccess, isSubscriptionActive } from "../src/modules/subscription/subscription.service.js";
import { FREE_ACCESS_UNTIL, isFreeAccessActive, freeAccessUntilIso } from "../src/modules/subscription/freeAccess.js";

const DAY = 24 * 60 * 60 * 1000;
const during = new Date(FREE_ACCESS_UNTIL.getTime() - DAY);
const after = new Date(FREE_ACCESS_UNTIL.getTime() + DAY);

// The boundary is IST, not UTC. 2027-01-01T00:00+05:30 is 2026-12-31T18:30Z, and a
// shop in Indore closing its counter on new year's eve is still inside the window.
assert.equal(FREE_ACCESS_UNTIL.toISOString(), "2026-12-31T18:30:00.000Z", "window must close at midnight IST");
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

// A paying shop is unaffected either way.
const paid = { status: "active", currentPeriodEnd: new Date(FREE_ACCESS_UNTIL.getTime() + 400 * DAY) };
assert.equal(hasSubscriptionAccess(paid, after), true, "a paid shop keeps access after the window");

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
