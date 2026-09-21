/**
 * Resolving a shop's plan is on the hot path, so it must not re-read the catalogue.
 *
 * getEffectivePlan gates devices, features and sync. Every gated request calls it,
 * which includes every /api/sync/pull — one per device, on a cadence that starts at
 * 2.5s. It used to cost four queries for one answer:
 *
 *   Plan.findMany          ensurePlansSeeded re-reading every plan row and diffing
 *                          eight fields against a compile-time constant, per request
 *   Subscription.findUnique the actual lookup
 *   Plan.findUnique        the catalogue row, read to build the entitled snapshot
 *   Plan.findUnique        the SAME row again, read by getEffectivePlan for its own
 *
 * Two of those were nothing. This holds them gone.
 *
 * The memo is the part with a sharp edge, and the last section is the one that
 * matters most: it is only safe because tests/integration/setup.js clears it after
 * truncating Plan. If that call is ever dropped, tests start running against a
 * catalogue the memo still believes in, and the failures land somewhere else
 * entirely.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import db from "../src/db.js";
import {
  activateManualSubscription,
  ensurePlansSeeded,
  getCurrentSubscription,
  getEffectivePlan,
} from "../src/modules/subscription/subscription.service.js";
import { forgetVerifiedPlanCatalogue } from "../src/modules/subscription/plan-catalogue-memo.js";

const shop = await db.shop.create({
  data: { name: "Plan lookup proof", ownerName: "Owner", city: "Indore", address: "1 Test Road" },
});

await ensurePlansSeeded();
await activateManualSubscription(shop.id, "growth", "monthly");

let recording = false;
const seen = [];
db.$use(async (params, next) => {
  if (recording) seen.push(`${params.model ?? "raw"}.${params.action}`);
  return next(params);
});

async function queriesFor(run) {
  await run();            // warm: settle the catalogue memo first
  seen.length = 0;
  recording = true;
  try {
    return (await run(), seen.slice());
  } finally {
    recording = false;
  }
}

/* ------------- one answer, one subscription read, one plan read ----------- */

const effective = await queriesFor(() => getEffectivePlan(shop.id));
assert.deepEqual(
  effective,
  ["Subscription.findUnique", "Plan.findUnique"],
  "getEffectivePlan must read the subscription and its plan once each — no catalogue scan, no second read of the same plan row",
);

const current = await queriesFor(() => getCurrentSubscription(shop.id));
assert.deepEqual(
  current,
  ["Subscription.findUnique", "Plan.findUnique"],
  "getCurrentSubscription must not scan the catalogue either",
);

/* ------------------- and the answer itself is unchanged ------------------- */

const plan = await getEffectivePlan(shop.id);
assert.equal(plan.planCode, "growth", "the growth plan must still be what resolves");
assert.ok(plan.plan?.name, "the plan snapshot must still carry its catalogue name");
assert.ok(Number.isFinite(plan.limits?.maxDevices), "and its limits");
assert.equal(plan.subscription.planCode, "growth", "the subscription must still be returned alongside");
assert.equal(plan.subscription.source, "subscription", "and still say where it came from");
// The trial path reads no catalogue row at all, so it must still look one up.
const trialShop = await db.shop.create({
  data: { name: "Trial shop", ownerName: "Owner", city: "Indore", address: "2 Test Road" },
});
const trial = await getEffectivePlan(trialShop.id);
assert.ok(trial.planCode, "a shop with no subscription must still resolve a plan to gate on");
assert.ok(trial.features && typeof trial.features === "object", "and the features the gates read");
assert.ok(Number.isFinite(trial.limits?.maxDevices), "and the device limit");
assert.equal(trial.subscription.source, "fallback/trial", "and must still be reported as a trial");

/* ---------------- the catalogue check is once, not never ------------------ */

const cold = await (async () => {
  await getEffectivePlan(shop.id);
  forgetVerifiedPlanCatalogue();
  seen.length = 0;
  recording = true;
  await getEffectivePlan(shop.id);
  recording = false;
  return seen.slice();
})();
assert.ok(
  cold.includes("Plan.findMany"),
  "after forgetting, the next call must verify the catalogue again — the memo is a memo, not a permanent opt-out",
);

// A deleted catalogue must come back, or a test that truncates Plan would leave
// every later gate resolving against nothing.
await db.plan.deleteMany({});
forgetVerifiedPlanCatalogue();
await ensurePlansSeeded();
assert.ok(await db.plan.count() > 0, "ensurePlansSeeded must re-seed a catalogue that was deleted");

/* ------- the reset the memo depends on is actually wired into tests ------- */

const setup = fs.readFileSync("tests/integration/setup.js", "utf8");
assert.match(
  setup,
  /forgetVerifiedPlanCatalogue\(\)/,
  "tests/integration/setup.js truncates Plan between cases; without forgetVerifiedPlanCatalogue() the memo outlives the rows",
);
assert.match(
  setup,
  /plan-catalogue-memo\.js/,
  "the reset must be imported from plan-catalogue-memo.js — importing subscription.service.js there pulls src/db.js in before buildTestEnv() sets DATABASE_URL",
);

console.log("plan-lookup-is-not-paid-per-request.examples.js OK");
