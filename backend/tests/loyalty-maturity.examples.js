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
}

const service = fs.readFileSync(new URL("../src/modules/loyalty/loyalty.service.js", import.meta.url), "utf8");
assert.match(service, /type: "expire"/);
assert.match(service, /lastEarnedAt: new Date\(\)/);
assert.match(service, /locationId: bill.locationId/);
console.log("Loyalty maturity examples passed");
