import assert from "assert";
import { isSubscriptionActive } from "../src/modules/subscription/subscription.service.js";

// Grace window must be honored for organically-expiring subscriptions. This deployment runs no
// scheduler, so a subscription's status stays "active" after currentPeriodEnd passes — nothing
// flips active → grace. The grace window (currentPeriodEnd + DEFAULT_GRACE_DAYS) is provisioned at
// activation, so a paying shop must keep access until grace itself elapses, not be cut off the
// instant the period rolls over. See CODE_REVIEW_LOGIC_FLAWS.md #3.
const DAY = 24 * 60 * 60 * 1000;
const future = (ms) => new Date(Date.now() + ms);
const past = (ms) => new Date(Date.now() - ms);

// active, still inside the paid period → active
assert.equal(isSubscriptionActive({ status: "active", currentPeriodEnd: future(5 * DAY) }), true, "active within period");

// active, period ended but inside the grace window → still active (the bug cut these off)
assert.equal(
  isSubscriptionActive({ status: "active", currentPeriodEnd: past(1 * DAY), graceEndsAt: future(2 * DAY) }),
  true,
  "active, period ended, within grace → still active"
);

// active, period ended and grace also elapsed → inactive
assert.equal(
  isSubscriptionActive({ status: "active", currentPeriodEnd: past(10 * DAY), graceEndsAt: past(3 * DAY) }),
  false,
  "active, period and grace both elapsed → inactive"
);

// active, period ended, no grace provisioned → inactive
assert.equal(
  isSubscriptionActive({ status: "active", currentPeriodEnd: past(1 * DAY) }),
  false,
  "active, period ended, no grace → inactive"
);

// explicit grace status still works as before
assert.equal(isSubscriptionActive({ status: "grace", graceEndsAt: future(1 * DAY) }), true, "grace status within window");
assert.equal(isSubscriptionActive({ status: "grace", graceEndsAt: past(1 * DAY) }), false, "grace status elapsed");

// terminal states stay inactive
assert.equal(isSubscriptionActive({ status: "expired", graceEndsAt: future(5 * DAY) }), false, "expired stays inactive");
assert.equal(isSubscriptionActive({ status: "cancelled", currentPeriodEnd: future(5 * DAY) }), false, "cancelled stays inactive");

// no subscription row → active (free/legacy default preserved)
assert.equal(isSubscriptionActive(null), true, "no subscription → active default preserved");

console.log("subscription-grace.examples.js OK");
