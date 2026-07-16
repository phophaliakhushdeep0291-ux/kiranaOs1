import assert from "node:assert/strict";
import fs from "node:fs";
import { tiersFrom, tierFor } from "../src/modules/loyalty/loyalty.service.js";

const tiers = tiersFrom('[{"name":"Bronze","minLifetimePoints":0},{"name":"Silver","minLifetimePoints":1000},{"name":"Gold","minLifetimePoints":5000}]');
assert.equal(tierFor({ lifetimeEarned: 0 }, tiers).tier, "Bronze");
assert.equal(tierFor({ lifetimeEarned: 1200 }, tiers).tier, "Silver");
assert.equal(tierFor({ lifetimeEarned: 1200 }, tiers).pointsToNextTier, 3800);
assert.equal(tierFor({ lifetimeEarned: 6000 }, tiers).tier, "Gold");
assert.equal(tiersFrom("broken")[0].name, "Bronze");

for (const schemaPath of ["../prisma/schema.prisma", "../prisma-postgres/schema.prisma"]) {
  const schema = fs.readFileSync(new URL(schemaPath, import.meta.url), "utf8");
  assert.match(schema, /pointsExpireDays/);
  assert.match(schema, /tierRulesJson/);
  assert.match(schema, /lastEarnedAt/);
  assert.match(schema, /locationId String\?/);
  assert.match(schema, /source\s+String/);
  assert.match(schema, /lifecycleCycle\s+Int\s+@default\(0\)/);
  assert.match(schema, /@@unique\(\[billId, type, lifecycleCycle\]\)/);
}

const service = fs.readFileSync(new URL("../src/modules/loyalty/loyalty.service.js", import.meta.url), "utf8");
assert.match(service, /type: "expire"/);
assert.match(service, /lastEarnedAt: new Date\(\)/);
assert.match(service, /locationId: bill.locationId/);
assert.match(service, /reapplyBillLoyaltyInTransaction/);
assert.match(service, /type: "earn_reversal"/);
assert.match(service, /type: "earn_reapply"/);
assert.match(service, /type: "redeem_reapply"/);
assert.match(service, /lifetimeEarned: \{ decrement: earned.points \}/);
assert.match(service, /temporary negative balance is intentional/);
console.log("Loyalty maturity examples passed");
