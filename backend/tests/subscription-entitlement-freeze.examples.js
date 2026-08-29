import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import db from "../src/db.js";
import { getPlanConfigForBusinessType } from "../src/modules/subscription/planConfig.js";

/**
 * Moving a feature between tiers must not take a working screen off a live shop.
 *
 * `subscription.service.js` reads `entitledFeaturesJson ?? plan.featuresJson`,
 * so a subscription carrying its own snapshot keeps what it had when the plan
 * underneath it changes. A subscription without one falls through to the plan
 * and silently loses whatever moved up a tier — mid-service, on a Saturday.
 *
 * This is what makes the restaurant two-plan change safe: tables and kitchen
 * tickets move from Counter to Dine-in, and every restaurant already paying
 * keeps them because the freeze ran first.
 */

const shop = await db.shop.create({ data: {
  name: `Freeze ${Date.now()}`, ownerName: "O", city: "C", address: "A",
  settingsJson: JSON.stringify({ businessProfile: { businessType: "restaurant" } }),
} });

// A restaurant on the cheap plan, from before the split — no snapshot, no lock.
await db.subscription.create({ data: {
  shopId: shop.id, planCode: "starter", status: "active",
  entitledFeaturesJson: null, lockedPriceMonthlyPaise: null, lockedPriceYearlyPaise: null,
} });

const read = () => db.subscription.findFirstOrThrow({ where: { shopId: shop.id } });
const run = (...args) => spawnSync(process.execPath, ["scripts/freeze-subscription-entitlements.js", ...args], {
  cwd: process.cwd(), env: process.env, encoding: "utf8",
});

/* ------------------------- --check refuses to pass while anything is loose */

const check = run("--check");
assert.notEqual(check.status, 0, "--check must fail while a subscription is unfrozen, so a deploy can be gated on it");
assert.equal(
  (await read()).entitledFeaturesJson, null,
  "and it must not write anything while only checking",
);

/* --------------------------------------------------- the freeze itself */

assert.equal(run().status, 0, "the write run succeeds");

const frozen = await read();
const plan = getPlanConfigForBusinessType("starter", "restaurant");
assert.ok(frozen.entitledFeaturesJson, "the subscription now carries its own entitlements");
assert.equal(frozen.lockedPriceMonthlyPaise, plan.priceMonthlyPaise, "and the price it agreed to");
assert.equal(frozen.lockedPriceYearlyPaise, plan.priceYearlyPaise);

const kept = JSON.parse(frozen.entitledFeaturesJson);
assert.ok(kept.includes("restaurant_menu"), "the snapshot is the real feature list, not an empty array");

/* ------------------------------- a second run leaves the photograph alone */

// Re-running must not overwrite a snapshot: an older one may record a more
// generous entitlement than the plan now lists, which is the thing worth keeping.
const before = await read();
assert.equal(run().status, 0);
const after = await read();
assert.equal(after.entitledFeaturesJson, before.entitledFeaturesJson, "a second run does not re-photograph");
assert.equal(after.lockedPriceMonthlyPaise, before.lockedPriceMonthlyPaise);

assert.equal(run("--check").status, 0, "and --check passes once everything is frozen");

console.log("subscription-entitlement-freeze: ok");
