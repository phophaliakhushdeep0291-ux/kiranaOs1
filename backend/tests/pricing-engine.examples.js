import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluatePricing } from "../src/modules/pricing/pricing-engine.js";

// Parity fixtures shared with the frontend engine (frontend/src/tests/
// pricing-engine-parity.test.ts reads THIS same JSON). If FE and BE ever
// diverge, one of these two suites fails.
const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/pricing-parity.json", import.meta.url), "utf8"));

for (const f of fixtures) {
  const r = evaluatePricing(f.context, f.rules);
  assert.equal(r.recommendedUnitPrice, f.expected.recommendedUnitPrice, `${f.name}: price`);
  assert.equal(r.appliedRuleType, f.expected.appliedRuleType, `${f.name}: ruleType`);
  assert.equal(r.requiresApproval, f.expected.requiresApproval, `${f.name}: approval`);
  assert.equal(r.calculationVersion, "pricing-v1", `${f.name}: version`);
}

// Wiring assertions (source-text) — module is mounted + guarded + audited.
const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
assert.ok(app.includes('app.use("/api/pricing", pricingRoutes)'), "pricing routes must be mounted");
const routes = fs.readFileSync(new URL("../src/modules/pricing/pricing.routes.js", import.meta.url), "utf8");
assert.ok(routes.includes("requireAuth, requireShop, requireDeviceActivated()"), "pricing must be auth+shop+device gated");
assert.ok(routes.includes('requireRole("owner", "admin")'), "rule mutations must be owner/admin only");
const service = fs.readFileSync(new URL("../src/modules/pricing/pricing.service.js", import.meta.url), "utf8");
assert.ok(service.includes("PRICING_RULE_CREATED") && service.includes("PRICING_RULE_DELETED"), "rule changes must be audited");
assert.ok(service.includes("status: \"ARCHIVED\""), "delete must soft-archive (historical bills reference rule ids)");

console.log("pricing-engine.examples.js OK");
