import assert from "node:assert/strict";
import {
  BUSINESS_TYPE_PLAN_PRICING,
  getPlanConfigForBusinessType,
  offeredPlanCodesForBusinessType,
  PLAN_CODES,
} from "../src/modules/subscription/planConfig.js";
import { FEATURE_REGISTRY } from "../src/modules/feature-gates/featureRegistry.js";

/**
 * A food business is sold two plans, and the line between them is one question:
 * do guests sit down?
 *
 * Counter is a takeaway, cloud kitchen, bakery or tea shop — it bills a queue
 * and sends food out. Dine-in adds the floor: tables to seat, tickets routed to
 * a station, a QR on each table, bookings.
 *
 * The line is drawn here rather than by feature count because it is the one a
 * shopkeeper can answer before the sentence finishes, and because it is where
 * the software genuinely divides: a cloud kitchen never opens `tables`, `kot`
 * or `service-ops`.
 */

const counter = getPlanConfigForBusinessType("starter", "restaurant");
const dinein = getPlanConfigForBusinessType("growth", "restaurant");

/* ------------------------------------------------------- two plans, named */

assert.deepEqual(
  offeredPlanCodesForBusinessType("restaurant"), ["starter", "growth"],
  "a restaurant is offered two plans and no more",
);
assert.equal(counter.name, "Counter");
assert.equal(dinein.name, "Dine-in");

assert.deepEqual(
  offeredPlanCodesForBusinessType("kirana"), ["starter", "growth", "pro"],
  "and no other trade is changed by that",
);

/* ------------------------------------------------------------- the prices */

assert.equal(counter.priceMonthlyPaise, 79900, "Counter is ₹799 a month");
assert.equal(counter.priceYearlyPaise, 799000, "and ten months for a year");
assert.equal(dinein.priceMonthlyPaise, 149900, "Dine-in is ₹1,499 a month");
assert.equal(dinein.priceYearlyPaise, 1499000, "and ten months for a year");

for (const [code, plan] of [["Counter", counter], ["Dine-in", dinein]]) {
  assert.equal(
    plan.priceYearlyPaise, plan.priceMonthlyPaise * 10,
    `${code}'s yearly price is exactly ten months — "two months free" has to be true`,
  );
}

// Every price this business quotes ends in ₹49 or ₹99, across all eleven trades
// and thirty-three plans. That is not decoration: a lone round number in a
// price list is the one a customer reads as arbitrary, and the one that betrays
// a value typed in a hurry. A pricing change that breaks the pattern should
// have to argue for itself here rather than slip through.
for (const [code, plan] of [["Counter", counter], ["Dine-in", dinein]]) {
  assert.equal(
    plan.priceMonthlyPaise % 10000, 9900,
    `${code} is priced at a round number — every other plan ends in ₹49 or ₹99`,
  );
}

// Dine-in lands on what growth already costs, so no restaurant paying today
// sees an increase: growth stays put and pro comes down.
assert.equal(
  dinein.priceMonthlyPaise, 149900,
  "Dine-in matches today's growth price, so that cohort is not re-priced",
);
assert.ok(
  getPlanConfigForBusinessType("pro", "restaurant").priceMonthlyPaise < 199900,
  "and the old Business price comes down rather than up",
);

/* --------------------------------------------- what each plan can open */

const sellsFood = ["restaurant_menu", "restaurant_recipe_inventory", "batch_expiry"];
for (const feature of sellsFood) {
  assert.ok(
    counter.features.includes(feature),
    `${feature} is how a kitchen sells food at all, so Counter has it`,
  );
}

const theFloor = ["restaurant_tables", "restaurant_kot", "restaurant_table_qr", "restaurant_reservations"];
for (const feature of theFloor) {
  assert.ok(!counter.features.includes(feature), `${feature} is the floor, and Counter has no floor`);
  assert.ok(dinein.features.includes(feature), `${feature} is what Dine-in is for`);
}

// A cloud kitchen depletes ingredients as it sells; that cannot sit behind a
// plan whose whole subject is seating guests.
assert.ok(
  counter.features.includes("restaurant_recipe_inventory"),
  "recipes move DOWN to Counter — a kitchen with no floor still needs its stock to move",
);

/* ------------------------------- Dine-in is a superset, never a sidegrade */

for (const feature of counter.features) {
  assert.ok(
    dinein.features.includes(feature),
    `upgrading must never take ${feature} away`,
  );
}

/* --------------------------- the registry agrees with the plans it gates */

for (const feature of theFloor) {
  assert.equal(
    FEATURE_REGISTRY[feature]?.minimumPlan, "growth",
    `${feature} must ask for Dine-in, or the gate contradicts the plan`,
  );
}
for (const feature of ["restaurant_menu", "restaurant_recipe_inventory"]) {
  assert.equal(
    FEATURE_REGISTRY[feature]?.minimumPlan, "starter",
    `${feature} must be reachable on Counter, or the gate contradicts the plan`,
  );
}

/* ------------------------- old codes still resolve for offline tills */

for (const code of PLAN_CODES) {
  const plan = getPlanConfigForBusinessType(code, "restaurant");
  assert.ok(plan && plan.name, `${code} must still resolve — a till offline for a fortnight still sends it`);
}
assert.equal(
  getPlanConfigForBusinessType("pro", "restaurant").name, "Dine-in",
  "pro resolves onto Dine-in rather than a third plan nobody can buy",
);

/* ----------------------------------- no other trade moved underneath us */

assert.deepEqual(
  BUSINESS_TYPE_PLAN_PRICING.kirana, { starter: [9900, 99900], growth: [59900, 499900], pro: [99900, 899900] },
  "kirana pricing is untouched by a restaurant change",
);

console.log("restaurant-two-plans: ok");
